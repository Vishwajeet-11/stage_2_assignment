import express, { type Express } from "express";
import type { AppDeps } from "./deps";
import { authenticate } from "./middleware/authenticate";
import { errorHandler } from "./middleware/errorHandler";
import { verifyKycSignature } from "./middleware/verifyKycSignature";
import { getKycStatus } from "./routes/investors";
import { kycWebhookHandler } from "./routes/webhooks";

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");

  // Raw bytes first, so the signature is checked before JSON parsing.
  app.post(
    "/webhooks/kyc",
    express.raw({ type: "*/*", limit: "100kb" }),
    verifyKycSignature(deps.config.kycWebhookSecret),
    kycWebhookHandler(deps),
  );
  app.get(
    "/investors/:id/kyc-status",
    authenticate(deps.config.jwtSecret),
    getKycStatus(deps),
  );
  app.use(errorHandler);
  return app;
}
