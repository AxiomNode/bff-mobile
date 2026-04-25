import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { BaseGenerateSchema, RandomGameQuerySchema } from "@axiomnode/shared-sdk-client";
import { buildUrl, forwardHttp } from "@axiomnode/shared-sdk-client/proxy";
import { z } from "zod";

import type { AppConfig } from "../config.js";
import { PlayerStore, type PlayerIdentity } from "../services/playerStore.js";

/** @module mobile — Routes for mobile game endpoints (quiz & wordpass random and generate). */

const WordPassGenerateRequestSchema = BaseGenerateSchema.extend({
  letters: z.string().optional(),
});

const CatalogSnapshotSchema = z.object({
  categories: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
    }),
  ),
});

const PlayerProfileUpdateSchema = z.object({
  email: z.string().email().optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
  photoUrl: z.string().url().optional(),
  preferredLanguage: z.string().trim().min(2).max(10).optional(),
});

const GameEventsSyncSchema = z.object({
  events: z.array(z.object({
    gameId: z.string().min(1),
    gameType: z.string().min(1),
    categoryId: z.string().min(1),
    categoryName: z.string().min(1),
    language: z.string().min(1),
    outcome: z.string().min(1),
    score: z.number().int().min(0).max(1_000_000),
    durationSeconds: z.number().int().min(0).max(86_400),
    timestamp: z.number().int().positive(),
  })).min(1).max(500),
});

type MobileCatalog = z.infer<typeof CatalogSnapshotSchema>;

const RandomModelsEnvelopeSchema = z.object({
  items: z.array(z.record(z.unknown())).default([]),
});

const MobileRandomQuerySchema = z.object({
  language: z.string().optional(),
  categoryId: z.string().min(1).optional(),
  count: z.coerce.number().int().positive().max(50).optional(),
}).strict();

const RandomItemsEnvelopeSchema = z.object({
  items: z.array(z.unknown()),
  requested: z.number().int().positive().optional(),
  returned: z.number().int().min(0).optional(),
}).passthrough();

const UsersMeProfileResponseSchema = z.object({
  profile: z.object({
    firebaseUid: z.string().min(1),
    email: z.string().email().nullable().optional(),
    displayName: z.string().nullable().optional(),
    photoUrl: z.string().url().nullable().optional(),
  }),
});

function sendValidationError(reply: FastifyReply, error: { flatten: () => unknown }): FastifyReply {
  return reply.status(400).send({
    message: "Invalid payload",
    errors: error.flatten(),
  });
}

function applyCountToRandomPayload(payload: unknown, count: number): unknown {
  const parsedPayload = RandomItemsEnvelopeSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return payload;
  }

  const items = parsedPayload.data.items.slice(0, count);
  return {
    ...parsedPayload.data,
    items,
    requested: count,
    returned: items.length,
  };
}

async function forwardRandomRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  serviceBaseUrl: string,
  query: z.infer<typeof MobileRandomQuerySchema>,
  timeoutMs: number,
): Promise<void> {
  const upstreamQuery = RandomGameQuerySchema.parse({
    categoryId: query.categoryId,
  });

  const targetUrl = buildUrl(serviceBaseUrl, "/games/models/random", upstreamQuery);
  const result = await forwardHttp({
    targetUrl,
    method: "GET",
    requestHeaders: request.headers as Record<string, string | undefined>,
    timeoutMs,
  });

  reply.code(result.status);
  reply.header("content-type", result.contentType);

  if (result.status < 200 || result.status >= 300 || query.count === undefined) {
    reply.send(result.payload);
    return;
  }

  try {
    const payload = typeof result.payload === "string"
      ? JSON.parse(result.payload)
      : result.payload;
    reply.send(applyCountToRandomPayload(payload, query.count));
  } catch {
    reply.send(result.payload);
  }
}

function mergeCatalogs(primary: MobileCatalog | null, secondary: MobileCatalog | null): MobileCatalog | null {
  if (!primary && !secondary) {
    return null;
  }

  const categories = [...(primary?.categories ?? []), ...(secondary?.categories ?? [])]
    .filter((item, index, arr) => arr.findIndex((candidate) => candidate.id === item.id) === index);

  return {
    categories,
  };
}

function hasMobileAuthContext(headers: Record<string, unknown>): boolean {
  return typeof headers.authorization === "string"
    || typeof headers["x-firebase-id-token"] === "string"
    || typeof headers["x-dev-firebase-uid"] === "string";
}

