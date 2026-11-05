import type { Request, RequestHandler } from "express";
import { errorBody } from "../http/responses";
import { signKycBody, signaturesMatch } from "../lib/hmac";
import { logger } from "../lib/logger";

export function verifyKycSignature(secret: string): RequestHandler {
  return (req, res, next) => {
    const header = req.get("X-KYC-Signature");
    const rawBody = Buffer.isBuffer(req.body) ? req.body : undefined;
    if (!header || rawBody === undefined) {
      logRejection(req, "missing");
      res.status(401).json(errorBody("Invalid signature"));
      return;
    }

    const expected = signKycBody(rawBody, secret);
    if (!signaturesMatch(expected, header)) {
      logRejection(req, "mismatch");
      res.status(401).json(errorBody("Invalid signature"));
      return;
    }

    next();
  };
}

function logRejection(req: Request, reason: "missing" | "mismatch"): void {
  logger.warn("KYC webhook signature rejected", {
    event: "KYC_SIGNATURE_REJECTED",
    reason,
    eventId: eventIdFromBody(req.body),
  });
}

function eventIdFromBody(body: unknown): string | null {
  let parsed: unknown = body;
  if (Buffer.isBuffer(body)) {
    try {
      parsed = JSON.parse(body.toString("utf8")) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof parsed !== "object" || parsed === null || !("event_id" in parsed)) {
    return null;
  }
  const eventId = parsed.event_id;
  return typeof eventId === "string" ? eventId : null;
}
