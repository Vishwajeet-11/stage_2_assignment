import "dotenv/config";
import type { Server } from "node:http";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { logger } from "./lib/logger";
import { createPrisma } from "./lib/prisma";
import { createRedis } from "./lib/redis";
import { createKycQueue, createKycWorker } from "./queue/kycQueue";

const config = loadConfig();
const prisma = createPrisma();
const redis = createRedis(config.redisUrl);
const queueConnection = redis.duplicate();
const workerConnection = redis.duplicate();
const queue = createKycQueue(queueConnection);
const worker = createKycWorker(workerConnection, { prisma, redis });
const app = createApp({ config, prisma, redis, queue });

const server = app.listen(config.port, () => {
  logger.info("KYC service listening", { port: config.port });
});

let shuttingDown = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(server, signal);
  });
}

async function shutdown(httpServer: Server, signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info("Shutting down", { signal });
  await new Promise<void>((resolve, reject) => {
    httpServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  await worker.close(true);
  await queue.close();
  queueConnection.disconnect();
  workerConnection.disconnect();
  redis.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}
