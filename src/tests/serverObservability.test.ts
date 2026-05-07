import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildServer } from "../app/server.js";

let tempDir = "";

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "axiomnode-bff-mobile-observability-"));
  vi.stubEnv("SERVICE_NAME", "bff-mobile");
  vi.stubEnv("SERVICE_PORT", "7010");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("ALLOWED_ORIGINS", "http://localhost:3000");
  vi.stubEnv("QUIZZ_SERVICE_URL", "http://microservice-quizz:7100");
  vi.stubEnv("WORDPASS_SERVICE_URL", "http://microservice-wordpass:7101");
  vi.stubEnv("USERS_SERVICE_URL", "http://microservice-users:7102");
  vi.stubEnv("PLAYER_DB_FILE", ":memory:");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = "";
  }
});

describe("server observability", () => {
  it("records completed requests in recent logs with structured context", async () => {
    const { app, metrics } = await buildServer();

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(metrics.recentLogs()).toHaveLength(0);

    const stats = await app.inject({
      method: "GET",
      url: "/monitor/stats",
      headers: { "x-correlation-id": "mobile-correlation" },
    });
    expect(stats.statusCode).toBe(200);

    expect(metrics.recentLogs()).toEqual([
      expect.objectContaining({
        level: "info",
        message: "request_completed",
        context: expect.objectContaining({
          correlation_id: "mobile-correlation",
          method: "GET",
          route: "/monitor/stats",
          status_code: 200,
        }),
      }),
    ]);

    await app.close();
  });
});
