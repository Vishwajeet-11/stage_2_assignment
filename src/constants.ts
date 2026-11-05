import { createHash } from "node:crypto";

export const KYC_PROVIDER = "kyc";
export const KYC_QUEUE_NAME = "kyc-status";
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

export function idempotencyKey(eventId: string): string {
  return `kyc:event:${eventId}`;
}

export function bullJobId(eventId: string): string {
  if (!eventId.includes(":")) {
    return eventId;
  }
  return createHash("sha256").update(eventId).digest("hex");
}
