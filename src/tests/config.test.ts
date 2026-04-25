import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../app/config.js";

const REQUIRED_ENV = {
  SERVICE_NAME: "bff-mobile",
  SERVICE_PORT: "7010",
  ALLOWED_ORIGINS: "http://localhost:3000",
  QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
  WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
} as const;

describe("loadConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads required values and applies defaults", () => {
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(key, value);
    }

    const config = loadConfig();

    expect(config).toMatchObject({
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
      PLAYER_DB_FILE: "./data/player-db.json",
      UPSTREAM_TIMEOUT_MS: 15000,
      UPSTREAM_GENERATION_TIMEOUT_MS: 120000,
      METRICS_LOG_BUFFER_SIZE: 1000,
    });
  });

  it("rejects invalid environment values", () => {
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv("SERVICE_PORT", "0");
    vi.stubEnv("QUIZZ_SERVICE_URL", "not-a-url");

    expect(() => loadConfig()).toThrow();
  });
});