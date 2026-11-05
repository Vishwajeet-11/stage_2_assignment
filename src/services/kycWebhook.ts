import type { Queue } from "bullmq";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { bullJobId, IDEMPOTENCY_TTL_SECONDS, idempotencyKey } from "../constants";
import { logger } from "../lib/logger";
import type { KycJobData, KycWebhookPayload } from "../types";

export type AcceptResult =
  | { status: "accepted" }
  | { status: "duplicate" }
  | { status: "unknown_investor" };

export async function acceptKycWebhook(
  payload: KycWebhookPayload,
  deps: { prisma: PrismaClient; redis: Redis; queue: Queue<KycJobData> },
): Promise<AcceptResult> {
  const key = idempotencyKey(payload.event_id);
  const existingKey = await deps.redis.get(key);
  if (existingKey !== null) {
    return { status: "duplicate" };
  }

  // After a successful worker run the Redis claim is gone. The audit row is the durable dedupe.
  const existingEvent = await deps.prisma.webhookEvent.findUnique({
    where: { eventId: payload.event_id },
    select: { id: true },
  });
  if (existingEvent) {
    return { status: "duplicate" };
  }

  const investor = await deps.prisma.investor.findUnique({
    where: { id: payload.investor_id },
    select: { id: true },
  });
  if (!investor) {
    return { status: "unknown_investor" };
  }

  const job: KycJobData = {
    eventId: payload.event_id,
    investorId: payload.investor_id,
    newStatus: payload.new_status,
    timestamp: payload.timestamp,
    payload,
  };

  try {
    await deps.queue.add("process-kyc-event", job, {
      jobId: bullJobId(payload.event_id),
      attempts: 5,
      backoff: { type: "exponential", delay: 2000 },
    });
  } catch (error) {
    if (isDuplicateJobError(error)) {
      return { status: "duplicate" };
    }
    logger.error("Failed to enqueue KYC webhook", {
      eventId: payload.event_id,
      message: error instanceof Error ? error.message : "unknown",
    });
    throw error;
  }

  // Claim only after the queue has accepted the job. A crash before this line leaves no key, so a retry can enqueue.
  const claimed = await deps.redis.set(key, "processing", "EX", IDEMPOTENCY_TTL_SECONDS, "NX");
  if (claimed === null) {
    return { status: "duplicate" };
  }

  return { status: "accepted" };
}

function isDuplicateJobError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("already exists");
}
