import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

import { mobileRoutes } from "../app/routes/mobile.js";

/**
 * Finding F1 (ARCHITECTURE.md): microservice-users owns the player tables that feed the leaderboard,
 * so mobile game results must reach it. This test fails when bff-mobile keeps them in a private store.
 */
describe("player data ownership (F1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("delivers synced mobile game events to microservice-users", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchMock = vi.fn(async (input: unknown, init?: { method?: string }) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      return new Response(
        JSON.stringify({
          profile: { firebaseUid: "p1", email: "p1@axiomnode.es", displayName: "P1", photoUrl: null },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const app = Fastify();
    await mobileRoutes(app, {
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
      USERS_SERVICE_URL: "http://microservice-users:7102",
    });

    await app.inject({
      method: "POST",
      url: "/v1/mobile/games/events",
      headers: { authorization: "Bearer t" },
      payload: {
        events: [{
          gameId: "g1",
          gameType: "quiz",
          categoryId: "c",
          categoryName: "C",
          language: "es",
          outcome: "WON",
          score: 10,
          durationSeconds: 5,
          timestamp: 1_710_000_000_000,
        }],
      },
    });

    const usersWrites = calls.filter((call) => call.url.includes("microservice-users") && call.method !== "GET");
    expect(usersWrites, `calls made: ${JSON.stringify(calls)}`).not.toHaveLength(0);
    await app.close();
  });
});
