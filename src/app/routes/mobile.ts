import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { BaseGenerateSchema, RandomGameQuerySchema } from "@axiomnode/shared-sdk-client";
import { buildUrl, forwardHttp } from "@axiomnode/shared-sdk-client/proxy";
import { z } from "zod";

import type { AppConfig } from "../config.js";
import rateLimit from "@fastify/rate-limit";
import { DEFAULT_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_WINDOW_MS, rateLimitOptions } from "../plugins/rateLimit.js";

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
    // The app sends WON/LOST/DRAW; microservice-users stores lower-case values.
    outcome: z.string().transform((value) => value.trim().toLowerCase()).pipe(z.enum(["won", "lost", "draw"])),
    score: z.number().int().min(0).max(1_000_000),
    durationSeconds: z.number().int().min(0).max(86_400),
    timestamp: z.number().int().positive(),
  })).min(1).max(500),
});

type MobileCatalog = z.infer<typeof CatalogSnapshotSchema>;

const RandomModelsEnvelopeSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())).default([]),
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
    email: z.string().nullable().optional(),
    displayName: z.string().nullable().optional(),
    photoUrl: z.string().nullable().optional(),
    gamesPlayed: z.number().default(0),
    gamesWon: z.number().default(0),
    gamesLost: z.number().default(0),
    gamesDraw: z.number().default(0),
    totalScore: z.number().default(0),
    totalDurationSeconds: z.number().default(0),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  }),
});

const UsersMeStatsResponseSchema = z.object({
  recentEvents: z.array(z.object({ playedAt: z.string() })).default([]),
});

/** Player profile and stats returned to the app (same shape the JSON PlayerStore produced). */
type PlayerSummary = {
  profile: {
    playerId: string;
    email: string | null;
    displayName: string | null;
    photoUrl: string | null;
    /** microservice-users has no preferred-language column yet, so this is always null. */
    preferredLanguage: string | null;
    createdAt: number;
    updatedAt: number;
  };
  stats: {
    totalGames: number;
    wins: number;
    losses: number;
    draws: number;
    averageScore: number;
    totalScore: number;
    totalPlayTimeSeconds: number;
    lastPlayedAt: number | null;
  };
};

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

function buildUsersServiceAuthHeaders(
  headers: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const nextHeaders = { ...headers };
  const firebaseIdToken = headers["x-firebase-id-token"];
  const devFirebaseUid = headers["x-dev-firebase-uid"];

  if (typeof devFirebaseUid === "string" && devFirebaseUid.trim().length > 0) {
    delete nextHeaders.authorization;
    return nextHeaders;
  }

  if (typeof firebaseIdToken === "string" && firebaseIdToken.trim().length > 0) {
    nextHeaders.authorization = `Bearer ${firebaseIdToken}`;
  }

  return nextHeaders;
}

type UsersCallResult =
  | { ok: true; payload: unknown }
  | { ok: false };

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/**
 * Calls microservice-users on behalf of the player (the users service verifies the token itself).
 * On failure it has already answered the request (401 for invalid credentials, the upstream status for other
 * 4xx such as 400/403, 502 otherwise) and returns `ok: false`.
 */
