import { z } from "zod";

const envSchema = z.object({
  SERVICE_NAME: z.string().min(1),
  SERVICE_PORT: z.coerce.number().int().positive(),
  ALLOWED_ORIGINS: z.string().min(1),
  QUIZZ_SERVICE_URL: z.string().url(),
  WORDPASS_SERVICE_URL: z.string().url(),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),
  METRICS_LOG_BUFFER_SIZE: z.coerce.number().int().min(50).max(5000).default(1000),
});

type ParsedConfig = z.infer<typeof envSchema>;

export type AppConfig = Omit<ParsedConfig, "METRICS_LOG_BUFFER_SIZE" | "UPSTREAM_TIMEOUT_MS"> & {
  METRICS_LOG_BUFFER_SIZE?: number;
  UPSTREAM_TIMEOUT_MS?: number;
};

export function loadConfig(): AppConfig {
  return envSchema.parse(process.env);
}
