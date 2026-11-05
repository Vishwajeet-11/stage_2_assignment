import type { NextFunction, Request, Response } from "express";
import { errorBody } from "../http/responses";
import { logger } from "../lib/logger";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (isInvalidJson(err)) {
    res.status(400).json(errorBody("Invalid webhook payload"));
    return;
  }

  logger.error("Unhandled error", {
    message: err instanceof Error ? err.message : "unknown",
  });
  res.status(500).json(errorBody("Internal server error"));
}

function isInvalidJson(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const record = err as Record<string, unknown>;
  return record.status === 400 && record.type === "entity.parse.failed";
}
