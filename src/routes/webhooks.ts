import type { Request, RequestHandler, Response } from "express";
import { errorBody } from "../http/responses";
import { logger } from "../lib/logger";
import type { AppDeps } from "../deps";
import { acceptKycWebhook } from "../services/kycWebhook";
import { kycWebhookSchema, type WebhookAckResponse } from "../types";

export function kycWebhookHandler(deps: AppDeps): RequestHandler {
  return (req, res, next) => {
    void accept(req, res, deps).catch(next);
  };
}

async function accept(req: Request, res: Response, deps: AppDeps): Promise<void> {
  let parsedJson: unknown;
  try {
    parsedJson = parseJsonBody(req.body);
  } catch {
    res.status(400).json(errorBody("Invalid webhook payload"));
    return;
  }

  const parsed = kycWebhookSchema.safeParse(parsedJson);
  if (!parsed.success) {
    res.status(400).json(errorBody("Invalid webhook payload"));
    return;
  }

  try {
    const result = await acceptKycWebhook(parsed.data, deps);
    if (result.status === "unknown_investor") {
      res.status(404).json(errorBody("Investor not found"));
      return;
    }
    const body: WebhookAckResponse = {
      success: true,
      message: result.status === "duplicate" ? "Duplicate event ignored" : "Webhook accepted",
    };
    res.status(200).json(body);
  } catch (error) {
    logger.error("KYC webhook acceptance failed", {
      eventId: parsed.data.event_id,
      message: error instanceof Error ? error.message : "unknown",
    });
    res.status(500).json(errorBody("Internal server error"));
  }
}

function parseJsonBody(body: unknown): unknown {
  if (Buffer.isBuffer(body)) {
    return JSON.parse(body.toString("utf8")) as unknown;
  }
  return body;
}
