import type { FastifyInstance } from "fastify";

/** @module health — Liveness health-check endpoint for the BFF-Mobile service. */

/** Registers the /health route returning service status. */
export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    return {
      status: "ok",
      service: "bff-mobile",
      timestamp: new Date().toISOString(),
    };
  });
}
