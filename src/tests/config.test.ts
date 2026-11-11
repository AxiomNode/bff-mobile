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
      TRUST_PROXY: "false",
      RATE_LIMIT_MAX: 120,
      RATE_LIMIT_WINDOW_MS: 60000,
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

  it("accepts TRUST_PROXY and rate limit overrides", () => {
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv("TRUST_PROXY", "10.0.0.0/8,loopback");
    vi.stubEnv("RATE_LIMIT_MAX", "0");
    vi.stubEnv("RATE_LIMIT_WINDOW_MS", "5000");

    expect(loadConfig()).toMatchObject({
      TRUST_PROXY: "10.0.0.0/8,loopback",
      RATE_LIMIT_MAX: 0,
      RATE_LIMIT_WINDOW_MS: 5000,
    });
  });

  it.each([
    ["TRUST_PROXY", "not-an-ip"],
    ["RATE_LIMIT_MAX", "-1"],
    ["RATE_LIMIT_WINDOW_MS", "10"],
  ])("rejects invalid %s=%s", (key, value) => {
    for (const [envKey, envValue] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(envKey, envValue);
    }
    vi.stubEnv(key, value);

    expect(() => loadConfig()).toThrow();
  });
});
