import { describe, expect, it, vi } from "vitest";

import Fastify from "fastify";
import { mobileRoutes } from "../app/routes/mobile.js";

describe("mobile routes", () => {
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

  it("forwards quiz generation POST with auth headers", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ generated: true }), {
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
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://microservice-quizz:7100/games/generate");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer user-token",
          "x-correlation-id": "corr-mobile-post",
        }),
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      categoryId: "9",
      language: "es",
      difficultyPercentage: 60,
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

  it("forwards requestedBy and letters to wordpass generation", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ generated: true }), {
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
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://microservice-wordpass:7101/games/generate");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      categoryId: "9",
      language: "es",
      requestedBy: "api",
      letters: "abc",
    });

    vi.unstubAllGlobals();
    await app.close();
  });

  it("forwards critical headers to quiz generation upstream", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ generated: true }), {
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
      "http://microservice-quizz:7100/games/generate",
      expect.objectContaining({
        method: "POST",
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
