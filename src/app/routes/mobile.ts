import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { GenerateGameRequestSchema, RandomGameQuerySchema } from "@axiomnode/shared-sdk-client/contracts";
import { buildUrl, forwardHttp } from "@axiomnode/shared-sdk-client/proxy";

import type { AppConfig } from "../config.js";

async function forwardRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  targetUrl: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<void> {
  const result = await forwardHttp({
    targetUrl,
    method,
    requestHeaders: request.headers as Record<string, string | undefined>,
    body,
  });

  reply.code(result.status);
  reply.header("content-type", result.contentType);
  reply.send(result.payload);
}

export async function mobileRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  app.get("/v1/mobile/games/quiz/random", async (request, reply) => {
    const query = RandomGameQuerySchema.parse(request.query);
    const url = buildUrl(config.QUIZZ_SERVICE_URL, "/games/models/random", query);
    await forwardRequest(request, reply, url, "GET", undefined);
  });

  app.get("/v1/mobile/games/wordpass/random", async (request, reply) => {
    const query = RandomGameQuerySchema.parse(request.query);
    const url = buildUrl(config.WORDPASS_SERVICE_URL, "/games/models/random", query);
    await forwardRequest(request, reply, url, "GET", undefined);
  });

  app.post("/v1/mobile/games/quiz/generate", async (request, reply) => {
    const payload = GenerateGameRequestSchema.parse(request.body);
    const url = buildUrl(config.QUIZZ_SERVICE_URL, "/games/generate", {});
    await forwardRequest(request, reply, url, "POST", payload);
  });

  app.post("/v1/mobile/games/wordpass/generate", async (request, reply) => {
    const payload = GenerateGameRequestSchema.parse(request.body);
    const url = buildUrl(config.WORDPASS_SERVICE_URL, "/games/generate", {});
    await forwardRequest(request, reply, url, "POST", payload);
  });
}
