import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { node } from "@elysiajs/node";
import { computeLeaderboard } from "@molty/shared";
import type {
  PublicConfig,
  UserConfig,
  DailyStat,
  LeaderboardResponse,
  DailyHistoryResponse,
  ShopCatalogResponse,
  SkinId,
  WalletResponse,
  WeeklyStat,
  WeeklyLeaderboardResponse,
} from "@molty/shared";
import { createWakaTimeClient } from "./wakatime.js";
import { createWakaTimeSync, DEFAULT_WAKATIME_SYNC_INTERVAL_MS } from "./wakatime-sync.js";
import {
  createWakaTimeWeeklyCache,
  DEFAULT_WAKATIME_WEEKLY_CACHE_INTERVAL_MS,
  DEFAULT_WAKATIME_WEEKLY_RANGE,
} from "./wakatime-weekly-cache.js";
import { shiftDateKey, toDateKeyInTimeZone } from "./date-key.js";
import { createPrismaClient } from "./db.js";
import { createPrismaRepository, type UserRepository } from "./repository.js";
import { hashPassword, verifyPassword } from "./auth.js";
import {
  createMemorySessionStore,
  createPrismaSessionStore,
  type SessionStore,
} from "./session-store.js";
import {
  ACHIEVEMENT_DEFINITIONS,
  toAchievementBoard,
  toAchievementDisplay,
} from "./achievements.js";
import {
  HONOR_TITLE_ACHIEVEMENT_IDS,
  resolveHonorTitlesByUserId,
} from "./honor-titles.js";
import {
  createHonorTitleGenerator,
  MAX_HONOR_TITLE_LENGTH,
} from "./honor-title-ai.js";
import { createProviderLogCleanup } from "./provider-log-cleanup.js";

export type ServerOptions = {
  port: number;
  hostname?: string;
  fetcher?: typeof fetch;
  databaseUrl?: string;
  repository?: UserRepository;
  sessionStore?: SessionStore;
  enableStatusSync?: boolean;
  statusSyncIntervalMs?: number;
  enableWeeklyCache?: boolean;
  weeklyCacheIntervalMs?: number;
  weeklyRangeKey?: string;
  openRouterApiKey?: string | null;
  openRouterModel?: string;
  providerLogRetentionDays?: number;
};

const DEFAULT_PROVIDER_LOG_RETENTION_DAYS = 14;
const MAX_HISTORY_DAYS = 14;

const toPublicConfig = (config: UserConfig): PublicConfig => ({
  wakawarsUsername: config.wakawarsUsername,
  friends: config.friends.map((friend) => ({
    username: friend.username,
  })),
  groups: config.groups.map((group) => ({
    id: group.id,
    name: group.name,
    members: group.members.map((member) => ({
      id: member.id,
      username: member.username,
    })),
  })),
  statsVisibility: config.statsVisibility,
  isCompeting: config.isCompeting,
  hasApiKey: Boolean(config.apiKey),
  passwordSet: Boolean(config.passwordHash),
});

const normalizeUsername = (value: string): string => value.trim().toLowerCase();

const normalizeFriendUsername = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const withoutProtocol = trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "");
  const withoutQuery =
    withoutProtocol.split("?")[0]?.split("#")[0] ?? withoutProtocol;
  const segments = withoutQuery.split("/").filter(Boolean);
  const lastSegment = segments.length
    ? segments[segments.length - 1]
    : withoutQuery;
  return normalizeUsername(lastSegment.replace(/^@/, ""));
};