async function resolveAuthenticatedPlayerIdentity(
  request: FastifyRequest,
  reply: FastifyReply,
  config: AppConfig,
  timeoutMs: number,
): Promise<PlayerIdentity | null> {
  const requestHeaders = request.headers as Record<string, string | undefined>;
  if (!hasMobileAuthContext(request.headers as Record<string, unknown>)) {
    reply.status(401).send({ message: "Unauthorized" });
    return null;
  }

  let result;
  try {
    result = await forwardHttp({
      targetUrl: buildUrl(config.USERS_SERVICE_URL ?? "http://localhost:7102", "/users/me/profile", {}),
      method: "GET",
      requestHeaders,
      timeoutMs,
    });
  } catch (error) {
    reply.status(502).send({
      message: "Failed to resolve player identity",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }

  if (result.status === 401 || result.status === 403) {
    reply.status(401).send({ message: "Unauthorized" });
    return null;
  }

  if (result.status < 200 || result.status >= 300) {
    reply.status(502).send({
      message: "Failed to resolve player identity",
      error: typeof result.payload === "string" ? result.payload : "Upstream auth failed",
    });
    return null;
  }

  const payload = typeof result.payload === "string"
    ? JSON.parse(result.payload)
    : result.payload;
  const parsed = UsersMeProfileResponseSchema.safeParse(payload);
  if (!parsed.success) {
    reply.status(502).send({
      message: "Failed to resolve player identity",
      error: "Invalid users profile response",
    });
    return null;
  }

  return {
    playerId: parsed.data.profile.firebaseUid,
    email: parsed.data.profile.email ?? undefined,
    displayName: parsed.data.profile.displayName ?? undefined,
    photoUrl: parsed.data.profile.photoUrl ?? undefined,
  };
}

async function fetchCatalog(
  request: FastifyRequest,
  targetUrl: string,
  timeoutMs: number,
): Promise<MobileCatalog | null> {
  try {
    const result = await forwardHttp({
      targetUrl,
      method: "GET",
      requestHeaders: request.headers as Record<string, string | undefined>,
      timeoutMs,
    });

    if (result.status < 200 || result.status >= 300) {
      return null;
    }

    const payload = typeof result.payload === "string"
      ? JSON.parse(result.payload)
      : result.payload;
    const parsed = CatalogSnapshotSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function buildGeneratedGameFromInventory(
  request: FastifyRequest,
  reply: FastifyReply,
  serviceBaseUrl: string,
  gameType: "quiz" | "word-pass",
  payload: z.infer<typeof BaseGenerateSchema>,
  timeoutMs: number,
): Promise<FastifyReply> {
  const randomUrl = buildUrl(serviceBaseUrl, "/games/models/random", {
    categoryId: payload.categoryId,
  });

  const result = await forwardHttp({
    targetUrl: randomUrl,
    method: "GET",
    requestHeaders: request.headers as Record<string, string | undefined>,
    timeoutMs,
  });

  if (result.status < 200 || result.status >= 300) {
    return reply.code(result.status).send(result.payload);
  }

  const payloadJson = typeof result.payload === "string"
    ? JSON.parse(result.payload)
    : result.payload;

  const parsed = RandomModelsEnvelopeSchema.safeParse(payloadJson);
  const firstItem = parsed.success ? parsed.data.items[0] : undefined;

  if (!firstItem || typeof firstItem !== "object") {
    return reply.status(502).send({
      message: "No game models available to build a playable game",
      gameType,
    });
  }

  return reply.send({
    gameType,
    generated: firstItem,
  });
}

/** Registers mobile game routes for quiz and wordpass random retrieval and generation. */
export async function mobileRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  const upstreamTimeoutMs = config.UPSTREAM_TIMEOUT_MS ?? 15000;
  const upstreamGenerationTimeoutMs = config.UPSTREAM_GENERATION_TIMEOUT_MS ?? 60000;
  const playerStore = new PlayerStore(config.PLAYER_DB_FILE ?? ":memory:");

  app.get("/v1/mobile/player/profile", async (request, reply) => {
    const identity = await resolveAuthenticatedPlayerIdentity(request, reply, config, upstreamTimeoutMs);
    if (!identity) {
      return;
    }

    const summary = await playerStore.getPlayerSummary(identity);
    return reply.send(summary);
  });

  app.put("/v1/mobile/player/profile", async (request, reply) => {
    const identity = await resolveAuthenticatedPlayerIdentity(request, reply, config, upstreamTimeoutMs);
    if (!identity) {
      return;
    }

    const parsedPayload = PlayerProfileUpdateSchema.safeParse(request.body ?? {});
    if (!parsedPayload.success) {
      return sendValidationError(reply, parsedPayload.error);
    }

    const profile = await playerStore.upsertPlayer(identity.playerId, {
      email: parsedPayload.data.email ?? identity.email,
      displayName: parsedPayload.data.displayName ?? identity.displayName,
      photoUrl: parsedPayload.data.photoUrl ?? identity.photoUrl,
      preferredLanguage: parsedPayload.data.preferredLanguage,
    });

    const stats = (await playerStore.getPlayerSummary(identity)).stats;
    return reply.send({ profile, stats });
  });

  app.post("/v1/mobile/games/events", async (request, reply) => {
    const identity = await resolveAuthenticatedPlayerIdentity(request, reply, config, upstreamTimeoutMs);
    if (!identity) {
      return;
    }

    const parsedPayload = GameEventsSyncSchema.safeParse(request.body ?? {});
    if (!parsedPayload.success) {
      return sendValidationError(reply, parsedPayload.error);
    }

    const result = await playerStore.saveGameEvents(identity.playerId, parsedPayload.data.events);
    return reply.send({
      synced: result.synced,
      message: `Synced ${result.synced} game event(s)`,
      stats: result.stats,
    });
  });

  app.get("/v1/mobile/games/categories", async (request, reply) => {
    const [quizCatalog, wordpassCatalog] = await Promise.all([
      fetchCatalog(request, buildUrl(config.QUIZZ_SERVICE_URL, "/catalogs", {}), upstreamTimeoutMs),
      fetchCatalog(request, buildUrl(config.WORDPASS_SERVICE_URL, "/catalogs", {}), upstreamTimeoutMs),
    ]);

    const merged = mergeCatalogs(quizCatalog, wordpassCatalog);
    if (!merged) {
      return reply.status(502).send({
        message: "Failed to load game catalogs from upstream services",
      });
    }

    return reply.send(merged);
  });

  app.get("/v1/mobile/games/quiz/random", async (request, reply) => {
    /* v8 ignore next -- Fastify always materializes request.query for matched routes; the nullish fallback is defensive only */
    const parsedQuery = MobileRandomQuerySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      return reply.status(400).send({
        message: "Invalid query parameters",
        errors: parsedQuery.error.flatten(),
      });
    }

    await forwardRandomRequest(
      request,
      reply,
      config.QUIZZ_SERVICE_URL,
      parsedQuery.data,
      upstreamTimeoutMs,
    );
  });

  app.get("/v1/mobile/games/wordpass/random", async (request, reply) => {
    /* v8 ignore next -- Fastify always materializes request.query for matched routes; the nullish fallback is defensive only */
    const parsedQuery = MobileRandomQuerySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      return reply.status(400).send({
        message: "Invalid query parameters",
        errors: parsedQuery.error.flatten(),
      });
    }

    await forwardRandomRequest(
      request,
      reply,
      config.WORDPASS_SERVICE_URL,
      parsedQuery.data,
      upstreamTimeoutMs,
    );
  });

  app.post("/v1/mobile/games/quiz/generate", async (request, reply) => {
    const parsedPayload = BaseGenerateSchema.safeParse(request.body ?? {});
    if (!parsedPayload.success) {
      return sendValidationError(reply, parsedPayload.error);
    }

    return buildGeneratedGameFromInventory(
      request,
      reply,
      config.QUIZZ_SERVICE_URL,
      "quiz",
      parsedPayload.data,
      upstreamGenerationTimeoutMs,
    );
  });

  app.post("/v1/mobile/games/wordpass/generate", async (request, reply) => {
    const parsedPayload = WordPassGenerateRequestSchema.safeParse(request.body ?? {});
    if (!parsedPayload.success) {
      return sendValidationError(reply, parsedPayload.error);
    }

    return buildGeneratedGameFromInventory(
      request,
      reply,
      config.WORDPASS_SERVICE_URL,
      "word-pass",
      parsedPayload.data,
      upstreamGenerationTimeoutMs,
    );
  });
}
