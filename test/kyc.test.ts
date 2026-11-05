import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { signKycBody } from "../src/lib/hmac";
import { createPrisma } from "../src/lib/prisma";
import { createRedis } from "../src/lib/redis";
import { createKycQueue, createKycWorker } from "../src/queue/kycQueue";
import { idempotencyKey } from "../src/constants";
import type { KycWebhookPayload } from "../src/types";
import {
  INVESTOR_A_EMAIL,
  INVESTOR_A_ID,
  INVESTOR_B_ID,
  TENANT_A_ID,
  TENANT_A_NAME,
  TENANT_B_ID,
  TENANT_B_NAME,
} from "../prisma/ids";

const INVESTOR_A2_ID = "55555555-5555-4555-8555-555555555555";
const INVESTOR_A2_EMAIL = "cy@tenant-a.example";

const config = loadConfig();
const prisma = createPrisma();
const redis = createRedis(config.redisUrl);
const queueConnection = redis.duplicate();
const workerConnection = redis.duplicate();
const queue = createKycQueue(queueConnection, "kyc-test");
const worker = createKycWorker(workerConnection, { prisma, redis }, "kyc-test");
const app = createApp({ config, prisma, redis, queue });

before(async () => {
  await prisma.tenant.upsert({
    where: { id: TENANT_A_ID },
    create: { id: TENANT_A_ID, name: TENANT_A_NAME },
    update: { name: TENANT_A_NAME },
  });
  await prisma.tenant.upsert({
    where: { id: TENANT_B_ID },
    create: { id: TENANT_B_ID, name: TENANT_B_NAME },
    update: { name: TENANT_B_NAME },
  });
  await prisma.investor.upsert({
    where: { id: INVESTOR_A_ID },
    create: {
      id: INVESTOR_A_ID,
      tenant_id: TENANT_A_ID,
      email: INVESTOR_A_EMAIL,
      kyc_status: "pending",
    },
    update: { tenant_id: TENANT_A_ID, email: INVESTOR_A_EMAIL },
  });
  await prisma.investor.upsert({
    where: { id: INVESTOR_B_ID },
    create: {
      id: INVESTOR_B_ID,
      tenant_id: TENANT_B_ID,
      email: "ben@tenant-b.example",
      kyc_status: "pending",
    },
    update: { tenant_id: TENANT_B_ID },
  });
  await prisma.investor.upsert({
    where: { id: INVESTOR_A2_ID },
    create: {
      id: INVESTOR_A2_ID,
      tenant_id: TENANT_A_ID,
      email: INVESTOR_A2_EMAIL,
      kyc_status: "pending",
    },
    update: { tenant_id: TENANT_A_ID, email: INVESTOR_A2_EMAIL },
  });
});

beforeEach(async () => {
  await worker.pause();
  await prisma.webhookEvent.deleteMany();
  await prisma.investor.updateMany({ data: { kyc_status: "pending" } });
  const keys = await redis.keys("kyc:event:*");
  if (keys.length > 0) {
    await redis.del(...keys);
  }
  await queue.obliterate({ force: true });
  await worker.resume();
});

after(async () => {
  await worker.close(true);
  await queue.close();
  queueConnection.disconnect();
  workerConnection.disconnect();
  redis.disconnect();
  await prisma.$disconnect();
});

test("rejects an invalid signature and does not enqueue", { timeout: 20_000 }, async () => {
  const payload = webhookPayload(INVESTOR_A_ID, "approved", "2026-06-20T14:30:00.000Z");
  const beforeCounts = await queue.getJobCounts("wait", "active", "delayed", "completed", "failed");

  const response = await postWebhook(payload, "not-a-valid-signature");

  assert.equal(response.status, 401);
  const body = readJson(response.text);
  assert.equal(isRecord(body) && body.success, false);
  assert.equal(await redis.get(idempotencyKey(payload.event_id)), null);
  assert.equal(await prisma.webhookEvent.count({ where: { eventId: payload.event_id } }), 0);
  assert.deepEqual(
    await queue.getJobCounts("wait", "active", "delayed", "completed", "failed"),
    beforeCounts,
  );
});

test("returns 400 for an invalid payload after a valid signature", { timeout: 20_000 }, async () => {
  const raw = JSON.stringify({ event_id: "evt-bad", investor_id: INVESTOR_A_ID });
  const response = await request(app)
    .post("/webhooks/kyc")
    .set("Content-Type", "application/json")
    .set("X-KYC-Signature", signKycBody(Buffer.from(raw), config.kycWebhookSecret))
    .send(raw);

  assert.equal(response.status, 400);
  assert.equal(await prisma.webhookEvent.count(), 0);
});

