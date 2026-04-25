import { z } from "zod";

/** @module config — Environment-based configuration loader for the BFF-Mobile service. */

const envSchema = z.object({
  SERVICE_NAME: z.string().min(1),
  SERVICE_PORT: z.coerce.number().int().positive(),
  ALLOWED_ORIGINS: z.string().min(1),
  QUIZZ_SERVICE_URL: z.string().url(),
  WORDPASS_SERVICE_URL: z.string().url(),
  USERS_SERVICE_URL: z.string().url().default("http://localhost:7102"),
  PLAYER_DB_FILE: z.string().min(1).default("./data/player-db.json"),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),
  UPSTREAM_GENERATION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(120000),
  METRICS_LOG_BUFFER_SIZE: z.coerce.number().int().min(50).max(5000).default(1000),
});

type ParsedConfig = z.infer<typeof envSchema>;

/** Application configuration type with optional override fields. */
export type AppConfig = Omit<ParsedConfig, "METRICS_LOG_BUFFER_SIZE" | "UPSTREAM_TIMEOUT_MS" | "UPSTREAM_GENERATION_TIMEOUT_MS" | "PLAYER_DB_FILE" | "USERS_SERVICE_URL"> & {
  METRICS_LOG_BUFFER_SIZE?: number;
  UPSTREAM_TIMEOUT_MS?: number;
  UPSTREAM_GENERATION_TIMEOUT_MS?: number;
  PLAYER_DB_FILE?: string;
  USERS_SERVICE_URL?: string;
};

/** Parses and validates environment variables into a typed config object. */
export function loadConfig(): AppConfig {
  return envSchema.parse(process.env);
}
