import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Fastify from "fastify";

import { mobileRoutes } from "../app/routes/mobile.js";
import { buildServer } from "../app/server.js";

const BASE_CONFIG = {
  SERVICE_NAME: "bff-mobile",
  SERVICE_PORT: 7010,
  ALLOWED_ORIGINS: "http://localhost:3000",
  QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
  WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
  USERS_SERVICE_URL: "http://microservice-users:7102",
  PLAYER_DB_FILE: ":memory:",
};

const ROUTES: Array<{ method: "GET" | "PUT" | "POST"; url: string }> = [
  { method: "GET", url: "/v1/mobile/player/profile" },
  { method: "PUT", url: "/v1/mobile/player/profile" },
  { method: "POST", url: "/v1/mobile/games/events" },
  { method: "GET", url: "/v1/mobile/games/categories" },
  { method: "GET", url: "/v1/mobile/games/quiz/random" },
  { method: "GET", url: "/v1/mobile/games/wordpass/random" },
  { method: "POST", url: "/v1/mobile/games/quiz/generate" },
  { method: "POST", url: "/v1/mobile/games/wordpass/generate" },
];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ message: "down" }), { status: 500 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("mobile routes rate limiting", () => {
  it.each(ROUTES)("limits $method $url per client IP", async ({ method, url }) => {
    const app = Fastify();
    await mobileRoutes(app, { ...BASE_CONFIG, RATE_LIMIT_MAX: 1, RATE_LIMIT_WINDOW_MS: 60000 });

    const first = await app.inject({ method, url, payload: method === "GET" ? undefined : {} });
    expect(first.statusCode).not.toBe(429);

    const second = await app.inject({ method, url, payload: method === "GET" ? undefined : {} });
    expect(second.statusCode).toBe(429);
    expect(second.headers["retry-after"]).toBeDefined();

    // A different client IP keeps its own budget.
    const other = await app.inject({
      method,
      url,
      payload: method === "GET" ? undefined : {},
      remoteAddress: "10.20.30.40",
    });
    expect(other.statusCode).not.toBe(429);
    await app.close();
  });

  it("applies the documented defaults when no limits are configured", async () => {
    const app = Fastify();
    await mobileRoutes(app, BASE_CONFIG);

    const response = await app.inject({ method: "GET", url: "/v1/mobile/games/categories" });
    expect(response.headers["x-ratelimit-limit"]).toBe("120");
    await app.close();
  });

  it("can be disabled with RATE_LIMIT_MAX=0", async () => {
    const app = Fastify();
    await mobileRoutes(app, { ...BASE_CONFIG, RATE_LIMIT_MAX: 0 });

    for (let i = 0; i < 3; i += 1) {
      const response = await app.inject({ method: "GET", url: "/v1/mobile/games/categories" });
      expect(response.statusCode).not.toBe(429);
    }
    await app.close();
  });
});

describe("buildServer trust proxy wiring", () => {
  function stubServerEnv(overrides: Record<string, string> = {}) {
    const env = {
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: "7010",
      NODE_ENV: "test",
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      PLAYER_DB_FILE: ":memory:",
      RATE_LIMIT_MAX: "1",
      ...overrides,
    };
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value);
    }
  }

  async function statuses(forwardedFor: string[]) {
    const { app } = await buildServer();
    const result: number[] = [];
    for (const address of forwardedFor) {
      const response = await app.inject({
        method: "GET",
        url: "/v1/mobile/games/categories",
        remoteAddress: "10.0.0.9",
        headers: { "x-forwarded-for": address },
      });
      result.push(response.statusCode === 429 ? 429 : 0);
    }
    await app.close();
    return result;
  }

  it("shares one bucket behind a proxy by default (TRUST_PROXY unset)", async () => {
    stubServerEnv();
    expect(await statuses(["203.0.113.1", "203.0.113.2"])).toEqual([0, 429]);
  });

  it("separates clients when TRUST_PROXY trusts the proxy hop", async () => {
    stubServerEnv({ TRUST_PROXY: "1" });
    expect(await statuses(["203.0.113.1", "203.0.113.2", "203.0.113.1"])).toEqual([0, 0, 429]);
  });

  it("fails startup on an invalid TRUST_PROXY value", async () => {
    stubServerEnv({ TRUST_PROXY: "not-an-ip" });
    await expect(buildServer()).rejects.toThrow();
  });
});
