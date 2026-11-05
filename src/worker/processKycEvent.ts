import { Prisma, type PrismaClient } from "@prisma/client";
import { UnrecoverableError } from "bullmq";
import type { Redis } from "ioredis";
import { idempotencyKey, KYC_PROVIDER } from "../constants";
import { readProviderTimestamp } from "../lib/eventTime";
import { logger } from "../lib/logger";
import type { KycJobData } from "../types";

export interface WorkerDeps {
  prisma: PrismaClient;
  redis: Redis;
}

export async function processKycEvent(data: KycJobData, deps: WorkerDeps): Promise<void> {
  const storedPayload: Prisma.InputJsonValue = {
    event_id: data.payload.event_id,
    investor_id: data.payload.investor_id,
    new_status: data.payload.new_status,
    timestamp: data.payload.timestamp,
  };

  try {
    const outcome = await deps.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Investor" WHERE "id" = ${data.investorId} FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new InvestorNotFoundError(data.investorId);
      }

      const events = await tx.webhookEvent.findMany({
        where: { investorId: data.investorId },
        select: { payload: true },
      });
      const incomingMs = Date.parse(data.timestamp);
      let newestMs = Number.NEGATIVE_INFINITY;
      for (const event of events) {
        const timestamp = readProviderTimestamp(event.payload);
        if (timestamp !== null && timestamp.ms > newestMs) {
          newestMs = timestamp.ms;
        }
      }

      const shouldUpdate = newestMs === Number.NEGATIVE_INFINITY || incomingMs >= newestMs;
      if (shouldUpdate) {
        await tx.investor.update({
          where: { id: data.investorId },
          data: { kyc_status: data.newStatus },
        });
      }

      await tx.webhookEvent.create({
        data: {
          eventId: data.eventId,
          provider: KYC_PROVIDER,
          payload: storedPayload,
          investorId: data.investorId,
        },
      });

      return { stale: !shouldUpdate };
    });

    if (outcome.stale) {
      logger.info("Stored stale KYC event without changing status", {
        eventId: data.eventId,
        investorId: data.investorId,
      });
    }
  } catch (error) {
    if (error instanceof InvestorNotFoundError) {
      logger.error("KYC investor not found", {
        eventId: data.eventId,
        investorId: data.investorId,
      });
      await deps.redis.del(idempotencyKey(data.eventId));
      throw new UnrecoverableError(error.message);
    }
    if (!isUniqueViolation(error)) {
      throw error;
    }
    logger.warn("KYC event already stored", { eventId: data.eventId });
  }

  await deps.redis.del(idempotencyKey(data.eventId));
}

class InvestorNotFoundError extends Error {
  constructor(investorId: string) {
    super(`Investor not found: ${investorId}`);
    this.name = "InvestorNotFoundError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

