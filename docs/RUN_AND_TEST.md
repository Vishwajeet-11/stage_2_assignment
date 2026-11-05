# Run and test the KYC flow

Node.js 20+ and Docker are required. Commands assume the repo root. The app listens on port 3000. Postgres is on host port 5433 and Redis is on host port 6380.

## 1. Start the service

```bash
docker compose up -d
npm run dev
```

Leave this terminal running. `npm run dev` creates `.env` from `.env.example` if needed, migrates the database, seeds two investors, and starts the API and the worker together.

The seed output includes a one-hour JWT for Investor A. Copy it. If you need a new one, open a second terminal and run:

```bash
npm run token -- 22222222-2222-4222-8222-222222222222
```

Set it in that second terminal:

```bash
export TOKEN='paste-the-jwt-here'
```

| Who | Id | Tenant |
| --- | --- | --- |
| Investor A (ada@tenant-a.example) | `22222222-2222-4222-8222-222222222222` | Tenant A |
| Investor B (ben@tenant-b.example) | `44444444-4444-4444-8444-444444444444` | Tenant B |

## 2. Read the status before any webhook

```bash
curl -s http://localhost:3000/investors/22222222-2222-4222-8222-222222222222/kyc-status \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `200`, `kyc_status` is `pending`, and `last_event_at` is `null`.

## 3. Send a signed approval

The `X-KYC-Signature` header is the hex HMAC-SHA256 of the exact body, using `KYC_WEBHOOK_SECRET` (`dev-webhook-secret` from `.env.example`). The signature is checked before the JSON is parsed.

```bash
BODY='{"event_id":"evt-1","investor_id":"22222222-2222-4222-8222-222222222222","new_status":"approved","timestamp":"2026-06-20T14:30:00Z"}'
SIG=$(node -e 'const c=require("crypto"); process.stdout.write(c.createHmac("sha256","dev-webhook-secret").update(process.argv[1]).digest("hex"))' "$BODY")
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/webhooks/kyc \
  -H "Content-Type: application/json" \
  -H "X-KYC-Signature: $SIG" \
  -d "$BODY"
```

Expected: `200` and `"message":"Webhook accepted"`. The handler returns as soon as the job is queued. Wait about a second, then read the status again with the command from step 2.

Expected after the worker finishes: `kyc_status` is `approved`, and `last_event_at` is `2026-06-20T14:30:00Z`.

## 4. Send the same event again

Run the same `curl` from step 3. Do not change `BODY`.

Expected: `200` and `"message":"Duplicate event ignored"`. `kyc_status` stays `approved`. A second audit row is not written.

## 5. Send an older status

```bash
BODY='{"event_id":"evt-old","investor_id":"22222222-2222-4222-8222-222222222222","new_status":"rejected","timestamp":"2026-06-19T14:30:00Z"}'
SIG=$(node -e 'const c=require("crypto"); process.stdout.write(c.createHmac("sha256","dev-webhook-secret").update(process.argv[1]).digest("hex"))' "$BODY")
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/webhooks/kyc \
  -H "Content-Type: application/json" \
  -H "X-KYC-Signature: $SIG" \
  -d "$BODY"
```

Expected: `200` and `"Webhook accepted"`. After a second, the status read still shows `kyc_status` `approved` and `last_event_at` `2026-06-20T14:30:00Z`. The older event is stored for audit and does not move the status.

## 6. Reject a bad signature

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/webhooks/kyc \
  -H "Content-Type: application/json" \
  -H "X-KYC-Signature: not-a-signature" \
  -d "$BODY"
```

Expected: `401` and `"Invalid signature"`.

A body that is not JSON gets the same `401` when the signature is wrong:

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/webhooks/kyc \
  -H "Content-Type: application/json" \
  -H "X-KYC-Signature: not-a-signature" \
  -d '{not-json'
```

## 7. Reject an unknown investor

```bash
BODY='{"event_id":"evt-missing","investor_id":"does-not-exist","new_status":"approved","timestamp":"2026-06-21T14:30:00Z"}'
SIG=$(node -e 'const c=require("crypto"); process.stdout.write(c.createHmac("sha256","dev-webhook-secret").update(process.argv[1]).digest("hex"))' "$BODY")
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/webhooks/kyc \
  -H "Content-Type: application/json" \
  -H "X-KYC-Signature: $SIG" \
  -d "$BODY"
```

Expected: `404` and `"Investor not found"`. Nothing is queued.

## 8. Check tenant isolation

Investor A's token must not read Investor B:

```bash
curl -s -w "\nHTTP %{http_code}\n" \
  http://localhost:3000/investors/44444444-4444-4444-8444-444444444444/kyc-status \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `403`.

Missing token:

```bash
curl -s -w "\nHTTP %{http_code}\n" \
  http://localhost:3000/investors/22222222-2222-4222-8222-222222222222/kyc-status
```

Expected: `401`.

Unknown id, with Investor A's token:

```bash
curl -s -w "\nHTTP %{http_code}\n" \
  http://localhost:3000/investors/does-not-exist/kyc-status \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `404`.

## 9. Run the automated tests

Postgres and Redis must already be up (`docker compose up -d`). In a second terminal:

```bash
npm test
```

Expected: 6 passing tests. They cover the invalid signature, the duplicate and stale webhook, a bad signature on malformed JSON, an unknown investor, and the 401, 403, and 404 status reads.

## Stop

`Ctrl+C` in the `npm run dev` terminal stops the API and the worker. The database keeps the rows you created. To remove the containers:

```bash
docker compose down
```
