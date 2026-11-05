import type { Prisma } from "@prisma/client";

export interface ProviderTimestamp {
  ms: number;
  value: string;
}

export function readProviderTimestamp(payload: Prisma.JsonValue): ProviderTimestamp | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const timestamp = payload.timestamp;
  if (typeof timestamp !== "string") {
    return null;
  }
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) {
    return null;
  }
  return { ms, value: timestamp };
}
