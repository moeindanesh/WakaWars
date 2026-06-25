export type Friend = {
  id: number;
  username: string; // WakaWars username (assumed to match WakaTime username)
  apiKey?: string | null;
};

export type FriendPublic = {
  username: string;
};

export type StatsVisibility = "everyone" | "friends" | "no_one";
export type CompetitionStatus = "active" | "left";
export type SkinId = string;
export type PurchasableSkinId = string;

export type GroupMember = {
  id: number;
  username: string;
};

export type Group = {
  id: number;
  name: string;
  members: GroupMember[];
};

export type UserConfig = {
  id: number;
  wakawarsUsername: string;
  apiKey: string;
  wakatimeTimezone?: string | null;
  friends: Friend[];
  groups: Group[];
  statsVisibility: StatsVisibility;
  isCompeting: boolean;
  coinBalance: number;
  equippedSkinId: SkinId | null;
  passwordHash?: string | null;
};

export type PublicConfig = {
  wakawarsUsername: string;
  friends: FriendPublic[];
  groups: Group[];
  statsVisibility: StatsVisibility;
  isCompeting: boolean;
  hasApiKey: boolean;
  passwordSet: boolean;
};

export type DailyStatStatus =
  | "ok"
  | "pending"
  | "private"
  | "not_found"
  | "error";

export type DailyStat = {
  username: string; // WakaWars username
  honorTitle?: string | null;
  totalSeconds: number;
  status: DailyStatStatus;
  coinBalance?: number;
  equippedSkinId?: SkinId | null;
  error?: string | null;
};

export type LeaderboardEntry = DailyStat & {
  rank: number | null;
  deltaSeconds: number;
};

export type LeaderboardResponse = {
  date: string;
  updatedAt: string;
  entries: LeaderboardEntry[];
  selfEntry?: LeaderboardEntry | null;
};

export type DailyHistoryDay = {
  date: string;
  offsetDays: number;
  updatedAt: string;
  podium: LeaderboardEntry[];
};

export type DailyHistoryResponse = {
  updatedAt: string;
  days: DailyHistoryDay[];
};

export type WeeklyStat = {
  username: string; // WakaWars username
  honorTitle?: string | null;
  totalSeconds: number;
  dailyAverageSeconds: number;
  status: DailyStatStatus;
  coinBalance?: number;
  equippedSkinId?: SkinId | null;
  error?: string | null;
};

export type WeeklyLeaderboardEntry = WeeklyStat & {
  rank: number | null;
  deltaSeconds: number;
};

export type WeeklyLeaderboardResponse = {
  range: string;
  updatedAt: string;
  entries: WeeklyLeaderboardEntry[];
  selfEntry?: WeeklyLeaderboardEntry | null;
};

export type SkinCatalogItem = {
  id: PurchasableSkinId;
  name: string;
  description: string;
  priceCoins: number;
};

export type ShopSkin = SkinCatalogItem & {
  owned: boolean;
  equipped: boolean;
};

export type ShopCatalogResponse = {
  coins: number;
  equippedSkinId: SkinId | null;
  skins: ShopSkin[];
};

export type WalletTransactionReason = "daily_rank_reward" | "skin_purchase";

export type WalletTransaction = {
  id: number;
  amount: number;
  reason: WalletTransactionReason;
  createdAt: string;
  metadata?: unknown | null;
};

export type WalletResponse = {
  coins: number;
  equippedSkinId: SkinId | null;
  transactions: WalletTransaction[];
};
