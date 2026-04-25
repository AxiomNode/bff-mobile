import { describe, expect, it, vi } from "vitest";

import Fastify from "fastify";
import { mobileRoutes } from "../app/routes/mobile.js";

function createUnsignedJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}

describe("mobile routes", () => {
  it("returns merged categories and languages from quiz and wordpass catalogs", async () => {
    const app = Fastify();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            source: "ai-engine",
            categories: [
              { id: "ciencia", name: "Ciencia" },
              { id: "historia", name: "Historia" },
            ],
            languages: [
              { code: "es", name: "Español" },
              { code: "en", name: "English" },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            source: "ai-engine",
            categories: [
              { id: "historia", name: "Historia" },
              { id: "deportes", name: "Deportes" },
            ],
            languages: [
              { code: "es", name: "Español" },
              { code: "fr", name: "Français" },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    await mobileRoutes(app, {
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/mobile/games/categories",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      categories: [
        { id: "ciencia", name: "Ciencia" },
        { id: "historia", name: "Historia" },
        { id: "deportes", name: "Deportes" },
      ],
      languages: [
        { code: "es", name: "Español" },
        { code: "en", name: "English" },
        { code: "fr", name: "Français" },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://microservice-quizz:7100/catalogs",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://microservice-wordpass:7101/catalogs",
      expect.objectContaining({ method: "GET" }),
    );

    vi.unstubAllGlobals();
    await app.close();
  });

  it("upserts and retrieves player profile from mobile endpoint", async () => {
    const app = Fastify();
    const token = createUnsignedJwt({
      sub: "player-123",
      email: "player@axiomnode.es",
      name: "Player One",
      picture: "https://cdn.example.com/player-one.png",
    });

    await mobileRoutes(app, {
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    });

    const upsertResponse = await app.inject({
      method: "PUT",
      url: "/v1/mobile/player/profile",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        preferredLanguage: "es",
      },
    });

    const getResponse = await app.inject({
      method: "GET",
      url: "/v1/mobile/player/profile",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(upsertResponse.statusCode).toBe(200);
    expect(upsertResponse.json()).toMatchObject({
      profile: {
        playerId: "player-123",
        email: "player@axiomnode.es",
        displayName: "Player One",
        photoUrl: "https://cdn.example.com/player-one.png",
        preferredLanguage: "es",
      },
      stats: {
        totalGames: 0,
      },
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toMatchObject({
      profile: {
        playerId: "player-123",
        email: "player@axiomnode.es",
      },
      stats: {
        totalGames: 0,
      },
    });

    await app.close();
  });

  it("syncs mobile game events and returns aggregated player stats", async () => {
    const app = Fastify();
    const token = createUnsignedJwt({
      sub: "player-222",
      email: "player2@axiomnode.es",
      name: "Player Two",
    });

    await mobileRoutes(app, {
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    });

    const syncResponse = await app.inject({
      method: "POST",
      url: "/v1/mobile/games/events",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        events: [
          {
            gameId: "game-1",
            gameType: "quiz",
            categoryId: "ciencia",
            categoryName: "Ciencia",
            language: "es",
            outcome: "WON",
            score: 90,
            durationSeconds: 120,
            timestamp: 1_710_000_000_000,
          },
          {
            gameId: "game-2",
            gameType: "wordpass",
            categoryId: "historia",
            categoryName: "Historia",
            language: "es",
            outcome: "LOST",
            score: 30,
            durationSeconds: 75,
            timestamp: 1_710_000_050_000,
          },
        ],
      },
    });

    const summaryResponse = await app.inject({
      method: "GET",
      url: "/v1/mobile/player/profile",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(syncResponse.statusCode).toBe(200);
    expect(syncResponse.json()).toMatchObject({
      synced: 2,
      stats: {
        totalGames: 2,
        wins: 1,
        losses: 1,
        draws: 0,
        averageScore: 60,
        totalPlayTimeSeconds: 195,
      },
    });
    expect(summaryResponse.statusCode).toBe(200);
    expect(summaryResponse.json()).toMatchObject({
      stats: {
        totalGames: 2,
      },
    });

    await app.close();
  });

  it("rejects profile and game-event routes without a player identity", async () => {
    const app = Fastify();

    await mobileRoutes(app, {
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    });

    const getResponse = await app.inject({
      method: "GET",
      url: "/v1/mobile/player/profile",
    });
    const syncResponse = await app.inject({
      method: "POST",
      url: "/v1/mobile/games/events",
      payload: { events: [] },
    });

    expect(getResponse.statusCode).toBe(401);
    expect(syncResponse.statusCode).toBe(401);

    await app.close();
  });

  it("returns catalog from available service when the other one fails", async () => {
    const app = Fastify();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("upstream down", {
          status: 503,
          headers: { "content-type": "text/plain" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            categories: [{ id: "deportes", name: "Deportes" }],
            languages: [{ code: "es", name: "Español" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    await mobileRoutes(app, {
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/mobile/games/categories",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      categories: [{ id: "deportes", name: "Deportes" }],
      languages: [{ code: "es", name: "Español" }],
    });

    vi.unstubAllGlobals();
    await app.close();
  });

  it("returns 502 when both upstream catalogs fail", async () => {
    const app = Fastify();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("quiz down", { status: 502 }))
      .mockResolvedValueOnce(new Response("wordpass down", { status: 500 }));

    vi.stubGlobal("fetch", fetchMock);

    await mobileRoutes(app, {
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/mobile/games/categories",
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      message: "Failed to load game catalogs from upstream services",
    });

    vi.unstubAllGlobals();
    await app.close();
  });

  it("forwards quiz random to microservice-quizz", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ source: "quiz" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await mobileRoutes(app, {
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/mobile/games/quiz/random?language=es&categoryId=42",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ source: "quiz" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://microservice-quizz:7100/games/models/random?language=es&categoryId=42",
      expect.objectContaining({ method: "GET" }),
    );

    vi.unstubAllGlobals();
    await app.close();
  });

  it("forwards wordpass random to microservice-wordpass", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ source: "wordpass" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await mobileRoutes(app, {
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/mobile/games/wordpass/random?language=en",
      headers: { "x-correlation-id": "corr-2" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ source: "wordpass" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://microservice-wordpass:7101/games/models/random?language=en",
      expect.objectContaining({ method: "GET" }),
    );

    vi.unstubAllGlobals();
    await app.close();
  });

  it("builds quiz generation from microservice model inventory with auth headers", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ id: "quiz-model-1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await mobileRoutes(app, {
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/mobile/games/quiz/generate",
      headers: {
        authorization: "Bearer user-token",
        "x-correlation-id": "corr-mobile-post",
      },
      payload: {
        language: "es",
        categoryId: "9",
        difficultyPercentage: 60,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://microservice-quizz:7100/games/models/random?language=es&categoryId=9",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer user-token",
          "x-correlation-id": "corr-mobile-post",
        }),
      }),
    );

    vi.unstubAllGlobals();
    await app.close();
  });

  it("rejects invalid quiz generation payloads before proxying", async () => {
    const app = Fastify();

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await mobileRoutes(app, {
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/mobile/games/quiz/generate",
      payload: {
        language: "es",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ message: "Invalid payload" });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    await app.close();
  });

  it("rejects invalid random query parameters before proxying", async () => {
    const app = Fastify();

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await mobileRoutes(app, {
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    });

    const quizResponse = await app.inject({
      method: "GET",
      url: "/v1/mobile/games/quiz/random?difficultyPercentage=101",
    });
    const wordpassResponse = await app.inject({
      method: "GET",
      url: "/v1/mobile/games/wordpass/random?difficultyPercentage=-1",
    });

    expect(quizResponse.statusCode).toBe(400);
    expect(quizResponse.json()).toMatchObject({ message: "Invalid query parameters" });
    expect(wordpassResponse.statusCode).toBe(400);
    expect(wordpassResponse.json()).toMatchObject({ message: "Invalid query parameters" });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    await app.close();
  });

  it("forwards empty random queries and rejects missing generation payloads", async () => {
    const app = Fastify();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ source: "quiz-empty" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ source: "wordpass-empty" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await mobileRoutes(app, {
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
      UPSTREAM_TIMEOUT_MS: 12345,
      UPSTREAM_GENERATION_TIMEOUT_MS: 54321,
    });

    const quizRandom = await app.inject({
      method: "GET",
      url: "/v1/mobile/games/quiz/random",
    });
    const wordpassRandom = await app.inject({
      method: "GET",
      url: "/v1/mobile/games/wordpass/random",
    });
    const quizGenerate = await app.inject({
      method: "POST",
      url: "/v1/mobile/games/quiz/generate",
    });
    const wordpassGenerate = await app.inject({
      method: "POST",
      url: "/v1/mobile/games/wordpass/generate",
    });

    expect(quizRandom.statusCode).toBe(200);
    expect(quizRandom.json()).toEqual({ source: "quiz-empty" });
    expect(wordpassRandom.statusCode).toBe(200);
    expect(wordpassRandom.json()).toEqual({ source: "wordpass-empty" });
    expect(quizGenerate.statusCode).toBe(400);
    expect(wordpassGenerate.statusCode).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://microservice-quizz:7100/games/models/random");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://microservice-wordpass:7101/games/models/random");

    vi.unstubAllGlobals();
    await app.close();
  });

  it("builds wordpass generation from microservice model inventory", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ id: "wordpass-model-1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await mobileRoutes(app, {
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/mobile/games/wordpass/generate",
      payload: {
        language: "es",
        categoryId: "9",
        requestedBy: "api",
        letters: "abc",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://microservice-wordpass:7101/games/models/random?language=es&categoryId=9",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "GET",
      }),
    );

    vi.unstubAllGlobals();
    await app.close();
  });

  it("rejects invalid wordpass generation payloads before proxying", async () => {
    const app = Fastify();

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await mobileRoutes(app, {
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/mobile/games/wordpass/generate",
      payload: {
        letters: "abc",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ message: "Invalid payload" });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    await app.close();
  });

  it("forwards critical headers when building quiz generation from inventory", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ id: "quiz-model-2" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await mobileRoutes(app, {
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/mobile/games/quiz/generate",
      headers: {
        authorization: "Bearer user-token",
        "x-correlation-id": "corr-mobile-critical",
        "x-firebase-id-token": "firebase-mobile-token",
        "x-api-key": "mobile-ai-key",
      },
      payload: {
        language: "es",
        categoryId: "9",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://microservice-quizz:7100/games/models/random?language=es&categoryId=9",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer user-token",
          "x-correlation-id": "corr-mobile-critical",
          "x-firebase-id-token": "firebase-mobile-token",
          "x-api-key": "mobile-ai-key",
        }),
      }),
    );

    vi.unstubAllGlobals();
    await app.close();
  });
});
