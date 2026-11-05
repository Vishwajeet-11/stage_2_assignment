import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { AppConfig } from "./config";
import type { KycJobData } from "./types";

export interface AppDeps {
  config: AppConfig;
  prisma: PrismaClient;
  redis: Redis;
  queue: Queue<KycJobData>;
}
