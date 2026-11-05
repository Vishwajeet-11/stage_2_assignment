import { z } from "zod";

export const kycWebhookSchema = z.object({
  event_id: z.string().min(1),
  investor_id: z.string().min(1),
  new_status: z.enum(["pending", "approved", "rejected"]),
  timestamp: z.string().datetime({ offset: true }),
});

export type KycWebhookPayload = z.infer<typeof kycWebhookSchema>;
export type KycStatus = KycWebhookPayload["new_status"];

export interface JwtClaims {
  tenant_id: string;
  investor_id: string;
}

export interface WebhookAckResponse {
  success: true;
  message: string;
}

export interface ErrorBody {
  success: false;
  message: string;
}

export interface KycStatusResponse {
  id: string;
  email: string;
  kyc_status: string;
  last_event_at: string | null;
}

export interface KycJobData {
  eventId: string;
  investorId: string;
  newStatus: KycStatus;
  timestamp: string;
  payload: KycWebhookPayload;
}
