import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { RandomGameQuerySchema } from "@axiomnode/shared-sdk-client/contracts";
import { BaseGenerateSchema } from "@axiomnode/shared-sdk-client";
import { buildUrl, forwardHttp } from "@axiomnode/shared-sdk-client/proxy";
import { z } from "zod";

import type { AppConfig } from "../config.js";

/** @module mobile — Routes for mobile game endpoints (quiz & wordpass random and generate). */

const WordPassGenerateRequestSchema = BaseGenerateSchema.extend({
  letters: z.string().optional(),
});

function sendValidationError(reply: FastifyReply, error: { flatten: () => unknown }): FastifyReply {
  return reply.status(400).send({
    message: "Invalid payload",
    errors: error.flatten(),
  });
}

async function forwardRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  targetUrl: string,
  method: "GET" | "POST",
  timeoutMs: number,
  body?: unknown,
): Promise<void> {
  const result = await forwardHttp({
    targetUrl,
    method,
    requestHeaders: request.headers as Record<string, string | undefined>,
    body,
    timeoutMs,
  });

  reply.code(result.status);
  reply.header("content-type", result.contentType);
  reply.send(result.payload);
}

/** Registers mobile game routes for quiz and wordpass random retrieval and generation. */
export async function mobileRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  const upstreamTimeoutMs = config.UPSTREAM_TIMEOUT_MS ?? 15000;
  const upstreamGenerationTimeoutMs = config.UPSTREAM_GENERATION_TIMEOUT_MS ?? 60000;

  app.get("/v1/mobile/games/quiz/random", async (request, reply) => {
    const parsedQuery = RandomGameQuerySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      return reply.status(400).send({
        message: "Invalid query parameters",
        errors: parsedQuery.error.flatten(),
      });
    }

    const url = buildUrl(config.QUIZZ_SERVICE_URL, "/games/models/random", parsedQuery.data);
    await forwardRequest(request, reply, url, "GET", upstreamTimeoutMs, undefined);
  });

  app.get("/v1/mobile/games/wordpass/random", async (request, reply) => {
    const parsedQuery = RandomGameQuerySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      return reply.status(400).send({
        message: "Invalid query parameters",
        errors: parsedQuery.error.flatten(),
      });
    }

    const url = buildUrl(config.WORDPASS_SERVICE_URL, "/games/models/random", parsedQuery.data);
    await forwardRequest(request, reply, url, "GET", upstreamTimeoutMs, undefined);
  });

  app.post("/v1/mobile/games/quiz/generate", async (request, reply) => {
    const parsedPayload = BaseGenerateSchema.safeParse(request.body ?? {});
    if (!parsedPayload.success) {
      return sendValidationError(reply, parsedPayload.error);
    }

    const url = buildUrl(config.QUIZZ_SERVICE_URL, "/games/generate", {});
    await forwardRequest(request, reply, url, "POST", upstreamGenerationTimeoutMs, parsedPayload.data);
  });

  app.post("/v1/mobile/games/wordpass/generate", async (request, reply) => {
    const parsedPayload = WordPassGenerateRequestSchema.safeParse(request.body ?? {});
    if (!parsedPayload.success) {
      return sendValidationError(reply, parsedPayload.error);
    }

    const url = buildUrl(config.WORDPASS_SERVICE_URL, "/games/generate", {});
    await forwardRequest(request, reply, url, "POST", upstreamGenerationTimeoutMs, parsedPayload.data);
  });
}
