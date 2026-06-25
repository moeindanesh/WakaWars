import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type {
  DailyStatStatus,
  PurchasableSkinId,
  SkinCatalogItem,
  SkinId,
  StatsVisibility,
  UserConfig,
  WalletTransactionReason
} from "@molty/shared";

export type DailyStatRecord = {
  userId: number;
  username: string;
  totalSeconds: number;
  status: DailyStatStatus;
  error: string | null;
  fetchedAt: Date;
};

export type WeeklyStatRecord = {
  userId: number;
  username: string;
  totalSeconds: number;
  dailyAverageSeconds: number;
  status: DailyStatStatus;
  error: string | null;
  fetchedAt: Date;
};

export type ProviderLogRecord = {
  provider: string;
  userId?: number | null;
  endpoint: string;
  rangeKey?: string | null;
  statusCode?: number | null;
  ok: boolean;
  payload?: unknown | null;
  error?: string | null;
  fetchedAt: Date;
};

export type CoinTransactionRecord = {
  id: number;
  amount: number;
  reason: WalletTransactionReason;
  metadata: unknown | null;
  createdAt: Date;
};

export type AchievementContextKind = "daily" | "weekly";

export type AchievementGrantRecord = {
  userId: number;
  achievementId: string;
  contextKind: AchievementContextKind;
  contextKey: string;
  awardedAt: Date;
  metadata?: unknown | null;
};

export type AchievementUnlockSummary = {
  achievementId: string;
  count: number;
  firstAwardedAt: Date;
  lastAwardedAt: Date;
};

export type AchievementGrantSummary = {
  userId: number;
  achievementId: string;
  contextKind: AchievementContextKind;
  contextKey: string;
  awardedAt: Date;
};
export type PurchaseSkinResult =
  | "purchased"
  | "already_owned"
  | "insufficient_funds"
  | "skin_not_found"
  | "user_not_found";

