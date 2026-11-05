import { Queue, Worker, type WorkerOptions } from "bullmq";
import type { Redis } from "ioredis";
import { KYC_QUEUE_NAME } from "../constants";
import { logger } from "../lib/logger";
import type { KycJobData } from "../types";
import { processKycEvent, type WorkerDeps } from "../worker/processKycEvent";

export function createKycQueue(connection: Redis, prefix = "bull"): Queue<KycJobData> {
  return new Queue<KycJobData>(KYC_QUEUE_NAME, {
    connection,
    prefix,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { count: 1000 },
    },
  });
}

export function createKycWorker(
  connection: Redis,
  deps: WorkerDeps,
  prefix = "bull",
): Worker<KycJobData> {
  const options: WorkerOptions = { connection, concurrency: 5, prefix };
  const worker = new Worker<KycJobData>(
    KYC_QUEUE_NAME,
    async (job) => {
      await processKycEvent(job.data, deps);
    },
    options,
  );

  worker.on("failed", (job, error) => {
    logger.error("KYC job failed", {
      eventId: job?.data.eventId ?? null,
      message: error.message,
    });
  });

  return worker;
}
