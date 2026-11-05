import { createHmac, timingSafeEqual } from "node:crypto";

export function signKycBody(rawBody: Buffer, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function signaturesMatch(expectedHex: string, providedHeader: string): boolean {
  const provided = Buffer.from(providedHeader.trim(), "utf8");
  const expected = Buffer.from(expectedHex, "utf8");
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}
