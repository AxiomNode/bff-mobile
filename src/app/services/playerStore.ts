import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type PlayerIdentity = {
  playerId: string;
  email?: string;
  displayName?: string;
  photoUrl?: string;
};

export type PlayerProfile = {
  playerId: string;
  email: string | null;
  displayName: string | null;
  photoUrl: string | null;
  preferredLanguage: string | null;
  createdAt: number;
  updatedAt: number;
};

export type PlayerGameEventInput = {
  gameId: string;
  gameType: string;
  categoryId: string;
  categoryName: string;
  language: string;
  outcome: string;
  score: number;
  durationSeconds: number;
  timestamp: number;
};

type PlayerGameEventRecord = PlayerGameEventInput & {
  eventKey: string;
  playerId: string;
  createdAt: number;
};

type PlayerStoreState = {
  players: Record<string, PlayerProfile>;
  events: PlayerGameEventRecord[];
};

export type PlayerStats = {
  totalGames: number;
  wins: number;
  losses: number;
  draws: number;
  averageScore: number;
  totalScore: number;
  totalPlayTimeSeconds: number;
  lastPlayedAt: number | null;
};

function getHeaderValue(headers: Record<string, unknown>, key: string): string {
  const value = headers[key];
  if (Array.isArray(value)) {
    return String(value[0] ?? "").trim();
  }
  return String(value ?? "").trim();
}

function decodeBase64Url(payloadSegment: string): string | null {
  const normalized = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : `${normalized}${"=".repeat(4 - padding)}`;
  try {
    return Buffer.from(padded, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

function parseTokenClaims(token: string): Record<string, unknown> | null {
  const segments = token.split(".");
  if (segments.length < 2) {
    return null;
  }

  const payloadJson = decodeBase64Url(segments[1] ?? "");
  if (!payloadJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function resolvePlayerIdentity(headers: Record<string, unknown>): PlayerIdentity | null {
  const authorization = getHeaderValue(headers, "authorization");
  const bearerPrefix = "Bearer ";

  if (authorization.startsWith(bearerPrefix)) {
    const token = authorization.slice(bearerPrefix.length).trim();
    const claims = parseTokenClaims(token);
    if (claims) {
      const playerId = String(claims.sub ?? claims.user_id ?? claims.uid ?? "").trim();
      if (playerId) {
        const email = String(claims.email ?? "").trim() || undefined;
        const displayName = String(claims.name ?? claims.display_name ?? "").trim() || undefined;
        const photoUrl = String(claims.picture ?? claims.photo_url ?? "").trim() || undefined;

        return {
          playerId,
          email,
          displayName,
          photoUrl,
        };
      }
    }
  }

  const playerIdHeader = getHeaderValue(headers, "x-player-id");
  if (playerIdHeader) {
    return {
      playerId: playerIdHeader,
    };
  }

  return null;
}

export class PlayerStore {
  private readonly state: PlayerStoreState = {
    players: {},
    events: [],
  };

  private readonly inMemory: boolean;

  private readonly initialized: Promise<void>;

  private operationQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {
    this.inMemory = filePath === ":memory:";
    this.initialized = this.initialize();
  }

  private async initialize(): Promise<void> {
    if (this.inMemory) {
      return;
    }

    await mkdir(dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<PlayerStoreState>;
      if (parsed.players && typeof parsed.players === "object") {
        this.state.players = parsed.players as Record<string, PlayerProfile>;
      }
      if (Array.isArray(parsed.events)) {
        this.state.events = parsed.events as PlayerGameEventRecord[];
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    if (this.inMemory) {
      return;
    }

    await writeFile(this.filePath, JSON.stringify(this.state, null, 2), "utf-8");
  }

  private async runSerialized<T>(operation: () => Promise<T>): Promise<T> {
    await this.initialized;

    const next = this.operationQueue.then(operation, operation);
    this.operationQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private computeStats(playerId: string): PlayerStats {
    const events = this.state.events.filter((item) => item.playerId === playerId);
    const totalGames = events.length;
    const wins = events.filter((item) => item.outcome.toUpperCase() === "WON").length;
    const losses = events.filter((item) => item.outcome.toUpperCase() === "LOST").length;
    const draws = events.filter((item) => item.outcome.toUpperCase() === "DRAW").length;
    const totalScore = events.reduce((acc, item) => acc + item.score, 0);
    const totalPlayTimeSeconds = events.reduce((acc, item) => acc + item.durationSeconds, 0);
    const averageScore = totalGames > 0 ? Math.round(totalScore / totalGames) : 0;
    const lastPlayedAt = events.reduce((acc, item) => Math.max(acc, item.timestamp), 0) || null;

    return {
      totalGames,
      wins,
      losses,
      draws,
      averageScore,
      totalScore,
      totalPlayTimeSeconds,
      lastPlayedAt,
    };
  }

  async upsertPlayer(
    playerId: string,
    profile: {
      email?: string;
      displayName?: string;
      photoUrl?: string;
      preferredLanguage?: string;
    },
  ): Promise<PlayerProfile> {
    return this.runSerialized(async () => {
      const now = Date.now();
      const existing = this.state.players[playerId];

      const updated: PlayerProfile = {
        playerId,
        email: profile.email ?? existing?.email ?? null,
        displayName: profile.displayName ?? existing?.displayName ?? null,
        photoUrl: profile.photoUrl ?? existing?.photoUrl ?? null,
        preferredLanguage: profile.preferredLanguage ?? existing?.preferredLanguage ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      this.state.players[playerId] = updated;
      await this.persist();

      return { ...updated };
    });
  }

  async getPlayerSummary(
    identity: PlayerIdentity,
  ): Promise<{ profile: PlayerProfile; stats: PlayerStats }> {
    return this.runSerialized(async () => {
      let profile = this.state.players[identity.playerId];
      if (!profile) {
        const now = Date.now();
        profile = {
          playerId: identity.playerId,
          email: identity.email ?? null,
          displayName: identity.displayName ?? null,
          photoUrl: identity.photoUrl ?? null,
          preferredLanguage: null,
          createdAt: now,
          updatedAt: now,
        };
        this.state.players[identity.playerId] = profile;
        await this.persist();
      }

      const stats = this.computeStats(identity.playerId);

      return {
        profile: { ...profile },
        stats,
      };
    });
  }

  async saveGameEvents(playerId: string, events: PlayerGameEventInput[]): Promise<{ synced: number; stats: PlayerStats }> {
    return this.runSerialized(async () => {
      const knownKeys = new Set(this.state.events.map((item) => item.eventKey));
      const now = Date.now();

      let synced = 0;

      for (const event of events) {
        const eventKey = createHash("sha256")
          .update(`${playerId}|${event.gameId}|${event.gameType}|${event.timestamp}|${event.outcome}|${event.score}`)
          .digest("hex");

        if (knownKeys.has(eventKey)) {
          continue;
        }

        knownKeys.add(eventKey);
        this.state.events.push({
          ...event,
          eventKey,
          playerId,
          createdAt: now,
        });
        synced += 1;
      }

      if (!this.state.players[playerId]) {
        this.state.players[playerId] = {
          playerId,
          email: null,
          displayName: null,
          photoUrl: null,
          preferredLanguage: null,
          createdAt: now,
          updatedAt: now,
        };
      } else {
        this.state.players[playerId] = {
          ...this.state.players[playerId],
          updatedAt: now,
        };
      }

      await this.persist();

      return {
        synced,
        stats: this.computeStats(playerId),
      };
    });
  }
}