export type UserRepository = {
  countUsers: () => Promise<number>;
  listUsers: () => Promise<
    Array<{
      id: number;
      wakawarsUsername: string;
      apiKey: string;
      wakatimeTimezone?: string | null;
    }>
  >;
  getUsersByIds: (
    userIds: number[]
  ) => Promise<
    Array<{
      id: number;
      wakawarsUsername: string;
      statsVisibility: StatsVisibility;
      isCompeting: boolean;
      coinBalance?: number;
      equippedSkinId: SkinId | null;
      wakatimeTimezone?: string | null;
    }>
  >;
  getUserById: (userId: number) => Promise<UserConfig | null>;
  getUserByUsername: (username: string) => Promise<UserConfig | null>;
  createUser: (config: { wakawarsUsername: string; apiKey: string }) => Promise<UserConfig>;
  updateUser: (
    userId: number,
    config: { wakawarsUsername: string; apiKey: string }
  ) => Promise<UserConfig>;
  setWakaTimeTimezone: (userId: number, timeZone: string) => Promise<UserConfig>;
  setPassword: (userId: number, passwordHash: string | null) => Promise<UserConfig>;
  setStatsVisibility: (userId: number, visibility: StatsVisibility) => Promise<UserConfig>;
  setCompetitionStatus: (userId: number, isCompeting: boolean) => Promise<UserConfig>;
  addFriendship: (userId: number, friendId: number) => Promise<UserConfig>;
  removeFriendship: (userId: number, friendId: number) => Promise<UserConfig>;
  createGroup: (userId: number, name: string) => Promise<UserConfig>;
  deleteGroup: (userId: number, groupId: number) => Promise<UserConfig>;
  addGroupMember: (userId: number, groupId: number, memberId: number) => Promise<UserConfig>;
  removeGroupMember: (userId: number, groupId: number, memberId: number) => Promise<UserConfig>;
  getIncomingFriendIds: (userId: number, candidateIds: number[]) => Promise<number[]>;
  getGroupPeerIds: (userId: number) => Promise<number[]>;
  getGroupOwnerIdsForMember: (
    memberId: number,
    ownerIds: number[]
  ) => Promise<number[]>;
  searchUsers: (
    query: string,
    options?: { excludeUserId?: number; limit?: number }
  ) => Promise<Array<{ id: number; wakawarsUsername: string }>>;
  upsertDailyStat: (input: {
    userId: number;
    dateKey: string;
    totalSeconds: number;
    status: DailyStatStatus;
    error?: string | null;
    fetchedAt: Date;
  }) => Promise<void>;
  getDailyStats: (input: {
    userIds: number[];
    dateKey: string;
  }) => Promise<DailyStatRecord[]>;
  upsertWeeklyStat: (input: {
    userId: number;
    rangeKey: string;
    totalSeconds: number;
    dailyAverageSeconds: number;
    status: DailyStatStatus;
    error?: string | null;
    fetchedAt: Date;
  }) => Promise<void>;
  getWeeklyStats: (input: {
    userIds: number[];
    rangeKey: string;
  }) => Promise<WeeklyStatRecord[]>;
  getWallet: (input: {
    userId: number;
    limit?: number;
  }) => Promise<{
    coinBalance: number;
    equippedSkinId: SkinId | null;
    transactions: CoinTransactionRecord[];
  } | null>;
  listSkinCatalog: () => Promise<SkinCatalogItem[]>;
  getSkinCatalogItemById: (skinId: string) => Promise<SkinCatalogItem | null>;
  listOwnedSkinIds: (userId: number) => Promise<SkinId[]>;
  purchaseSkin: (input: {
    userId: number;
    skinId: PurchasableSkinId;
    purchasedAt: Date;
  }) => Promise<PurchaseSkinResult>;
  setEquippedSkin: (userId: number, skinId: SkinId | null) => Promise<UserConfig>;
  settleDailyReward: (input: {
    userId: number;
    dateKey: string;
    rank: number | null;
    coinsAwarded: number;
    settledAt: Date;
  }) => Promise<{ applied: boolean; coinBalance: number | null }>;
  grantAchievement: (input: AchievementGrantRecord) => Promise<void>;
  listAchievementUnlocks: (input: {
    userId: number;
  }) => Promise<AchievementUnlockSummary[]>;
  listAchievementGrants: (input: {
    userIds: number[];
    achievementIds?: string[];
    contextKind?: AchievementContextKind;
  }) => Promise<AchievementGrantSummary[]>;
  createProviderLog: (input: ProviderLogRecord) => Promise<void>;
  deleteProviderLogsOlderThan: (cutoff: Date) => Promise<number>;
  getAiHonorTitles: (userIds: number[]) => Promise<Map<number, string | null>>;
  getAiHonorTitleState: (userId: number) => Promise<{
    title: string | null;
    signature: string | null;
    generatedAt: Date | null;
  } | null>;
  setAiHonorTitle: (input: {
    userId: number;
    title: string;
    signature: string;
    generatedAt: Date;
  }) => Promise<void>;
};

type PrismaUser = {
  id: number;
  wakawars_username: string;
  api_key: string;
  wakatime_timezone: string | null;
  password_hash: string | null;
  stats_visibility: StatsVisibility;
  is_competing: boolean;
  coin_balance: number;
  equipped_skin_id: string | null;
  friendships: Array<{
    friend_id: number;
    friend: {
      id: number;
      wakawars_username: string;
      api_key: string;
    };
  }>;
  groups_owned: Array<{
    id: number;
    name: string;
    members: Array<{
      user_id: number;
      user: {
        id: number;
        wakawars_username: string;
      };
    }>;
  }>;
};

const mapUserToConfig = (user: PrismaUser): UserConfig => ({
  id: user.id,
  wakawarsUsername: user.wakawars_username,
  apiKey: user.api_key,
  wakatimeTimezone: user.wakatime_timezone ?? null,
  statsVisibility: user.stats_visibility,
  isCompeting: user.is_competing,
  coinBalance: user.coin_balance,
  equippedSkinId: (user.equipped_skin_id as SkinId | null) ?? null,
  passwordHash: user.password_hash,
  friends: user.friendships.map((friendship) => ({
    id: friendship.friend_id,
    username: friendship.friend.wakawars_username,
    apiKey: friendship.friend.api_key || null
  })),
  groups: user.groups_owned.map((group) => ({
    id: group.id,
    name: group.name,
    members: group.members.map((member) => ({
      id: member.user.id,
      username: member.user.wakawars_username
    }))
  }))
});

