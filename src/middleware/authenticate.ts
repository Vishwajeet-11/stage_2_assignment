import type { Request, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { errorBody } from "../http/responses";
import { logger } from "../lib/logger";
import type { JwtClaims } from "../types";

const claimsByRequest = new WeakMap<Request, JwtClaims>();

export function authenticate(secret: string): RequestHandler {
  return (req, res, next) => {
    const header = req.get("Authorization");
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json(errorBody("Invalid authentication context"));
      return;
    }

    const token = header.slice("Bearer ".length).trim();
    if (token.length === 0) {
      res.status(401).json(errorBody("Invalid authentication context"));
      return;
    }

    try {
      const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
      if (!isJwtClaims(decoded)) {
        res.status(401).json(errorBody("Invalid authentication context"));
        return;
      }
      claimsByRequest.set(req, {
        tenant_id: decoded.tenant_id,
        investor_id: decoded.investor_id,
      });
      next();
    } catch (error) {
      logger.warn("JWT rejected", {
        event: "JWT_REJECTED",
        message: error instanceof Error ? error.message : "invalid token",
      });
      res.status(401).json(errorBody("Invalid authentication context"));
    }
  };
}

export function claimsFor(req: Request): JwtClaims | undefined {
  return claimsByRequest.get(req);
}

function isJwtClaims(value: unknown): value is JwtClaims {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("tenant_id" in value) || !("investor_id" in value)) {
    return false;
  }
  return (
    typeof value.tenant_id === "string" &&
    value.tenant_id.length > 0 &&
    typeof value.investor_id === "string" &&
    value.investor_id.length > 0
  );
}
