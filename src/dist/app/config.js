import { z } from "zod";
const envSchema = z.object({
    SERVICE_NAME: z.string().min(1),
    SERVICE_PORT: z.coerce.number().int().positive(),
    ALLOWED_ORIGINS: z.string().min(1),
    QUIZZ_SERVICE_URL: z.string().url(),
    WORDPASS_SERVICE_URL: z.string().url(),
    METRICS_LOG_BUFFER_SIZE: z.coerce.number().int().min(50).max(5000).default(1000),
});
export function loadConfig() {
    return envSchema.parse(process.env);
}