test("applies a webhook once and ignores a stale replay", { timeout: 20_000 }, async () => {
  const newer = webhookPayload(INVESTOR_A_ID, "approved", "2026-06-20T14:30:00.000Z");
  const accepted = await postWebhook(newer);
  assert.equal(accepted.status, 200);
  assert.equal(readMessage(accepted.text), "Webhook accepted");
  await waitForEvent(newer.event_id);

  const investor = await prisma.investor.findUniqueOrThrow({ where: { id: INVESTOR_A_ID } });
  assert.equal(investor.kyc_status, "approved");

  const duplicate = await postWebhook(newer);
  assert.equal(duplicate.status, 200);
  assert.equal(readMessage(duplicate.text), "Duplicate event ignored");
  assert.equal(await prisma.webhookEvent.count({ where: { eventId: newer.event_id } }), 1);

  const older = webhookPayload(INVESTOR_A_ID, "rejected", "2026-06-19T14:30:00.000Z");
  const stale = await postWebhook(older);
  assert.equal(stale.status, 200);
  assert.equal(readMessage(stale.text), "Webhook accepted");
  await waitForEvent(older.event_id);

  const afterStale = await prisma.investor.findUniqueOrThrow({ where: { id: INVESTOR_A_ID } });
  assert.equal(afterStale.kyc_status, "approved");
  assert.equal(await prisma.webhookEvent.count({ where: { investorId: INVESTOR_A_ID } }), 2);

  const token = bearer(TENANT_A_ID, INVESTOR_A_ID);
  const status = await request(app)
    .get(`/investors/${INVESTOR_A_ID}/kyc-status`)
    .set("Authorization", `Bearer ${token}`);
  assert.equal(status.status, 200);
  const body = readJson(status.text);
  assert.ok(isRecord(body));
  assert.equal(body.last_event_at, newer.timestamp);
  assert.equal(body.kyc_status, "approved");
});

test("rejects a bad signature before parsing invalid JSON", { timeout: 20_000 }, async () => {
  const raw = "{not-json";
  const beforeCounts = await queue.getJobCounts("wait", "active", "delayed", "completed", "failed");
  const response = await request(app)
    .post("/webhooks/kyc")
    .set("Content-Type", "application/json")
    .set("X-KYC-Signature", "not-a-valid-signature")
    .send(raw);

  assert.equal(response.status, 401);
  assert.equal(await prisma.webhookEvent.count(), 0);
  assert.deepEqual(
    await queue.getJobCounts("wait", "active", "delayed", "completed", "failed"),
    beforeCounts,
  );
});

test("does not acknowledge an unknown investor", { timeout: 20_000 }, async () => {
  const payload = webhookPayload("missing-investor", "approved", "2026-06-20T14:30:00.000Z");
  const beforeCounts = await queue.getJobCounts("wait", "active", "delayed", "completed", "failed");
  const response = await postWebhook(payload);

  assert.equal(response.status, 404);
  const body = readJson(response.text);
  assert.equal(isRecord(body) && body.message, "Investor not found");
  assert.equal(await redis.get(idempotencyKey(payload.event_id)), null);
  assert.equal(await prisma.webhookEvent.count({ where: { eventId: payload.event_id } }), 0);
  assert.deepEqual(
    await queue.getJobCounts("wait", "active", "delayed", "completed", "failed"),
    beforeCounts,
  );
});

test("enforces tenant and investor isolation on KYC status", { timeout: 20_000 }, async () => {
  const missing = await request(app).get(`/investors/${INVESTOR_A_ID}/kyc-status`);
  assert.equal(missing.status, 401);

  const tokenA = bearer(TENANT_A_ID, INVESTOR_A_ID);
  const unknown = await request(app)
    .get("/investors/does-not-exist/kyc-status")
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(unknown.status, 404);

  const crossTenant = await request(app)
    .get(`/investors/${INVESTOR_B_ID}/kyc-status`)
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(crossTenant.status, 403);

  const sameTenantOtherInvestor = await request(app)
    .get(`/investors/${INVESTOR_A2_ID}/kyc-status`)
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(sameTenantOtherInvestor.status, 403);

  const ok = await request(app)
    .get(`/investors/${INVESTOR_A_ID}/kyc-status`)
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(ok.status, 200);
  const body = readJson(ok.text);
  assert.ok(isRecord(body));
  assert.equal(body.id, INVESTOR_A_ID);
  assert.equal(body.email, INVESTOR_A_EMAIL);
  assert.equal(body.kyc_status, "pending");
  assert.equal(body.last_event_at, null);
});

function webhookPayload(
  investorId: string,
  status: KycWebhookPayload["new_status"],
  timestamp: string,
): KycWebhookPayload {
  return {
    event_id: `evt-${randomUUID()}`,
    investor_id: investorId,
    new_status: status,
    timestamp,
  };
}

function postWebhook(payload: KycWebhookPayload, signature?: string) {
  const raw = JSON.stringify(payload);
  const header = signature ?? signKycBody(Buffer.from(raw), config.kycWebhookSecret);
  return request(app)
    .post("/webhooks/kyc")
    .set("Content-Type", "application/json")
    .set("X-KYC-Signature", header)
    .send(raw);
}

function bearer(tenantId: string, investorId: string): string {
  return jwt.sign({ tenant_id: tenantId, investor_id: investorId }, config.jwtSecret, {
    algorithm: "HS256",
    expiresIn: "1h",
  });
}

async function waitForEvent(eventId: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const row = await prisma.webhookEvent.findUnique({ where: { eventId } });
    if (row) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${eventId}`);
}

function readJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function readMessage(text: string): string {
  const body = readJson(text);
  if (!isRecord(body) || typeof body.message !== "string") {
    throw new Error(`unexpected response body: ${text}`);
  }
  return body.message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
