import { z } from "zod";

import { DEFAULT_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_WINDOW_MS } from "./plugins/rateLimit.js";
import { parseTrustProxy } from "./plugins/trustProxy.js";

function isValidTrustProxy(value: string): boolean {
  try {
    parseTrustProxy(value);
    return true;
  } catch {
    return false;
  }
}

/** @module config — Environment-based configuration loader for the BFF-Mobile service. */

const envSchema = z.object({
  SERVICE_NAME: z.string().min(1),
  SERVICE_PORT: z.coerce.number().int().positive(),
  ALLOWED_ORIGINS: z.string().min(1),
  QUIZZ_SERVICE_URL: z.string().url(),
  WORDPASS_SERVICE_URL: z.string().url(),
  USERS_SERVICE_URL: z.string().url().default("http://localhost:7102"),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),
  UPSTREAM_GENERATION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(120000),
  METRICS_LOG_BUFFER_SIZE: z.coerce.number().int().min(50).max(5000).default(1000),
  TRUST_PROXY: z.string().default("false").refine(isValidTrustProxy, {
    message: "TRUST_PROXY must be true/false, a hop count, or a comma-separated list of IPs/CIDRs",
  }),
  RATE_LIMIT_MAX: z.coerce.number().int().min(0).max(1_000_000).default(DEFAULT_RATE_LIMIT_MAX),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3_600_000).default(DEFAULT_RATE_LIMIT_WINDOW_MS),
});

type ParsedConfig = z.infer<typeof envSchema>;

/** Application configuration type with optional override fields. */
export type AppConfig = Omit<ParsedConfig, "METRICS_LOG_BUFFER_SIZE" | "UPSTREAM_TIMEOUT_MS" | "UPSTREAM_GENERATION_TIMEOUT_MS" | "USERS_SERVICE_URL" | "TRUST_PROXY" | "RATE_LIMIT_MAX" | "RATE_LIMIT_WINDOW_MS"> & {
  METRICS_LOG_BUFFER_SIZE?: number;
  UPSTREAM_TIMEOUT_MS?: number;
  UPSTREAM_GENERATION_TIMEOUT_MS?: number;
  USERS_SERVICE_URL?: string;
  TRUST_PROXY?: string;
  RATE_LIMIT_MAX?: number;
  RATE_LIMIT_WINDOW_MS?: number;
};

/** Parses and validates environment variables into a typed config object. */
export function loadConfig(): AppConfig {
  return envSchema.parse(process.env);
}
