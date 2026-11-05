export interface AppConfig {
  databaseUrl: string;
  redisUrl: string;
  kycWebhookSecret: string;
  jwtSecret: string;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    databaseUrl: required(env, "DATABASE_URL"),
    redisUrl: required(env, "REDIS_URL"),
    kycWebhookSecret: required(env, "KYC_WEBHOOK_SECRET"),
    jwtSecret: required(env, "JWT_SECRET"),
    port: parsePort(env.PORT),
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.length === 0) {
    return 3000;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}