async function callUsersService(
  request: FastifyRequest,
  reply: FastifyReply,
  config: AppConfig,
  timeoutMs: number,
  method: "GET" | "POST",
  path: string,
  query: Record<string, string | number | undefined> = {},
  body?: unknown,
): Promise<UsersCallResult> {
  let result;
  try {
    result = await forwardHttp({
      targetUrl: buildUrl(config.USERS_SERVICE_URL ?? "http://localhost:7102", path, query),
      method,
      requestHeaders: buildUsersServiceAuthHeaders(request.headers as Record<string, string | undefined>),
      body,
      timeoutMs,
    });
  } catch (error) {
    reply.status(502).send({
      message: "Failed to reach users service",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return { ok: false };
  }

  if (result.status === 401) {
    reply.status(401).send({ message: "Unauthorized" });
    return { ok: false };
  }

  if (result.status >= 400 && result.status < 500) {
    reply.code(result.status).send(result.payload);
    return { ok: false };
  }

  if (result.status < 200 || result.status >= 300) {
    reply.status(502).send({
      message: "Failed to load player data",
      error: typeof result.payload === "string" ? result.payload : "Upstream users service failed",
    });
    return { ok: false };
  }

  const payload = typeof result.payload === "string" ? safeJsonParse(result.payload) : result.payload;
  return { ok: true, payload };
}

/** Maps the users `/users/me/profile` payload (plus the newest event time) to the app-facing player summary. */
function toPlayerSummary(
  usersProfile: z.infer<typeof UsersMeProfileResponseSchema>["profile"],
  lastPlayedAt: number | null,
): PlayerSummary {
  const totalGames = usersProfile.gamesPlayed;
  return {
    profile: {
      playerId: usersProfile.firebaseUid,
      email: usersProfile.email ?? null,
      displayName: usersProfile.displayName ?? null,
      photoUrl: usersProfile.photoUrl ?? null,
      preferredLanguage: null,
      createdAt: usersProfile.createdAt ? Date.parse(usersProfile.createdAt) : Date.now(),
      updatedAt: usersProfile.updatedAt ? Date.parse(usersProfile.updatedAt) : Date.now(),
    },
    stats: {
      totalGames,
      wins: usersProfile.gamesWon,
      losses: usersProfile.gamesLost,
      draws: usersProfile.gamesDraw,
      averageScore: totalGames > 0 ? Math.round(usersProfile.totalScore / totalGames) : 0,
      totalScore: usersProfile.totalScore,
      totalPlayTimeSeconds: usersProfile.totalDurationSeconds,
      lastPlayedAt,
    },
  };
}

/** Loads the player summary from users (read-only for existing players; users creates a missing row). */
async function loadPlayerSummary(
  request: FastifyRequest,
  reply: FastifyReply,
  config: AppConfig,
  timeoutMs: number,
): Promise<PlayerSummary | null> {
  const profileCall = await callUsersService(request, reply, config, timeoutMs, "GET", "/users/me/profile");
  if (!profileCall.ok) {
    return null;
  }

  const parsed = UsersMeProfileResponseSchema.safeParse(profileCall.payload);
  if (!parsed.success) {
    reply.status(502).send({ message: "Failed to load player data", error: "Invalid users profile response" });
    return null;
  }

  let lastPlayedAt: number | null = null;
  if (parsed.data.profile.gamesPlayed > 0) {
    // The profile payload carries no event timestamps; one extra read is only needed for players with history.
    const statsCall = await callUsersService(request, reply, config, timeoutMs, "GET", "/users/me/stats", { recentLimit: 1 });
    if (!statsCall.ok) {
      return null;
    }
    const stats = UsersMeStatsResponseSchema.safeParse(statsCall.payload);
    const newest = stats.success ? stats.data.recentEvents[0]?.playedAt : undefined;
    lastPlayedAt = newest ? Date.parse(newest) : null;
  }

  return toPlayerSummary(parsed.data.profile, lastPlayedAt);
}

/** Best-effort stats refresh for the events response: never answers the request and never throws. */
async function fetchPlayerStatsQuietly(
  request: FastifyRequest,
  config: AppConfig,
  timeoutMs: number,
): Promise<PlayerSummary["stats"] | null> {
  let failed = false;
  const silentReply = new Proxy({}, {
    get: () => () => {
      failed = true;
      return silentReply;
    },
  }) as unknown as FastifyReply;

  try {
    const summary = await loadPlayerSummary(request, silentReply, config, timeoutMs);
    return failed || !summary ? null : summary.stats;
  } catch {
    return null;
  }
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
  const rateLimitMax = config.RATE_LIMIT_MAX ?? DEFAULT_RATE_LIMIT_MAX;
  if (rateLimitMax > 0) {
    await app.register(rateLimit, rateLimitOptions(rateLimitMax, config.RATE_LIMIT_WINDOW_MS ?? DEFAULT_RATE_LIMIT_WINDOW_MS));
  }

  app.get("/v1/mobile/player/profile", async (request, reply) => {
    if (!hasMobileAuthContext(request.headers as Record<string, unknown>)) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const summary = await loadPlayerSummary(request, reply, config, upstreamTimeoutMs);
    if (!summary) {
      return;
    }
    return reply.send(summary);
  });

  app.put("/v1/mobile/player/profile", async (request, reply) => {
    if (!hasMobileAuthContext(request.headers as Record<string, unknown>)) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const parsedPayload = PlayerProfileUpdateSchema.safeParse(request.body ?? {});
    if (!parsedPayload.success) {
      return sendValidationError(reply, parsedPayload.error);
    }

    // users syncs the profile from the verified token claims and creates the row on first login.
    const session = await callUsersService(request, reply, config, upstreamTimeoutMs, "POST", "/users/firebase/session", {}, {});
    if (!session.ok) {
      return;
    }

    const summary = await loadPlayerSummary(request, reply, config, upstreamTimeoutMs);
    if (!summary) {
      return;
    }
    return reply.send(summary);
  });

  app.post("/v1/mobile/games/events", async (request, reply) => {
    if (!hasMobileAuthContext(request.headers as Record<string, unknown>)) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const parsedPayload = GameEventsSyncSchema.safeParse(request.body ?? {});
    if (!parsedPayload.success) {
      return sendValidationError(reply, parsedPayload.error);
    }

    // The profile row is created by PUT/GET profile; users stores the events idempotently.
    const stored = await callUsersService(
      request, reply, config, upstreamTimeoutMs, "POST", "/users/me/games/events/batch", {}, parsedPayload.data,
    );
    if (!stored.ok) {
      return;
    }

    const synced = (stored.payload as { synced?: unknown } | undefined)?.synced;
    const syncedCount = typeof synced === "number" ? synced : 0;
    const body: Record<string, unknown> = {
      synced: syncedCount,
      message: `Synced ${syncedCount} game event(s)`,
    };

    // Best effort: keep returning the refreshed stats; the app itself only reads `synced` and `message`.
    const stats = await fetchPlayerStatsQuietly(request, config, upstreamTimeoutMs);
    if (stats) {
      body.stats = stats;
    }
    return reply.send(body);
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
