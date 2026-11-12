import "dotenv/config";

import cors from "@fastify/cors";
import Fastify from "fastify";
import { registerHttpMetricsHooks } from "@axiomnode/shared-sdk-client/http-service-metrics";
import { isUpstreamTimeoutError, configureHttpAgent } from "@axiomnode/shared-sdk-client/proxy";

import { loadConfig } from "./config.js";
import { parseTrustProxy } from "./plugins/trustProxy.js";
import { healthRoutes } from "./routes/health.js";
import { mobileRoutes } from "./routes/mobile.js";
import { monitoringRoutes } from "./routes/monitoring.js";
import { ServiceMetrics } from "./services/serviceMetrics.js";

configureHttpAgent();

/** @module server — Fastify-based BFF-Mobile server with CORS, metrics, and game routes. */

export async function buildServer() {
  const config = loadConfig();
  const app = Fastify({ logger: true, trustProxy: parseTrustProxy(config.TRUST_PROXY) });
  const metrics = new ServiceMetrics(config);

  const allowedOrigins = config.ALLOWED_ORIGINS.split(",").map((v) => v.trim());
  await app.register(cors, { origin: allowedOrigins });

  registerHttpMetricsHooks(app, { metrics, serviceName: config.SERVICE_NAME });

  await healthRoutes(app);
  await monitoringRoutes(app, metrics);
  await mobileRoutes(app, config);

  app.setErrorHandler((error, _request, reply) => {
    if (isUpstreamTimeoutError(error)) {
      reply.status(504).send({
        message: "Upstream request timed out",
        error: error instanceof Error ? error.message : "Timeout",
      });
      return;
    }

    // @fastify/rate-limit throws a plain object (not an Error) carrying `statusCode`; Fastify would send it as 200.
    if (!(error instanceof Error) && typeof (error as { statusCode?: unknown }).statusCode === "number") {
      reply.status((error as { statusCode: number }).statusCode).send(error);
      return;
    }

    reply.send(error);
  });

  return { app, config, metrics };
}

async function main() {
  const { app, config, metrics } = await buildServer();
  await app.listen({ host: "0.0.0.0", port: config.SERVICE_PORT });
  metrics.recordLog("info", "bff_mobile_started", { port: config.SERVICE_PORT });
  app.log.info({ service: config.SERVICE_NAME }, "BFF mobile started");
}

const isDirectRun = (() => {
  try {
    const entryUrl = new URL(`file://${process.argv[1] ?? ""}`).href;
    return import.meta.url === entryUrl;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