const userInclude = {
  friendships: {
    include: {
      friend: true
    }
  },
  groups_owned: {
    include: {
      members: {
        include: {
          user: true
        }
      }
    }
  }
} as const;

const toPrismaJson = (value: unknown | null | undefined) =>
  value === undefined
    ? undefined
    : value === null
      ? Prisma.DbNull
      : (value as Prisma.InputJsonValue);

export const createPrismaRepository = (prisma: PrismaClient): UserRepository => {
  const countUsers = async () => prisma.ww_user.count();

  const listUsers = async () => {
    const users = await prisma.ww_user.findMany({
      select: {
        id: true,
        wakawars_username: true,
        api_key: true,
        wakatime_timezone: true
      }
    });

    return users.map((user) => ({
      id: user.id,
      wakawarsUsername: user.wakawars_username,
      apiKey: user.api_key,
      wakatimeTimezone: user.wakatime_timezone ?? null
    }));
  };

  const getUsersByIds = async (userIds: number[]) => {
    if (userIds.length === 0) return [];

    const users = await prisma.ww_user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        wakawars_username: true,
        stats_visibility: true,
        is_competing: true,
        coin_balance: true,
        equipped_skin_id: true,
        wakatime_timezone: true
      }
    });

    return users.map((user) => ({
      id: user.id,
      wakawarsUsername: user.wakawars_username,
      statsVisibility: user.stats_visibility as StatsVisibility,
      isCompeting: Boolean(user.is_competing),
      coinBalance: user.coin_balance,
      equippedSkinId: (user.equipped_skin_id as SkinId | null) ?? null,
      wakatimeTimezone: user.wakatime_timezone ?? null
    }));
  };

  const getUserById = async (userId: number) => {
    const user = await prisma.ww_user.findUnique({
      where: { id: userId },
      include: userInclude
    });

    if (!user) {
      return null;
    }

    return mapUserToConfig(user as PrismaUser);
  };

  const getUserByUsername = async (username: string) => {
    const user = await prisma.ww_user.findUnique({
      where: { wakawars_username: username },
      include: userInclude
    });

    if (!user) {
      return null;
    }

    return mapUserToConfig(user as PrismaUser);
  };

  const createUser = async ({
    wakawarsUsername,
    apiKey
  }: {
    wakawarsUsername: string;
    apiKey: string;
  }) => {
    const user = await prisma.ww_user.create({
      data: {
        wakawars_username: wakawarsUsername,
        api_key: apiKey
      },
      include: userInclude
    });

    return mapUserToConfig(user as PrismaUser);
  };

  const updateUser = async (
    userId: number,
    {
      wakawarsUsername,
      apiKey
    }: {
      wakawarsUsername: string;
      apiKey: string;
    }
  ) => {
    const user = await prisma.ww_user.update({
      where: { id: userId },
      data: { wakawars_username: wakawarsUsername, api_key: apiKey },
      include: userInclude
    });

    return mapUserToConfig(user as PrismaUser);
  };

  const setWakaTimeTimezone = async (userId: number, timeZone: string) => {
    const user = await prisma.ww_user.update({
      where: { id: userId },
      data: { wakatime_timezone: timeZone },
      include: userInclude
    });

    return mapUserToConfig(user as PrismaUser);
  };

  const setPassword = async (userId: number, passwordHash: string | null) => {
    const user = await prisma.ww_user.update({
      where: { id: userId },
      data: { password_hash: passwordHash },
      include: userInclude
    });

    return mapUserToConfig(user as PrismaUser);
  };

  const setStatsVisibility = async (userId: number, visibility: StatsVisibility) => {
    const user = await prisma.ww_user.update({
      where: { id: userId },
      data: { stats_visibility: visibility },
      include: userInclude
    });

    return mapUserToConfig(user as PrismaUser);
  };

  const setCompetitionStatus = async (userId: number, isCompeting: boolean) => {
    const user = await prisma.ww_user.update({
      where: { id: userId },
      data: { is_competing: isCompeting },
      include: userInclude
    });

    return mapUserToConfig(user as PrismaUser);
  };

  const addFriendship = async (userId: number, friendId: number) => {
    if (userId !== friendId) {
      await prisma.ww_friendship.upsert({
        where: {
          user_id_friend_id: {
            user_id: userId,
            friend_id: friendId
          }
        },
        create: {
          user_id: userId,
          friend_id: friendId
        },
        update: {}
      });
    }

    const updated = await prisma.ww_user.findUnique({
      where: { id: userId },
      include: userInclude
    });

    return mapUserToConfig(updated as PrismaUser);
  };

  const removeFriendship = async (userId: number, friendId: number) => {
    await prisma.ww_friendship.deleteMany({
      where: {
        user_id: userId,
        friend_id: friendId
      }
    });

    const updated = await prisma.ww_user.findUnique({
      where: { id: userId },
      include: userInclude
    });

    return mapUserToConfig(updated as PrismaUser);
  };

  const createGroup = async (userId: number, name: string) => {
    await prisma.ww_group.create({
      data: {
        owner_id: userId,
        name
      }
    });

    const updated = await prisma.ww_user.findUnique({
      where: { id: userId },
      include: userInclude
    });

    return mapUserToConfig(updated as PrismaUser);
  };

  const deleteGroup = async (userId: number, groupId: number) => {
    await prisma.ww_group.deleteMany({
      where: {
        id: groupId,
        owner_id: userId
      }
    });

    const updated = await prisma.ww_user.findUnique({
      where: { id: userId },
      include: userInclude
    });

    return mapUserToConfig(updated as PrismaUser);
  };

  const addGroupMember = async (userId: number, groupId: number, memberId: number) => {
    if (userId === memberId) {
      const updated = await prisma.ww_user.findUnique({
        where: { id: userId },
        include: userInclude
      });

      return mapUserToConfig(updated as PrismaUser);
    }

    const group = await prisma.ww_group.findFirst({
      where: {
        id: groupId,
        owner_id: userId
      }
    });

    if (group) {
      await prisma.ww_group_member.upsert({
        where: {
          group_id_user_id: {
            group_id: groupId,
            user_id: memberId
          }
        },
        create: {
          group_id: groupId,
          user_id: memberId
        },
        update: {}
      });
    }

    const updated = await prisma.ww_user.findUnique({
      where: { id: userId },
      include: userInclude
    });

    return mapUserToConfig(updated as PrismaUser);
  };

  const removeGroupMember = async (userId: number, groupId: number, memberId: number) => {
    const group = await prisma.ww_group.findFirst({
      where: {
        id: groupId,
        owner_id: userId
      }
    });

    if (group) {
      await prisma.ww_group_member.deleteMany({
        where: {
          group_id: groupId,
          user_id: memberId
        }
      });
    }

    const updated = await prisma.ww_user.findUnique({
      where: { id: userId },
      include: userInclude
    });

    return mapUserToConfig(updated as PrismaUser);
  };

  const getIncomingFriendIds = async (userId: number, candidateIds: number[]) => {
    if (candidateIds.length === 0) return [];

    const rows = await prisma.ww_friendship.findMany({
      where: {
        user_id: { in: candidateIds },
        friend_id: userId
      },
      select: { user_id: true }
    });

    return rows.map((row) => row.user_id);
  };

  const getGroupPeerIds = async (userId: number) => {
    const groups = await prisma.ww_group.findMany({
      where: {
        OR: [
          { owner_id: userId },
          { members: { some: { user_id: userId } } }
        ]
      },
      select: {
        owner_id: true,
        members: { select: { user_id: true } }
      }
    });

    const ids = new Set<number>();
    groups.forEach((group) => {
      ids.add(group.owner_id);
      group.members.forEach((member) => ids.add(member.user_id));
    });
    ids.delete(userId);
    return Array.from(ids);
  };

  const getGroupOwnerIdsForMember = async (memberId: number, ownerIds: number[]) => {
    if (ownerIds.length === 0) return [];

    const rows = await prisma.ww_group_member.findMany({
      where: {
        user_id: memberId,
        group: {
          owner_id: { in: ownerIds }
        }
      },
      select: {
        group: {
          select: { owner_id: true }
        }
      }
    });

    return rows.map((row) => row.group.owner_id);
  };

  const searchUsers = async (
    query: string,
    options?: { excludeUserId?: number; limit?: number }
  ) => {
    const normalized = query.trim();
    if (!normalized) {
      return [];
    }

    const users = await prisma.ww_user.findMany({
      where: {
        wakawars_username: {
          contains: normalized,
          mode: "insensitive"
        },
        ...(options?.excludeUserId ? { id: { not: options.excludeUserId } } : {})
      },
      take: options?.limit ?? 8,
      orderBy: { wakawars_username: "asc" }
    });

    return users.map((user) => ({
      id: user.id,
      wakawarsUsername: user.wakawars_username
    }));
  };

  const upsertDailyStat = async ({
    userId,
    dateKey,
    totalSeconds,
    status,
    error,
    fetchedAt
  }: {
    userId: number;
    dateKey: string;
    totalSeconds: number;
    status: DailyStatStatus;
    error?: string | null;
    fetchedAt: Date;
  }) => {
    await prisma.ww_daily_stat.upsert({
      where: {
        user_id_date_key: {
          user_id: userId,
          date_key: dateKey
        }
      },
      create: {
        user_id: userId,
        date_key: dateKey,
        total_seconds: totalSeconds,
        status,
        error: error ?? null,
        fetched_at: fetchedAt
      },
      update: {
        total_seconds: totalSeconds,
        status,
        error: error ?? null,
        fetched_at: fetchedAt
      }
    });
  };

  const getDailyStats = async ({
    userIds,
    dateKey
  }: {
    userIds: number[];
    dateKey: string;
  }): Promise<DailyStatRecord[]> => {
    if (userIds.length === 0) {
      return [];
    }

    const stats = await prisma.ww_daily_stat.findMany({
      where: {
        user_id: { in: userIds },
        date_key: dateKey
      },
      include: {
        user: {
          select: {
            id: true,
            wakawars_username: true
          }
        }
      }
    });

    return stats.map((stat) => ({
      userId: stat.user_id,
      username: stat.user.wakawars_username,
      totalSeconds: stat.total_seconds,
      status: stat.status as DailyStatStatus,
      error: stat.error ?? null,
      fetchedAt: stat.fetched_at
    }));
  };

  const upsertWeeklyStat = async ({
    userId,
    rangeKey,
    totalSeconds,
    dailyAverageSeconds,
    status,
    error,
    fetchedAt
  }: {
    userId: number;
    rangeKey: string;
    totalSeconds: number;
    dailyAverageSeconds: number;
    status: DailyStatStatus;
    error?: string | null;
    fetchedAt: Date;
  }) => {
    await prisma.ww_weekly_stat.upsert({
      where: {
        user_id_range_key: {
          user_id: userId,
          range_key: rangeKey
        }
      },
      create: {
        user_id: userId,
        range_key: rangeKey,
        total_seconds: totalSeconds,
        daily_average_seconds: dailyAverageSeconds,
        status,
        error: error ?? null,
        fetched_at: fetchedAt
      },
      update: {
        total_seconds: totalSeconds,
        daily_average_seconds: dailyAverageSeconds,
        status,
        error: error ?? null,
        fetched_at: fetchedAt
      }
    });
  };

  const getWeeklyStats = async ({
    userIds,
    rangeKey
  }: {
    userIds: number[];
    rangeKey: string;
  }): Promise<WeeklyStatRecord[]> => {
    if (userIds.length === 0) {
      return [];
    }

    const stats = await prisma.ww_weekly_stat.findMany({
      where: {
        user_id: { in: userIds },
        range_key: rangeKey
      },
      include: {
        user: {
          select: {
            id: true,
            wakawars_username: true
          }
        }
      }
    });

    return stats.map((stat) => ({
      userId: stat.user_id,
      username: stat.user.wakawars_username,
      totalSeconds: stat.total_seconds,
      dailyAverageSeconds: stat.daily_average_seconds,
      status: stat.status as DailyStatStatus,
      error: stat.error ?? null,
      fetchedAt: stat.fetched_at
    }));
  };

  const getWallet = async ({
    userId,
    limit = 20
  }: {
    userId: number;
    limit?: number;
  }) => {
    const user = await prisma.ww_user.findUnique({
      where: { id: userId },
      select: {
        coin_balance: true,
        equipped_skin_id: true,
        coin_ledger: {
          orderBy: { created_at: "desc" },
          take: limit,
          select: {
            id: true,
            amount: true,
            reason: true,
            metadata: true,
            created_at: true
          }
        }
      }
    });

    if (!user) {
      return null;
    }

    return {
      coinBalance: user.coin_balance,
      equippedSkinId: (user.equipped_skin_id as SkinId | null) ?? null,
      transactions: user.coin_ledger.map((entry) => ({
        id: entry.id,
        amount: entry.amount,
        reason: entry.reason as WalletTransactionReason,
        metadata: entry.metadata,
        createdAt: entry.created_at
      }))
    };
  };

  const listSkinCatalog = async (): Promise<SkinCatalogItem[]> => {
    const skins = await prisma.ww_skin_catalog.findMany({
      where: {
        is_active: true
      },
      orderBy: [
        { sort_order: "asc" },
        { created_at: "asc" }
      ],
      select: {
        id: true,
        name: true,
        description: true,
        price_coins: true
      }
    });

    return skins.map((skin) => ({
      id: skin.id,
      name: skin.name,
      description: skin.description,
      priceCoins: skin.price_coins
    }));
  };

  const getSkinCatalogItemById = async (
    skinId: string
  ): Promise<SkinCatalogItem | null> => {
    const normalizedSkinId = skinId.trim().toLowerCase();
    if (!normalizedSkinId) {
      return null;
    }

    const skin = await prisma.ww_skin_catalog.findFirst({
      where: {
        id: normalizedSkinId,
        is_active: true
      },
      select: {
        id: true,
        name: true,
        description: true,
        price_coins: true
      }
    });

    if (!skin) {
      return null;
    }

    return {
      id: skin.id,
      name: skin.name,
      description: skin.description,
      priceCoins: skin.price_coins
    };
  };

  const listOwnedSkinIds = async (userId: number): Promise<SkinId[]> => {
    const owned = await prisma.ww_user_skin.findMany({
      where: { user_id: userId },
      select: { skin_id: true }
    });

    return owned.map((entry) => entry.skin_id as SkinId);
  };

  const purchaseSkin = async ({
    userId,
    skinId,
    purchasedAt
  }: {
    userId: number;
    skinId: PurchasableSkinId;
    purchasedAt: Date;
  }): Promise<PurchaseSkinResult> => {
    const normalizedSkinId = skinId.trim().toLowerCase();
    if (!normalizedSkinId) {
      return "skin_not_found";
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const user = await tx.ww_user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            coin_balance: true
          }
        });
        if (!user) {
          return "user_not_found";
        }

        const selectedSkin = await tx.ww_skin_catalog.findFirst({
          where: {
            id: normalizedSkinId,
            is_active: true
          },
          select: {
            price_coins: true
          }
        });
        if (!selectedSkin) {
          return "skin_not_found";
        }

        const normalizedPrice = Math.max(0, Math.trunc(selectedSkin.price_coins));
        const existing = await tx.ww_user_skin.findUnique({
          where: {
            user_id_skin_id: {
              user_id: userId,
              skin_id: normalizedSkinId
            }
          },
          select: { id: true }
        });
        if (existing) {
          return "already_owned";
        }

        if (user.coin_balance < normalizedPrice) {
          return "insufficient_funds";
        }

        await tx.ww_user_skin.create({
          data: {
            user_id: userId,
            skin_id: normalizedSkinId,
            purchased_at: purchasedAt
          }
        });

        await tx.ww_user.update({
          where: { id: userId },
          data: {
            coin_balance: {
              decrement: normalizedPrice
            }
          }
        });

        await tx.ww_coin_ledger.create({
          data: {
            user_id: userId,
            amount: -normalizedPrice,
            reason: "skin_purchase",
            metadata: toPrismaJson({
              skinId: normalizedSkinId,
              priceCoins: normalizedPrice
            }),
            created_at: purchasedAt
          }
        });

        return "purchased";
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return "already_owned";
      }
      throw error;
    }
  };

  const setEquippedSkin = async (userId: number, skinId: SkinId | null) => {
    const user = await prisma.ww_user.update({
      where: { id: userId },
      data: {
        equipped_skin_id: skinId
      },
      include: userInclude
    });

    return mapUserToConfig(user as PrismaUser);
  };

  const settleDailyReward = async ({
    userId,
    dateKey,
    rank,
    coinsAwarded,
    settledAt
  }: {
    userId: number;
    dateKey: string;
    rank: number | null;
    coinsAwarded: number;
    settledAt: Date;
  }): Promise<{ applied: boolean; coinBalance: number | null }> => {
    const normalizedCoins = Math.max(0, Math.trunc(coinsAwarded));

    try {
      const coinBalance = await prisma.$transaction(async (tx) => {
        await tx.ww_daily_reward_settlement.create({
          data: {
            user_id: userId,
            date_key: dateKey,
            rank,
            coins_awarded: normalizedCoins,
            created_at: settledAt
          }
        });

        if (normalizedCoins <= 0) {
          const user = await tx.ww_user.findUnique({
            where: { id: userId },
            select: { coin_balance: true }
          });

          return user?.coin_balance ?? null;
        }

        const updated = await tx.ww_user.update({
          where: { id: userId },
          data: {
            coin_balance: {
              increment: normalizedCoins
            }
          },
          select: { coin_balance: true }
        });

        await tx.ww_coin_ledger.create({
          data: {
            user_id: userId,
            amount: normalizedCoins,
            reason: "daily_rank_reward",
            metadata: toPrismaJson({
              dateKey,
              rank
            }),
            created_at: settledAt
          }
        });

        return updated.coin_balance;
      });

      return {
        applied: true,
        coinBalance
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return {
          applied: false,
          coinBalance: null
        };
      }
      throw error;
    }
  };

  const grantAchievement = async ({
    userId,
    achievementId,
    contextKind,
    contextKey,
    awardedAt,
    metadata
  }: AchievementGrantRecord) => {
    await prisma.ww_user_achievement.upsert({
      where: {
        user_id_achievement_key_context_kind_context_key: {
          user_id: userId,
          achievement_key: achievementId,
          context_kind: contextKind,
          context_key: contextKey
        }
      },
      create: {
        user_id: userId,
        achievement_key: achievementId,
        context_kind: contextKind,
        context_key: contextKey,
        awarded_at: awardedAt,
        metadata: toPrismaJson(metadata)
      },
      update: {
        awarded_at: awardedAt,
        metadata: toPrismaJson(metadata)
      }
    });
  };

  const listAchievementUnlocks = async ({
    userId
  }: {
    userId: number;
  }): Promise<AchievementUnlockSummary[]> => {
    const rows = await prisma.ww_user_achievement.groupBy({
      by: ["achievement_key"],
      where: { user_id: userId },
      _count: {
        _all: true
      },
      _min: {
        awarded_at: true
      },
      _max: {
        awarded_at: true
      }
    });

    return rows
      .map((row) => ({
        achievementId: row.achievement_key,
        count: row._count._all,
        firstAwardedAt: row._min.awarded_at ?? new Date(0),
        lastAwardedAt: row._max.awarded_at ?? new Date(0)
      }))
      .sort(
        (a, b) => b.lastAwardedAt.getTime() - a.lastAwardedAt.getTime()
      );
  };

  const listAchievementGrants = async ({
    userIds,
    achievementIds,
    contextKind
  }: {
    userIds: number[];
    achievementIds?: string[];
    contextKind?: AchievementContextKind;
  }): Promise<AchievementGrantSummary[]> => {
    if (userIds.length === 0) {
      return [];
    }

    const rows = await prisma.ww_user_achievement.findMany({
      where: {
        user_id: { in: userIds },
        ...(achievementIds && achievementIds.length > 0
          ? { achievement_key: { in: achievementIds } }
          : {}),
        ...(contextKind ? { context_kind: contextKind } : {})
      },
      select: {
        user_id: true,
        achievement_key: true,
        context_kind: true,
        context_key: true,
        awarded_at: true
      }
    });

    return rows.map((row) => ({
      userId: row.user_id,
      achievementId: row.achievement_key,
      contextKind: row.context_kind as AchievementContextKind,
      contextKey: row.context_key,
      awardedAt: row.awarded_at
    }));
  };

  const createProviderLog = async ({
    provider,
    userId,
    endpoint,
    rangeKey,
    statusCode,
    ok,
    payload,
    error,
    fetchedAt
  }: ProviderLogRecord) => {
    await prisma.ww_provider_log.create({
      data: {
        provider,
        user_id: userId ?? null,
        endpoint,
        range_key: rangeKey ?? null,
        status_code: statusCode ?? null,
        ok,
        payload: toPrismaJson(payload),
        error: error ?? null,
        fetched_at: fetchedAt
      }
    });
  };

  const deleteProviderLogsOlderThan = async (cutoff: Date): Promise<number> => {
    const result = await prisma.ww_provider_log.deleteMany({
      where: {
        fetched_at: { lt: cutoff }
      }
    });
    return result.count;
  };

  const getAiHonorTitles = async (
    userIds: number[]
  ): Promise<Map<number, string | null>> => {
    if (userIds.length === 0) {
      return new Map();
    }

    const rows = await prisma.ww_user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, ai_honor_title: true }
    });

    return new Map(rows.map((row) => [row.id, row.ai_honor_title ?? null]));
  };

  const getAiHonorTitleState = async (userId: number) => {
    const row = await prisma.ww_user.findUnique({
      where: { id: userId },
      select: {
        ai_honor_title: true,
        ai_honor_title_signature: true,
        ai_honor_title_generated_at: true
      }
    });
    if (!row) {
      return null;
    }
    return {
      title: row.ai_honor_title ?? null,
      signature: row.ai_honor_title_signature ?? null,
      generatedAt: row.ai_honor_title_generated_at ?? null
    };
  };

  const setAiHonorTitle = async ({
    userId,
    title,
    signature,
    generatedAt
  }: {
    userId: number;
    title: string;
    signature: string;
    generatedAt: Date;
  }) => {
    await prisma.ww_user.update({
      where: { id: userId },
      data: {
        ai_honor_title: title,
        ai_honor_title_signature: signature,
        ai_honor_title_generated_at: generatedAt
      }
    });
  };

  return {
    countUsers,
    listUsers,
    getUsersByIds,
    getUserById,
    getUserByUsername,
    createUser,
    updateUser,
    setWakaTimeTimezone,
    setPassword,
    setStatsVisibility,
    setCompetitionStatus,
    addFriendship,
    removeFriendship,
    createGroup,
    deleteGroup,
    addGroupMember,
    removeGroupMember,
    getIncomingFriendIds,
    getGroupPeerIds,
    getGroupOwnerIdsForMember,
    searchUsers,
    upsertDailyStat,
    getDailyStats,
    upsertWeeklyStat,
    getWeeklyStats,
    getWallet,
    listSkinCatalog,
    getSkinCatalogItemById,
    listOwnedSkinIds,
    purchaseSkin,
    setEquippedSkin,
    settleDailyReward,
    grantAchievement,
    listAchievementUnlocks,
    listAchievementGrants,
    createProviderLog,
    deleteProviderLogsOlderThan,
    getAiHonorTitles,
    getAiHonorTitleState,
    setAiHonorTitle
  };
};
