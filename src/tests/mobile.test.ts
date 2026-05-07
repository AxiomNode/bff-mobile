import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Fastify from "fastify";
import { mobileRoutes } from "../app/routes/mobile.js";
import { PlayerStore } from "../app/services/playerStore.js";

describe("mobile routes", () => {
  it("returns merged categories from quiz and wordpass catalogs", async () => {
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
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          profile: {
            firebaseUid: "player-123",
            email: "player@axiomnode.es",
            displayName: "Player One",
            photoUrl: "https://cdn.example.com/player-one.png",
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          profile: {
            firebaseUid: "player-123",
            email: "player@axiomnode.es",
            displayName: "Player One",
            photoUrl: "https://cdn.example.com/player-one.png",
          },
        }), {
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

    const upsertResponse = await app.inject({
      method: "PUT",
      url: "/v1/mobile/player/profile",
      headers: {
        authorization: "Bearer verified-user-token",
      },
      payload: {
        preferredLanguage: "es",
      },
    });

    const getResponse = await app.inject({
      method: "GET",
      url: "/v1/mobile/player/profile",
      headers: {
        authorization: "Bearer verified-user-token",
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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:7102/users/me/profile");

    vi.unstubAllGlobals();
    await app.close();
  });

  it("syncs mobile game events and returns aggregated player stats", async () => {
    const app = Fastify();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          profile: {
            firebaseUid: "player-222",
            email: "player2@axiomnode.es",
            displayName: "Player Two",
            photoUrl: null,
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          profile: {
            firebaseUid: "player-222",
            email: "player2@axiomnode.es",
            displayName: "Player Two",
            photoUrl: null,
          },
        }), {
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

    const syncResponse = await app.inject({
      method: "POST",
      url: "/v1/mobile/games/events",
      headers: {
        authorization: "Bearer verified-user-token",
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
        authorization: "Bearer verified-user-token",
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

    vi.unstubAllGlobals();

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
    const updateResponse = await app.inject({
      method: "PUT",
      url: "/v1/mobile/player/profile",
      payload: { preferredLanguage: "es" },
    });

    expect(getResponse.statusCode).toBe(401);
    expect(syncResponse.statusCode).toBe(401);
    expect(updateResponse.statusCode).toBe(401);

    await app.close();
  });

  it("surfaces player identity upstream failures", async () => {
    const app = Fastify();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
      .mockResolvedValueOnce(new Response("users down", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ profile: { firebaseUid: "" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockRejectedValueOnce(new Error("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    await mobileRoutes(app, {
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
      PLAYER_DB_FILE: ":memory:",
    });

    const unauthorized = await app.inject({
      method: "GET",
      url: "/v1/mobile/player/profile",
      headers: { authorization: "Bearer denied" },
    });
    const upstreamError = await app.inject({
      method: "GET",
      url: "/v1/mobile/player/profile",
      headers: { authorization: "Bearer upstream-error" },
    });
    const invalidProfile = await app.inject({
      method: "GET",
      url: "/v1/mobile/player/profile",
      headers: { authorization: "Bearer invalid-profile" },
    });
    const networkError = await app.inject({
      method: "GET",
      url: "/v1/mobile/player/profile",
      headers: { authorization: "Bearer network-error" },
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(upstreamError.statusCode).toBe(502);
    expect(upstreamError.json()).toMatchObject({ error: "users down" });
    expect(invalidProfile.statusCode).toBe(502);
    expect(invalidProfile.json()).toMatchObject({ error: "Invalid users profile response" });
    expect(networkError.statusCode).toBe(502);
    expect(networkError.json()).toMatchObject({ error: "network unavailable" });

    vi.unstubAllGlobals();
    await app.close();
  });

  it("rejects blank firebase auth hints as invalid upstream profiles", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ profile: { firebaseUid: "" } }), {
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
      PLAYER_DB_FILE: ":memory:",
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/mobile/player/profile",
      headers: {
        "x-dev-firebase-uid": "   ",
        "x-firebase-id-token": "   ",
      },
    });

    expect(response.statusCode).toBe(502);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-dev-firebase-uid": "   ",
          "x-firebase-id-token": "   ",
        }),
      }),
    );

    vi.unstubAllGlobals();
    await app.close();
  });

  it("rejects invalid authenticated profile and event payloads before persisting", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({
        profile: {
          firebaseUid: "player-invalid-payload",
          email: "player@axiomnode.es",
          displayName: "Invalid Payload Player",
          photoUrl: null,
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ));
    vi.stubGlobal("fetch", fetchMock);

    await mobileRoutes(app, {
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
      PLAYER_DB_FILE: ":memory:",
    });

    const profileResponse = await app.inject({
      method: "PUT",
      url: "/v1/mobile/player/profile",
      headers: { authorization: "Bearer verified-user-token" },
      payload: { email: "not-an-email" },
    });
    const eventsResponse = await app.inject({
      method: "POST",
      url: "/v1/mobile/games/events",
      headers: { authorization: "Bearer verified-user-token" },
      payload: { events: [] },
    });

    expect(profileResponse.statusCode).toBe(400);
    expect(profileResponse.json()).toMatchObject({ message: "Invalid payload" });
    expect(eventsResponse.statusCode).toBe(400);
    expect(eventsResponse.json()).toMatchObject({ message: "Invalid payload" });

    vi.unstubAllGlobals();
    await app.close();
  });

  it("rejects spoofed x-player-id headers without trusted auth context", async () => {
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
      method: "GET",
      url: "/v1/mobile/player/profile",
      headers: {
        "x-player-id": "victim-user-id",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    await app.close();
  });

  it("uses dev uid auth context for player profile without forwarding edge bearer", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        profile: {
          firebaseUid: "smoke-dev-firebase-uid",
          email: "player@axiomnode.es",
          displayName: "Dev Player",
          photoUrl: null,
        },
      }), {
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
      url: "/v1/mobile/player/profile",
      headers: {
        authorization: "Bearer edge-secret",
        "x-dev-firebase-uid": "smoke-dev-firebase-uid",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:7102/users/me/profile",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "x-dev-firebase-uid": "smoke-dev-firebase-uid",
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      headers: expect.not.objectContaining({
        authorization: "Bearer edge-secret",
      }),
    }));

    vi.unstubAllGlobals();
    await app.close();
  });

  it("promotes firebase id token to bearer auth for player profile resolution", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        profile: {
          firebaseUid: "firebase-user-1",
          email: "player@axiomnode.es",
          displayName: "Firebase Player",
          photoUrl: null,
        },
      }), {
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
      url: "/v1/mobile/player/profile",
      headers: {
        authorization: "Bearer edge-secret",
        "x-firebase-id-token": "firebase-mobile-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:7102/users/me/profile",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer firebase-mobile-token",
          "x-firebase-id-token": "firebase-mobile-token",
        }),
      }),
    );

    vi.unstubAllGlobals();
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
    });

    vi.unstubAllGlobals();
    await app.close();
  });

  it("parses catalog payloads returned as text when upstream content type is not json", async () => {
    const app = Fastify();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ categories: [{ id: "science", name: "Science" }] }), {
        status: 200,
        headers: { "content-type": "text/plain" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ categories: [{ id: "history", name: "History" }] }), {
        status: 200,
        headers: { "content-type": "text/plain" },
      }));

    vi.stubGlobal("fetch", fetchMock);

    await mobileRoutes(app, {
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    });

    const response = await app.inject({ method: "GET", url: "/v1/mobile/games/categories" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      categories: [
        { id: "science", name: "Science" },
        { id: "history", name: "History" },
      ],
    });

    vi.unstubAllGlobals();
    await app.close();
  });

  it("ignores malformed catalog payloads while merging available categories", async () => {
    const app = Fastify();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ categories: [{ id: "", name: "Broken" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("not-json", {
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
      url: "/v1/mobile/games/categories",
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ message: "Failed to load game catalogs from upstream services" });

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
      "http://microservice-quizz:7100/games/models/random?categoryId=42",
      expect.objectContaining({ method: "GET" }),
    );

    vi.unstubAllGlobals();
    await app.close();
  });

  it("accepts count on quiz random and limits returned items", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        gameType: "quiz",
        requested: 5,
        returned: 3,
        items: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
      }), {
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
      url: "/v1/mobile/games/quiz/random?count=2&language=es",
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://microservice-quizz:7100/games/models/random",
      expect.objectContaining({ method: "GET" }),
    );

    const payload = response.json();
    expect(payload).toMatchObject({ requested: 2, returned: 2 });
    expect(payload.items).toHaveLength(2);

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
      "http://microservice-wordpass:7101/games/models/random",
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
      "http://microservice-quizz:7100/games/models/random?categoryId=9",
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

  it("forwards upstream generation inventory failures", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response("generation unavailable", {
        status: 503,
        headers: { "content-type": "text/plain" },
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
      payload: {
        language: "es",
        categoryId: "9",
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).toBe("generation unavailable");

    vi.unstubAllGlobals();
    await app.close();
  });

  it("parses generated inventory payloads returned as text", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ id: "quiz-text-model" }] }), {
        status: 200,
        headers: { "content-type": "text/plain" },
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
      payload: {
        language: "es",
        categoryId: "9",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      gameType: "quiz",
      generated: { id: "quiz-text-model" },
    });

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
      "http://microservice-wordpass:7101/games/models/random?categoryId=9",
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
      "http://microservice-quizz:7100/games/models/random?categoryId=9",
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

  it("returns 502 when generated inventory has no usable first item", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
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
      payload: {
        language: "es",
        categoryId: "9",
      },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      message: "No game models available to build a playable game",
      gameType: "quiz",
    });

    vi.unstubAllGlobals();
    await app.close();
  });

  it("persists player summaries and ignores duplicate game events", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "axiomnode-player-store-"));
    const dbFile = path.join(tempDir, "players.json");

    try {
      const store = new PlayerStore(dbFile);

      await store.upsertPlayer("player-store-1", {
        email: "player-store@axiomnode.es",
        displayName: "Store Player",
        photoUrl: "https://cdn.example.com/store-player.png",
        preferredLanguage: "en",
      });
      await store.upsertPlayer("player-store-1", {});

      const event = {
        gameId: "game-duplicate",
        gameType: "quiz",
        categoryId: "science",
        categoryName: "Science",
        language: "en",
        outcome: "DRAW",
        score: 42,
        durationSeconds: 30,
        timestamp: 1_710_000_100_000,
      };

      const firstSync = await store.saveGameEvents("player-store-1", [event]);
      const duplicateSync = await store.saveGameEvents("player-store-1", [event]);

      expect(firstSync).toMatchObject({ synced: 1, stats: { totalGames: 1, draws: 1 } });
      expect(duplicateSync).toMatchObject({ synced: 0, stats: { totalGames: 1, draws: 1 } });

      const reloaded = new PlayerStore(dbFile);
      await expect(reloaded.getPlayerSummary({ playerId: "player-store-1" })).resolves.toMatchObject({
        profile: {
          email: "player-store@axiomnode.es",
          displayName: "Store Player",
          photoUrl: "https://cdn.example.com/store-player.png",
          preferredLanguage: "en",
        },
        stats: {
          totalGames: 1,
          draws: 1,
          totalScore: 42,
        },
      });

      const persisted = JSON.parse(await readFile(dbFile, "utf-8"));
      expect(persisted.events).toHaveLength(1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects malformed persisted player store files", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "axiomnode-player-store-broken-"));
    const dbFile = path.join(tempDir, "players.json");

    try {
      await writeFile(dbFile, "not-json", "utf-8");
      const store = new PlayerStore(dbFile);

      await expect(store.getPlayerSummary({ playerId: "broken-player" })).rejects.toBeInstanceOf(SyntaxError);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("creates anonymous player summaries with null optional profile fields", async () => {
    const store = new PlayerStore(":memory:");

    await expect(store.getPlayerSummary({ playerId: "anonymous-player" })).resolves.toMatchObject({
      profile: {
        playerId: "anonymous-player",
        email: null,
        displayName: null,
        photoUrl: null,
        preferredLanguage: null,
      },
      stats: {
        totalGames: 0,
        lastPlayedAt: null,
      },
    });
  });
});
