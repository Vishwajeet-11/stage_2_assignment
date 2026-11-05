import type { Request, RequestHandler, Response } from "express";
import { errorBody } from "../http/responses";
import { readProviderTimestamp } from "../lib/eventTime";
import { logger } from "../lib/logger";
import { claimsFor } from "../middleware/authenticate";
import type { AppDeps } from "../deps";
import type { KycStatusResponse } from "../types";

export function getKycStatus(deps: AppDeps): RequestHandler {
  return (req, res, next) => {
    void readStatus(req, res, deps).catch(next);
  };
}

async function readStatus(req: Request, res: Response, deps: AppDeps): Promise<void> {
  const claims = claimsFor(req);
  if (!claims) {
    res.status(401).json(errorBody("Invalid authentication context"));
    return;
  }

  const investorId = routeParam(req.params.id);
  if (!investorId) {
    res.status(400).json(errorBody("Invalid investor id"));
    return;
  }

  const investor = await deps.prisma.investor.findUnique({ where: { id: investorId } });
  if (!investor) {
    res.status(404).json(errorBody("Investor not found"));
    return;
  }

  const tenantMismatch = investor.tenant_id !== claims.tenant_id;
  const investorMismatch = investor.id !== claims.investor_id;
  if (tenantMismatch || investorMismatch) {
    logger.warn("Investor KYC access denied", {
      event: tenantMismatch ? "CROSS_TENANT_ACCESS_ATTEMPT" : "INVESTOR_CLAIM_MISMATCH",
      tenantId: claims.tenant_id,
      investorId: claims.investor_id,
      resourceId: investorId,
    });
    res.status(403).json(errorBody("Forbidden"));
    return;
  }

  const events = await deps.prisma.webhookEvent.findMany({
    where: { investorId: investor.id },
    select: { payload: true },
  });
  let lastEventAt: string | null = null;
  let newestMs = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    const timestamp = readProviderTimestamp(event.payload);
    if (timestamp !== null && timestamp.ms >= newestMs) {
      newestMs = timestamp.ms;
      lastEventAt = timestamp.value;
    }
  }

  const body: KycStatusResponse = {
    id: investor.id,
    email: investor.email,
    kyc_status: investor.kyc_status,
    last_event_at: lastEventAt,
  };
  res.status(200).json(body);
}

function routeParam(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
}