export const createServer = ({
  port,
  hostname,
  fetcher,
  databaseUrl,
  repository,
  sessionStore,
  enableStatusSync,
  statusSyncIntervalMs,
  enableWeeklyCache,
  weeklyCacheIntervalMs,
  weeklyRangeKey,
  openRouterApiKey,
  openRouterModel,
  providerLogRetentionDays,
}: ServerOptions) => {
  const prisma = repository ? null : createPrismaClient(databaseUrl);
  const store = repository ?? createPrismaRepository(prisma!);
  const wakatime = createWakaTimeClient({ fetcher });
  const sessions =
    sessionStore ??
    (prisma ? createPrismaSessionStore(prisma) : createMemorySessionStore());
  const rangeKey = weeklyRangeKey ?? DEFAULT_WAKATIME_WEEKLY_RANGE;
  const honorTitleGenerator = createHonorTitleGenerator({
    store,
    apiKey: openRouterApiKey ?? process.env.OPENROUTER_API_KEY ?? null,
    model: openRouterModel ?? process.env.OPENROUTER_MODEL,
    fetcher,
    weeklyRangeKey: rangeKey,
  });
  const statusSync = createWakaTimeSync({
    store,
    wakatime,
    intervalMs: statusSyncIntervalMs ?? DEFAULT_WAKATIME_SYNC_INTERVAL_MS,
    honorTitle: honorTitleGenerator,
  });
  const shouldSync = enableStatusSync ?? true;
  const retentionFromEnv = Number(process.env.PROVIDER_LOG_RETENTION_DAYS);
  const resolvedRetentionDays =
    providerLogRetentionDays ??
    (Number.isFinite(retentionFromEnv) && retentionFromEnv > 0
      ? retentionFromEnv
      : DEFAULT_PROVIDER_LOG_RETENTION_DAYS);
  const providerLogCleanup = createProviderLogCleanup({
    store,
    retentionDays: resolvedRetentionDays,
  });
  const weeklyCache = createWakaTimeWeeklyCache({
    store,
    wakatime,
    intervalMs: weeklyCacheIntervalMs ?? DEFAULT_WAKATIME_WEEKLY_CACHE_INTERVAL_MS,
    weeklyRangeKey: rangeKey,
  });
  const shouldCacheWeekly = enableWeeklyCache ?? shouldSync;

  const requireSession = async (
    headers: Record<string, string | undefined>,
    set: { status?: number | string }
  ) => {
    const token = headers["x-wakawars-session"];
    if (!token) {
      set.status = 401;
      return { ok: false, user: null } as const;
    }

    const userId = await sessions.getUserId(token);
    if (!userId) {
      set.status = 401;
      return { ok: false, user: null } as const;
    }

    const user = await store.getUserById(userId);
    if (!user) {
      set.status = 401;
      return { ok: false, user: null } as const;
    }

    return { ok: true, user } as const;
  };

  const resolveDateKeyForUser = (
    user: { wakatimeTimezone?: string | null },
    offsetDays: number,
    baseDate: Date
  ) => {
    const todayKey = toDateKeyInTimeZone(baseDate, user.wakatimeTimezone ?? null);
    return shiftDateKey(todayKey, offsetDays);
  };

  const resolveHonorTitles = async (userIds: number[]) => {
    const [aiTitles, grants] = await Promise.all([
      store.getAiHonorTitles(userIds),
      store.listAchievementGrants({
        userIds,
        achievementIds: HONOR_TITLE_ACHIEVEMENT_IDS,
      }),
    ]);

    const deterministic = resolveHonorTitlesByUserId({
      userIds,
      grants,
    });

    // Prefer the cached AI title; fall back to the deterministic title when the
    // user has no generated title yet (or the AI provider is not configured).
    return new Map(
      userIds.map((id) => {
        const aiTitle = aiTitles.get(id);
        return [
          id,
          aiTitle && aiTitle.trim() ? aiTitle : deterministic.get(id) ?? null,
        ] as const;
      })
    );
  };

  const buildDailyLeaderboard = async (config: UserConfig, offsetDays: number) => {
    const baseDate = new Date();
    const groupPeerIds = new Set(await store.getGroupPeerIds(config.id));
    const friendIds = new Set(config.friends.map((friend) => friend.id));
    const userIds = Array.from(
      new Set([config.id, ...friendIds, ...groupPeerIds])
    );
    const userRecords = await store.getUsersByIds(userIds);
    const usersById = new Map(userRecords.map((user) => [user.id, user]));
    const users = userIds
      .map((id) => usersById.get(id))
      .filter((user): user is NonNullable<typeof user> => Boolean(user));
    const honorTitlesByUserId = await resolveHonorTitles(userIds);

    const dateKeyGroups = new Map<string, number[]>();

    users.forEach((user) => {
      const dateKey = resolveDateKeyForUser(user, offsetDays, baseDate);
      const existing = dateKeyGroups.get(dateKey);
      if (existing) {
        existing.push(user.id);
      } else {
        dateKeyGroups.set(dateKey, [user.id]);
      }
    });

    const dailyStats = (
      await Promise.all(
        Array.from(dateKeyGroups.entries()).map(([dateKey, ids]) =>
          store.getDailyStats({ userIds: ids, dateKey })
        )
      )
    ).flat();
    const statsByUserId = new Map(
      dailyStats.map((stat) => [stat.userId, stat])
    );

    const incomingFriendIds = new Set(
      await store.getIncomingFriendIds(config.id, userIds)
    );
    const buildDailyStat = (
      user: (typeof users)[number],
      isSelf: boolean
    ): DailyStat => {
      const stat = statsByUserId.get(user.id);
      const isMutualFriend =
        friendIds.has(user.id) && incomingFriendIds.has(user.id);
      const isGroupConnected = groupPeerIds.has(user.id);
      const honorTitle = honorTitlesByUserId.get(user.id) ?? null;
      const canView =
        isSelf ||
        user.statsVisibility === "everyone" ||
        (user.statsVisibility === "friends" &&
          (isMutualFriend || isGroupConnected));
      if (!canView) {
        return {
          username: user.wakawarsUsername,
          honorTitle: null,
          totalSeconds: 0,
          status: "private",          error: null,
        };
      }
      if (!stat) {
        return {
          username: user.wakawarsUsername,
          honorTitle,
          totalSeconds: 0,
          status: "pending",          error: null,
        };
      }

      return {
        username: user.wakawarsUsername,
        honorTitle,
        totalSeconds: stat.totalSeconds,
        status: stat.status,
        error: stat.error ?? null,
      };
    };

    const selfUser = users.find((user) => user.id === config.id) ?? null;
    const selfStat = selfUser ? buildDailyStat(selfUser, true) : null;
    const leaderboardUsers = users.filter((user) => user.isCompeting);
    const stats: DailyStat[] = leaderboardUsers.map((user) =>
      buildDailyStat(user, user.id === config.id)
    );

    const computedEntries = computeLeaderboard(stats, config.wakawarsUsername);
    const selfSeconds = selfStat?.totalSeconds ?? null;
    const entries =
      selfSeconds === null
        ? computedEntries
        : computedEntries.map((entry) => ({
            ...entry,
            deltaSeconds: entry.totalSeconds - selfSeconds,
          }));
    const selfEntry =
      entries.find((entry) => entry.username === config.wakawarsUsername) ??
      (selfStat
        ? {
            ...selfStat,
            rank: null,
            deltaSeconds: 0,
          }
        : null);
    const updatedAtEpoch = dailyStats.length
      ? Math.max(...dailyStats.map((stat) => stat.fetchedAt.getTime()))
      : Date.now();

    const response: LeaderboardResponse = {
      date: resolveDateKeyForUser(config, offsetDays, baseDate),
      updatedAt: new Date(updatedAtEpoch).toISOString(),
      entries,
      selfEntry,
    };

    return response;
  };

  const buildDailyHistory = async (
    config: UserConfig,
    days: number
  ): Promise<DailyHistoryResponse> => {
    const offsets = Array.from({ length: days }, (_, index) => -(index + 1));
    const leaderboards = await Promise.all(
      offsets.map((offset) => buildDailyLeaderboard(config, offset))
    );
    const updatedAtEpoch = leaderboards.length
      ? Math.max(
          ...leaderboards.map((entry) => {
            const parsed = Date.parse(entry.updatedAt);
            return Number.isNaN(parsed) ? 0 : parsed;
          })
        )
      : Date.now();

    return {
      updatedAt: new Date(updatedAtEpoch || Date.now()).toISOString(),
      days: leaderboards.map((entry, index) => ({
        date: entry.date,
        offsetDays: Math.abs(offsets[index] ?? 0),
        updatedAt: entry.updatedAt,
        podium: entry.entries
          .filter((candidate) => typeof candidate.rank === "number")
          .slice(0, 3),
      })),
    };
  };

  const canViewUserStats = async ({
    viewer,
    target,
  }: {
    viewer: UserConfig;
    target: UserConfig;
  }): Promise<boolean> => {
    if (viewer.id === target.id) {
      return true;
    }

    if (target.statsVisibility === "everyone") {
      return true;
    }

    if (target.statsVisibility === "no_one") {
      return false;
    }

    const friendIds = new Set(viewer.friends.map((friend) => friend.id));
    const incomingFriendIds = new Set(
      await store.getIncomingFriendIds(viewer.id, [target.id])
    );
    const isMutualFriend =
      friendIds.has(target.id) && incomingFriendIds.has(target.id);
    if (isMutualFriend) {
      return true;
    }

    const groupPeerIds = new Set(await store.getGroupPeerIds(viewer.id));
    return groupPeerIds.has(target.id);
  };

  const buildShopCatalog = async (
    userId: number
  ): Promise<ShopCatalogResponse | null> => {
    const user = await store.getUserById(userId);
    if (!user) {
      return null;
    }

    const skinCatalog = await store.listSkinCatalog();
    const ownedSkinIds = new Set(await store.listOwnedSkinIds(userId));
    return {
      coins: user.coinBalance,
      equippedSkinId: user.equippedSkinId ?? null,
      skins: skinCatalog.map((skin) => ({
        ...skin,
        owned: ownedSkinIds.has(skin.id),
        equipped: user.equippedSkinId === skin.id,
      })),
    };
  };

  const buildWallet = async (
    userId: number
  ): Promise<WalletResponse | null> => {
    const wallet = await store.getWallet({
      userId,
      limit: 20,
    });
    if (!wallet) {
      return null;
    }

    return {
      coins: wallet.coinBalance,
      equippedSkinId: wallet.equippedSkinId,
      transactions: wallet.transactions.map((entry) => ({
        id: entry.id,
        amount: entry.amount,
        reason: entry.reason,
        metadata: entry.metadata,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  };

  const app = new Elysia({ adapter: node() })
    .use(
      cors({
        origin: true,
        methods: ["GET", "POST", "DELETE"],
      })
    )
    .get("/health", () => ({ status: "ok", apps: ["wakawars"] }))
    .group("/wakawars/v0", (group) =>
      group
        .get("/health", () => ({ status: "ok" }))
        .get("/session", async ({ headers }) => {
          const token = headers["x-wakawars-session"];
          if (token) {
            const userId = await sessions.getUserId(token);
            if (userId) {
              const user = await store.getUserById(userId);
              if (user) {
                return {
                  authenticated: true,
                  passwordSet: Boolean(user.passwordHash),
                  wakawarsUsername: user.wakawarsUsername,
                  hasUser: true,
                };
              }
            }
          }

          return {
            authenticated: false,
            passwordSet: false,
            hasUser: false,
          };
        })
        .post(
          "/session/login",
          async ({ body, set }) => {
            const username = normalizeUsername(body.username);
            if (!username) {
              set.status = 400;
              return { error: "Username is required" };
            }
            const user = await store.getUserByUsername(username);

            if (!user) {
              set.status = 404;
              return { error: "User not found" };
            }

            if (user.passwordHash) {
              const ok = await verifyPassword(body.password, user.passwordHash);
              if (!ok) {
                set.status = 401;
                return { error: "Invalid credentials" };
              }
            }

            const sessionId = await sessions.create(user.id);
            return {
              sessionId,
              wakawarsUsername: user.wakawarsUsername,
              passwordSet: Boolean(user.passwordHash),
            };
          },
          {
            body: t.Object({
              username: t.String(),
              password: t.String(),
            }),
          }
        )
        .post("/session/logout", async ({ headers }) => {
          const token = headers["x-wakawars-session"];
          if (token) {
            await sessions.revoke(token);
          }
          return { ok: true };
        })
        .post(
          "/password",
          async ({ body, headers, set }) => {
            const password = body.password.trim();
            if (!password) {
              set.status = 400;
              return { error: "Password is required" };
            }

            const authCheck = await requireSession(headers, set);
            if (!authCheck.ok) {
              return { error: "Unauthorized" };
            }

            const hashed = await hashPassword(password);
            await store.setPassword(authCheck.user.id, hashed);
            return { passwordSet: true };
          },
          {
            body: t.Object({
              password: t.String(),
            }),
          }
        )
        .post(
          "/username",
          async ({ body, headers, set }) => {
            const wakawarsUsername = normalizeUsername(body.wakawarsUsername);
            if (!wakawarsUsername) {
              set.status = 400;
              return { error: "WakaWars username is required" };
            }

            const authCheck = await requireSession(headers, set);
            if (!authCheck.ok) {
              return { error: "Unauthorized" };
            }

            const existing = await store.getUserByUsername(wakawarsUsername);
            if (existing && existing.id !== authCheck.user.id) {
              set.status = 409;
              return { error: "Username already taken" };
            }

            const updated = await store.updateUser(authCheck.user.id, {
              wakawarsUsername,
              apiKey: authCheck.user.apiKey,
            });

            return toPublicConfig(updated);
          },
          {
            body: t.Object({
              wakawarsUsername: t.String(),
            }),
          }
        )
        .get("/config", async ({ headers, set }) => {
          const authCheck = await requireSession(headers, set);
          if (!authCheck.ok) {
            return { error: "Unauthorized" };
          }

          return toPublicConfig(authCheck.user);
        })
        .post(
          "/config",
          async ({ body, set, headers }) => {
            const wakawarsUsername = normalizeUsername(body.wakawarsUsername);
            const apiKey = body.apiKey.trim();

            if (!wakawarsUsername) {
              set.status = 400;
              return { error: "WakaWars username is required" };
            }

            if (!apiKey) {
              set.status = 400;
              return { error: "WakaTime API key is required" };
            }

            const token = headers["x-wakawars-session"];
            if (token) {
              const userId = await sessions.getUserId(token);
              if (!userId) {
                set.status = 401;
                return { error: "Unauthorized" };
              }

              const existing = await store.getUserByUsername(wakawarsUsername);
              if (existing && existing.id !== userId) {
                set.status = 409;
                return { error: "Username already taken" };
              }

              const updated = await store.updateUser(userId, {
                wakawarsUsername,
                apiKey,
              });

              return { config: toPublicConfig(updated) };
            }

            const existing = await store.getUserByUsername(wakawarsUsername);
            if (existing) {
              set.status = 409;
              return { error: "Username already taken" };
            }

            const created = await store.createUser({
              wakawarsUsername,
              apiKey,
            });
            const sessionId = await sessions.create(created.id);
            if (shouldSync) {
              void statusSync.syncUser({
                id: created.id,
                apiKey: created.apiKey,
                wakatimeTimezone: created.wakatimeTimezone ?? null,
              });
            }
            if (shouldCacheWeekly) {
              void weeklyCache.syncUser({
                id: created.id,
                apiKey: created.apiKey,
              });
            }

            return { sessionId, config: toPublicConfig(created) };
          },
          {
            body: t.Object({
              wakawarsUsername: t.String(),
              apiKey: t.String(),
            }),
          }
        )
        .post(
          "/visibility",
          async ({ body, headers, set }) => {
            const authCheck = await requireSession(headers, set);
            if (!authCheck.ok) {
              return { error: "Unauthorized" };
            }

            const updated = await store.setStatsVisibility(
              authCheck.user.id,
              body.visibility
            );

            return toPublicConfig(updated);
          },
          {
            body: t.Object({
              visibility: t.Union([
                t.Literal("everyone"),
                t.Literal("friends"),
                t.Literal("no_one"),
              ]),
            }),
          }
        )
        .post(
          "/competition",
          async ({ body, headers, set }) => {
            const authCheck = await requireSession(headers, set);
            if (!authCheck.ok) {
              return { error: "Unauthorized" };
            }

            const updated = await store.setCompetitionStatus(
              authCheck.user.id,
              body.isCompeting
            );

            return toPublicConfig(updated);
          },
          {
            body: t.Object({
              isCompeting: t.Boolean(),
            }),
          }
        )
        .post(
          "/honor-title",
          async ({ body, headers, set }) => {
            const authCheck = await requireSession(headers, set);
            if (!authCheck.ok) {
              return { error: "Unauthorized" };
            }

            // Collapse whitespace, strip wrapping quotes/markdown, and cap the
            // length so a hand-typed title matches what the AI path produces.
            const cleaned = body.title
              .replace(/["'`*_]/g, "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, MAX_HONOR_TITLE_LENGTH)
              .trim();

            await store.setCustomHonorTitle({
              userId: authCheck.user.id,
              title: cleaned || null,
            });

            const resolved = await resolveHonorTitles([authCheck.user.id]);
            return { honorTitle: resolved.get(authCheck.user.id) ?? null };
          },
          {
            body: t.Object({
              title: t.String(),
            }),
          }
        )
        .get(
          "/users/search",
          async ({ query, headers, set }) => {
            const authCheck = await requireSession(headers, set);
            if (!authCheck.ok) {
              return { error: "Unauthorized" };
            }

            const results = await store.searchUsers(query.q, {
              excludeUserId: authCheck.user.id,
            });

            return {
              users: results.map((user) => ({
                username: user.wakawarsUsername,
              })),
            };
          },
          {
            query: t.Object({
              q: t.String(),
            }),
          }
        )
        .get(
          "/achievements",
          async ({ headers, set }) => {
            const authCheck = await requireSession(headers, set);
            if (!authCheck.ok) {
              return { error: "Unauthorized" };
            }

            const unlocks = await store.listAchievementUnlocks({
              userId: authCheck.user.id,
            });
            const totalUnlocks = unlocks.reduce(
              (sum, achievement) => sum + achievement.count,
              0
            );
            const achievements = toAchievementBoard(unlocks);

            return {
              username: authCheck.user.wakawarsUsername,
              totalUnlocks,
              unlockedCount: unlocks.length,
              totalDefined: ACHIEVEMENT_DEFINITIONS.length,
              achievements,
            };
          }
        )
        .get(
          "/achievements/:username",
          async ({ params, headers, set }) => {
            const authCheck = await requireSession(headers, set);
            if (!authCheck.ok) {
              return { error: "Unauthorized" };
            }

            const username = normalizeUsername(params.username);
            if (!username) {
              set.status = 400;
              return { error: "Username is required" };
            }

            const target = await store.getUserByUsername(username);
            if (!target) {
              set.status = 404;
              return { error: "User not found" };
            }

            const canView = await canViewUserStats({
              viewer: authCheck.user,
              target,
            });
            if (!canView) {
              set.status = 403;
              return { error: "Achievements are private" };
            }

            const unlocks = await store.listAchievementUnlocks({
              userId: target.id,
            });
            const achievements = toAchievementDisplay(unlocks);
            const totalUnlocks = achievements.reduce(
              (sum, achievement) => sum + achievement.count,
              0
            );

            return {
              username: target.wakawarsUsername,
              totalUnlocks,
              achievements,
            };
          },
          {
            params: t.Object({
              username: t.String(),
            }),
          }
        )
        .get("/wallet", async ({ headers, set }) => {
          const authCheck = await requireSession(headers, set);
          if (!authCheck.ok) {
            return { error: "Unauthorized" };
          }

          const wallet = await buildWallet(authCheck.user.id);
          if (!wallet) {
            set.status = 401;
            return { error: "Unauthorized" };
          }

          return wallet;
        })
        .get("/shop/skins", async ({ headers, set }) => {
          const authCheck = await requireSession(headers, set);
          if (!authCheck.ok) {
            return { error: "Unauthorized" };
          }

          const catalog = await buildShopCatalog(authCheck.user.id);
          if (!catalog) {
            set.status = 401;
            return { error: "Unauthorized" };
          }

          return catalog;
        })
        .post(
          "/shop/skins/:skinId/purchase",
          async ({ params, headers, set }) => {
            const authCheck = await requireSession(headers, set);
            if (!authCheck.ok) {
              return { error: "Unauthorized" };
            }

            const skinId = params.skinId.trim().toLowerCase();
            if (!skinId || skinId === "classic") {
              set.status = 404;
              return { error: "Skin not found" };
            }

            const selectedSkin = await store.getSkinCatalogItemById(skinId);
            if (!selectedSkin) {
              set.status = 404;
              return { error: "Skin not found" };
            }

            const result = await store.purchaseSkin({
              userId: authCheck.user.id,
              skinId: selectedSkin.id,
              purchasedAt: new Date(),
            });

            if (result === "insufficient_funds") {
              set.status = 409;
              return { error: "Not enough coins" };
            }
            if (result === "skin_not_found") {
              set.status = 404;
              return { error: "Skin not found" };
            }
            if (result === "user_not_found") {
              set.status = 401;
              return { error: "Unauthorized" };
            }

            const catalog = await buildShopCatalog(authCheck.user.id);
            if (!catalog) {
              set.status = 401;
              return { error: "Unauthorized" };
            }

            return catalog;
          },
          {
            params: t.Object({
              skinId: t.String(),
            }),
          }
        )
        .post(
          "/shop/skins/:skinId/equip",
          async ({ params, headers, set }) => {
            const authCheck = await requireSession(headers, set);
            if (!authCheck.ok) {
              return { error: "Unauthorized" };
            }

            const requestedSkin = params.skinId.trim().toLowerCase();
            const isClassic = requestedSkin === "classic";
            if (!isClassic && !requestedSkin) {
              set.status = 404;
              return { error: "Skin not found" };
            }

            const nextSkinId: SkinId | null = isClassic ? null : requestedSkin;
            if (nextSkinId) {
              const selectedSkin = await store.getSkinCatalogItemById(nextSkinId);
              if (!selectedSkin) {
                set.status = 404;
                return { error: "Skin not found" };
              }
            }

            if (nextSkinId) {
              const owned = new Set(await store.listOwnedSkinIds(authCheck.user.id));
              if (!owned.has(nextSkinId)) {
                set.status = 403;
                return { error: "Skin not owned" };
              }
            }

            await store.setEquippedSkin(authCheck.user.id, nextSkinId);
            const catalog = await buildShopCatalog(authCheck.user.id);
            if (!catalog) {
              set.status = 401;
              return { error: "Unauthorized" };
            }

            return catalog;
          },
          {
            params: t.Object({
              skinId: t.String(),
            }),
          }
        )
        .post(
          "/friends",
          async ({ body, set, headers }) => {
            const authCheck = await requireSession(headers, set);
            if (!authCheck.ok) {
              return { error: "Unauthorized" };
            }

            const friendUsername = normalizeFriendUsername(body.username);

            if (!friendUsername) {
              set.status = 400;
              return { error: "Friend username is required" };
            }

            const friend = await store.getUserByUsername(friendUsername);
            if (!friend) {
              set.status = 404;
              return { error: "Friend not found" };
            }

            if (friend.id === authCheck.user.id) {
              return toPublicConfig(authCheck.user);
            }

            const updated = await store.addFriendship(
              authCheck.user.id,
              friend.id
            );

            return toPublicConfig(updated);
          },
          {
            body: t.Object({
              username: t.String(),
            }),
          }
        )
        .delete(
          "/friends/:username",
          async ({ params, headers, set }) => {
            const authCheck = await requireSession(headers, set);
            if (!authCheck.ok) {
              return { error: "Unauthorized" };
            }

            const friendUsername = normalizeFriendUsername(params.username);

            const friend = await store.getUserByUsername(friendUsername);
            if (!friend) {
              return toPublicConfig(authCheck.user);
            }

            const updated = await store.removeFriendship(
              authCheck.user.id,
              friend.id
            );

            return toPublicConfig(updated);
          },
          {
            params: t.Object({
              username: t.String(),
            }),
          }
        )
        .post(
          "/groups",
          async ({ body, headers, set }) => {
            const authCheck = await requireSession(headers, set);
            if (!authCheck.ok) {
              return { error: "Unauthorized" };
            }

            const name = body.name.trim();
            if (!name) {
              set.status = 400;
              return { error: "Group name is required" };
            }

            const nameKey = name.toLowerCase();
            const hasGroup = authCheck.user.groups.some(
              (group) => group.name.toLowerCase() === nameKey
            );
            if (hasGroup) {
              set.status = 409;
              return { error: "Group name already exists" };
            }

            const updated = await store.createGroup(authCheck.user.id, name);
            return toPublicConfig(updated);
          },
          {
            body: t.Object({
              name: t.String(),
            }),
          }
        )
        .delete(
          "/groups/:groupId",
          async ({ params, headers, set }) => {
            const authCheck = await requireSession(headers, set);
            if (!authCheck.ok) {
              return { error: "Unauthorized" };
            }

            const groupId = Number(params.groupId);
            if (!Number.isFinite(groupId)) {
              set.status = 400;
              return { error: "Invalid group id" };
            }

            const updated = await store.deleteGroup(authCheck.user.id, groupId);
            return toPublicConfig(updated);
          },
          {
            params: t.Object({
              groupId: t.String(),
            }),
          }
        )
        .post(
          "/groups/:groupId/members",
          async ({ params, body, headers, set }) => {
            const authCheck = await requireSession(headers, set);
            if (!authCheck.ok) {
              return { error: "Unauthorized" };
            }

            const groupId = Number(params.groupId);
            if (!Number.isFinite(groupId)) {
              set.status = 400;
              return { error: "Invalid group id" };
            }

            const group = authCheck.user.groups.find(
              (entry) => entry.id === groupId
            );
            if (!group) {
              set.status = 404;
              return { error: "Group not found" };
            }

            const memberUsername = normalizeFriendUsername(body.username);
            if (!memberUsername) {
              set.status = 400;
              return { error: "Member username is required" };
            }

            const member = await store.getUserByUsername(memberUsername);
            if (!member) {
              set.status = 404;
              return { error: "User not found" };
            }

            const updated = await store.addGroupMember(
              authCheck.user.id,
              groupId,
              member.id
            );
            return toPublicConfig(updated);
          },
          {
            params: t.Object({
              groupId: t.String(),
            }),
            body: t.Object({
              username: t.String(),
            }),
          }
        )
        .delete(
          "/groups/:groupId/members/:username",
          async ({ params, headers, set }) => {
            const authCheck = await requireSession(headers, set);
            if (!authCheck.ok) {
              return { error: "Unauthorized" };
            }

            const groupId = Number(params.groupId);
            if (!Number.isFinite(groupId)) {
              set.status = 400;
              return { error: "Invalid group id" };
            }

            const group = authCheck.user.groups.find(
              (entry) => entry.id === groupId
            );
            if (!group) {
              set.status = 404;
              return { error: "Group not found" };
            }

            const memberUsername = normalizeFriendUsername(params.username);
            if (!memberUsername) {
              set.status = 400;
              return { error: "Member username is required" };
            }

            const member = await store.getUserByUsername(memberUsername);
            if (!member) {
              return toPublicConfig(authCheck.user);
            }

            const updated = await store.removeGroupMember(
              authCheck.user.id,
              groupId,
              member.id
            );
            return toPublicConfig(updated);
          },
          {
            params: t.Object({
              groupId: t.String(),
              username: t.String(),
            }),
          }
        )
        .get("/stats/today", async ({ set, headers }) => {
          const authCheck = await requireSession(headers, set);
          if (!authCheck.ok) {
            return { error: "Unauthorized" };
          }

          const config = await store.getUserById(authCheck.user.id);
          if (!config) {
            set.status = 401;
            return { error: "Unauthorized" };
          }

          if (!config.wakawarsUsername || !config.apiKey) {
            set.status = 400;
            return { error: "App is not configured" };
          }

          return buildDailyLeaderboard(config, 0);
        })
        .get("/stats/yesterday", async ({ set, headers }) => {
          const authCheck = await requireSession(headers, set);
          if (!authCheck.ok) {
            return { error: "Unauthorized" };
          }

          const config = await store.getUserById(authCheck.user.id);
          if (!config) {
            set.status = 401;
            return { error: "Unauthorized" };
          }

          if (!config.wakawarsUsername || !config.apiKey) {
            set.status = 400;
            return { error: "App is not configured" };
          }

          return buildDailyLeaderboard(config, -1);
        })
        .get("/stats/history", async ({ set, headers }) => {
          const authCheck = await requireSession(headers, set);
          if (!authCheck.ok) {
            return { error: "Unauthorized" };
          }

          const config = await store.getUserById(authCheck.user.id);
          if (!config) {
            set.status = 401;
            return { error: "Unauthorized" };
          }

          if (!config.wakawarsUsername || !config.apiKey) {
            set.status = 400;
            return { error: "App is not configured" };
          }

          return buildDailyHistory(config, MAX_HISTORY_DAYS);
        })
        .get(
          "/stats/day",
          async ({ set, headers, query }) => {
            const authCheck = await requireSession(headers, set);
            if (!authCheck.ok) {
              return { error: "Unauthorized" };
            }

            const config = await store.getUserById(authCheck.user.id);
            if (!config) {
              set.status = 401;
              return { error: "Unauthorized" };
            }

            if (!config.wakawarsUsername || !config.apiKey) {
              set.status = 400;
              return { error: "App is not configured" };
            }

            const rawOffset = Number(query.offset ?? "0");
            const offset = Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0;
            const boundedOffset = Math.min(
              0,
              Math.max(-MAX_HISTORY_DAYS, offset)
            );

            return buildDailyLeaderboard(config, boundedOffset);
          },
          {
            query: t.Object({
              offset: t.Optional(t.String()),
            }),
          }
        )
        .post("/stats/refresh", async ({ set, headers }) => {
          const authCheck = await requireSession(headers, set);
          if (!authCheck.ok) {
            return { error: "Unauthorized" };
          }

          const config = await store.getUserById(authCheck.user.id);
          if (!config) {
            set.status = 401;
            return { error: "Unauthorized" };
          }

          if (!config.wakawarsUsername || !config.apiKey) {
            set.status = 400;
            return { error: "App is not configured" };
          }

          await statusSync.syncUser({
            id: config.id,
            apiKey: config.apiKey,
            wakatimeTimezone: config.wakatimeTimezone ?? null,
            bypassCache: true
          });

          return buildDailyLeaderboard(config, 0);
        })
        .get("/stats/weekly", async ({ set, headers }) => {
          const authCheck = await requireSession(headers, set);
          if (!authCheck.ok) {
            return { error: "Unauthorized" };
          }

          const config = await store.getUserById(authCheck.user.id);
          if (!config) {
            set.status = 401;
            return { error: "Unauthorized" };
          }

          if (!config.wakawarsUsername || !config.apiKey) {
            set.status = 400;
            return { error: "App is not configured" };
          }

          const groupPeerIds = new Set(await store.getGroupPeerIds(config.id));
          const friendIds = new Set(config.friends.map((friend) => friend.id));
          const userIds = Array.from(
            new Set([config.id, ...friendIds, ...groupPeerIds])
          );
          const userRecords = await store.getUsersByIds(userIds);
          const usersById = new Map(userRecords.map((user) => [user.id, user]));
          const users = userIds
            .map((id) => usersById.get(id))
            .filter((user): user is NonNullable<typeof user> => Boolean(user));
          const honorTitlesByUserId = await resolveHonorTitles(userIds);

          type WeeklyStatView = {
            totalSeconds: number;
            dailyAverageSeconds: number;
            status: WeeklyStat["status"];
            error: string | null;
            fetchedAt: number;
          };
          const cachedStats = weeklyCache.getStats({ userIds, rangeKey });
          const statsByUserId = new Map<number, WeeklyStatView>(
            cachedStats.map((stat) => [
              stat.userId,
              {
                totalSeconds: stat.result.totalSeconds,
                dailyAverageSeconds: stat.result.dailyAverageSeconds,
                status: stat.result.status,
                error: stat.result.error ?? null,
                fetchedAt: stat.result.fetchedAt,
              },
            ])
          );
          // Restart-safety: the weekly cache is in-memory, so on a cold start it
          // is empty. Fall back to the persisted weekly stats for any user the
          // cache has not yet refreshed (mirrors the daily board).
          const missingWeeklyIds = userIds.filter((id) => !statsByUserId.has(id));
          if (missingWeeklyIds.length > 0) {
            const persisted = await store.getWeeklyStats({
              userIds: missingWeeklyIds,
              rangeKey,
            });
            persisted.forEach((stat) => {
              statsByUserId.set(stat.userId, {
                totalSeconds: stat.totalSeconds,
                dailyAverageSeconds: stat.dailyAverageSeconds,
                status: stat.status,
                error: stat.error,
                fetchedAt: stat.fetchedAt.getTime(),
              });
            });
          }
          const incomingFriendIds = new Set(
            await store.getIncomingFriendIds(config.id, userIds)
          );
          const buildWeeklyStat = (
            user: (typeof users)[number],
            isSelf: boolean
          ): WeeklyStat => {
            const stat = statsByUserId.get(user.id);
            const isMutualFriend =
              friendIds.has(user.id) && incomingFriendIds.has(user.id);
            const isGroupConnected = groupPeerIds.has(user.id);
            const honorTitle = honorTitlesByUserId.get(user.id) ?? null;
            const canView =
              isSelf ||
              user.statsVisibility === "everyone" ||
              (user.statsVisibility === "friends" &&
                (isMutualFriend || isGroupConnected));
            if (!canView) {
              return {
                username: user.wakawarsUsername,
                honorTitle: null,
                totalSeconds: 0,
                dailyAverageSeconds: 0,
                status: "private",                error: null,
              };
            }
            if (!stat) {
              return {
                username: user.wakawarsUsername,
                honorTitle,
                totalSeconds: 0,
                dailyAverageSeconds: 0,
                status: "pending",                error: null,
              };
            }

            return {
              username: user.wakawarsUsername,
              honorTitle,
              totalSeconds: stat.totalSeconds,
              dailyAverageSeconds: stat.dailyAverageSeconds,
              status: stat.status,
              error: stat.error ?? null,
            };
          };

          const selfUser = users.find((user) => user.id === config.id) ?? null;
          const selfStat = selfUser ? buildWeeklyStat(selfUser, true) : null;
          const leaderboardUsers = users.filter((user) => user.isCompeting);
          const stats: WeeklyStat[] = leaderboardUsers.map((user) =>
            buildWeeklyStat(user, user.id === config.id)
          );

          const computedEntries = computeLeaderboard(stats, config.wakawarsUsername);
          const selfSeconds = selfStat?.totalSeconds ?? null;
          const entries =
            selfSeconds === null
              ? computedEntries
              : computedEntries.map((entry) => ({
                  ...entry,
                  deltaSeconds: entry.totalSeconds - selfSeconds,
                }));
          const selfEntry =
            entries.find(
              (entry) => entry.username === config.wakawarsUsername
            ) ??
            (selfStat
              ? {
                  ...selfStat,
                  rank: null,
                  deltaSeconds: 0,
                }
              : null);
          const weeklyFetchedAts = Array.from(statsByUserId.values()).map(
            (stat) => stat.fetchedAt
          );
          const updatedAtEpoch = weeklyFetchedAts.length
            ? Math.max(...weeklyFetchedAts)
            : Date.now();

          const response: WeeklyLeaderboardResponse = {
            range: rangeKey,
            updatedAt: new Date(updatedAtEpoch).toISOString(),
            entries,
            selfEntry,
          };

          return response;
        })
    );

  const listen = () => {
    app.listen({ port, hostname });
    if (shouldSync) {
      statusSync.start();
      providerLogCleanup.start();
    }
    if (shouldCacheWeekly) {
      weeklyCache.start();
    }
    return app;
  };

  const disconnect = async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  };

  const close = async () => {
    if (app.server) {
      await new Promise<void>((resolve) => app.server?.close(() => resolve()));
    }
    statusSync.stop();
    weeklyCache.stop();
    providerLogCleanup.stop();
    await disconnect();
  };

  return { app, listen, store, disconnect, close, statusSync, weeklyCache };
};
