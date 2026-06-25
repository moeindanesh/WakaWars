import type { DailyStatStatus } from "@molty/shared";
import type {
  AchievementContextKind,
  AchievementUnlockSummary,
  UserRepository
} from "./repository.js";

export type AchievementDefinition = {
  id: string;
  title: string;
  description: string;
  icon: string;
};

export type AchievementDisplay = AchievementDefinition & {
  count: number;
  firstAwardedAt: string;
  lastAwardedAt: string;
};

export type AchievementBoardItem = AchievementDefinition & {
  count: number;
  unlocked: boolean;
  firstAwardedAt: string | null;
  lastAwardedAt: string | null;
};

const DAILY_4_HOURS = 4 * 60 * 60;
const DAILY_6_HOURS = 6 * 60 * 60;
const DAILY_8_HOURS = 8 * 60 * 60;
const DAILY_10_HOURS = 10 * 60 * 60;
const DAILY_12_HOURS = 12 * 60 * 60;
const DAILY_14_HOURS = 14 * 60 * 60;
const DAILY_16_HOURS = 16 * 60 * 60;
const DAILY_20_HOURS = 20 * 60 * 60;
const WEEKLY_40_HOURS = 40 * 60 * 60;
const WEEKLY_60_HOURS = 60 * 60 * 60;
const WEEKLY_80_HOURS = 80 * 60 * 60;
const WEEKLY_100_HOURS = 100 * 60 * 60;
const WEEKLY_120_HOURS = 120 * 60 * 60;
const DAILY_AVERAGE_8_HOURS = 8 * 60 * 60;
const DAILY_AVERAGE_10_HOURS = 10 * 60 * 60;

export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  {
    id: "quick-boot-4h",
    title: "Fast Start",
    description: "Log 4 focused hours in a day.",
    icon: "4H"
  },
  {
    id: "focus-reactor-6h",
    title: "Deep Momentum",
    description: "Cross 6 hours in a day.",
    icon: "6H"
  },
  {
    id: "streak-forge-8h",
    title: "Streak Ignited",
    description: "Drop 8 focused hours in a single day.",
    icon: "8H"
  },
  {
    id: "overclocked-core-10h",
    title: "Overdrive Mode",
    description: "Pass 10 coding hours in one day.",
    icon: "10H"
  },
  {
    id: "merge-mountain-12h",
    title: "Peak Sprint",
    description: "Ship 12 hours in a single day.",
    icon: "12H"
  },
  {
    id: "night-shift-14h",
    title: "Night Marathon",
    description: "Reach 14 hours in a single day.",
    icon: "14H"
  },
  {
    id: "legendary-commit-16h",
    title: "Legendary Run",
    description: "Survive a 16-hour coding day.",
    icon: "16H"
  },
  {
    id: "boss-raid-20h",
    title: "Boss Marathon",
    description: "Survive a 20-hour marathon day.",
    icon: "20H"
  },
  {
    id: "weekend-warrior-8h",
    title: "Weekend Creator",
    description: "Hit 8 hours on Friday, Saturday, or Sunday.",
    icon: "WKND"
  },
  {
    id: "weekend-overdrive-12h",
    title: "Weekend Overdrive",
    description: "Hit 12 hours on Friday, Saturday, or Sunday.",
    icon: "WK12"
  },
  {
    id: "solo-day-8h",
    title: "Solo Session",
    description: "Hit 8 daily hours using one editor.",
    icon: "1APP"
  },
  {
    id: "mono-language-day-8h",
    title: "Single Track",
    description: "Hit 8 daily hours using one language.",
    icon: "1LNG"
  },
  {
    id: "deep-focus-day-8h",
    title: "Deep Focus",
    description: "Hit 8 daily hours while staying in one project.",
    icon: "1PRJ"
  },
  {
    id: "workweek-warrior-40h",
    title: "Week 40 Warrior",
    description: "Hit 40 hours in one week.",
    icon: "40W"
  },
  {
    id: "ship-it-60h",
    title: "Power Week 60",
    description: "Hit 60 hours in one week.",
    icon: "60W"
  },
  {
    id: "green-wall-80h",
    title: "Wall Breaker 80",
    description: "Break the 80-hour weekly barrier.",
    icon: "80W"
  },
  {
    id: "graph-overflow-100h",
    title: "Overflow 100",
    description: "Break 100 hours in one week.",
    icon: "100W"
  },
  {
    id: "matrix-120h",
    title: "Summit 120",
    description: "Reach 120 weekly hours.",
    icon: "120W"
  },
  {
    id: "project-monolith-80h",
    title: "Flagship Focus",
    description: "Hit 80 weekly hours with one project dominating your time.",
    icon: "MONO"
  },
  {
    id: "seven-sunrise-week",
    title: "Seven Sunrise",
    description: "Code every day in one week.",
    icon: "7D"
  },
  {
    id: "marathon-pace-8h",
    title: "Sustained Craft Pace",
    description: "Keep 8h/day average over a week.",
    icon: "AVG8"
  },
  {
    id: "ultra-pace-10h",
    title: "Ultra Craft Pace",
    description: "Keep 10h/day average over a week.",
    icon: "AVG10"
  }
];

const achievementById = new Map(
  ACHIEVEMENT_DEFINITIONS.map((achievement) => [achievement.id, achievement])
);

const DAILY_TIME_ACHIEVEMENTS: Array<{ id: string; thresholdSeconds: number }> = [
  { id: "quick-boot-4h", thresholdSeconds: DAILY_4_HOURS },
  { id: "focus-reactor-6h", thresholdSeconds: DAILY_6_HOURS },
  { id: "streak-forge-8h", thresholdSeconds: DAILY_8_HOURS },
  { id: "overclocked-core-10h", thresholdSeconds: DAILY_10_HOURS },
  { id: "merge-mountain-12h", thresholdSeconds: DAILY_12_HOURS },
  { id: "night-shift-14h", thresholdSeconds: DAILY_14_HOURS },
  { id: "legendary-commit-16h", thresholdSeconds: DAILY_16_HOURS },
  { id: "boss-raid-20h", thresholdSeconds: DAILY_20_HOURS }
];

const WEEKLY_TIME_ACHIEVEMENTS: Array<{ id: string; thresholdSeconds: number }> = [
  { id: "workweek-warrior-40h", thresholdSeconds: WEEKLY_40_HOURS },
  { id: "ship-it-60h", thresholdSeconds: WEEKLY_60_HOURS },
  { id: "green-wall-80h", thresholdSeconds: WEEKLY_80_HOURS },
  { id: "graph-overflow-100h", thresholdSeconds: WEEKLY_100_HOURS },
  { id: "matrix-120h", thresholdSeconds: WEEKLY_120_HOURS }
];

const WEEKLY_AVERAGE_ACHIEVEMENTS: Array<{
  id: string;
  thresholdSeconds: number;
}> = [
  { id: "marathon-pace-8h", thresholdSeconds: DAILY_AVERAGE_8_HOURS },
  { id: "ultra-pace-10h", thresholdSeconds: DAILY_AVERAGE_10_HOURS }
];

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as Record<string, unknown>;
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

const parseDateInput = (value: unknown): Date | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? new Date(`${normalized}T00:00:00.000Z`)
    : new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
};

const toIsoWeekKey = (date: Date): string => {
  const normalized = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const day = normalized.getUTCDay() || 7;
  normalized.setUTCDate(normalized.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(normalized.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((normalized.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );

  return `${normalized.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

const resolveWeekContextKey = ({
  rangeKey,
  payload,
  fallbackDate
}: {
  rangeKey: string;
  payload?: unknown;
  fallbackDate: Date;
}) => {
  const data = asObject(asObject(payload)?.data);
  const range = asObject(data?.range);

  const endDate =
    parseDateInput(range?.end) ??
    parseDateInput(range?.end_date) ??
    parseDateInput(range?.endDate) ??
    parseDateInput(data?.end) ??
    parseDateInput(data?.end_date) ??
    parseDateInput(data?.endDate) ??
    fallbackDate;

  return `${rangeKey}:${toIsoWeekKey(endDate)}`;
};

const extractActiveNamedEntries = (
  payload: unknown,
  key: string
): string[] => {
  const values = extractActiveNamedEntryValues(payload, key);
  return values.map((entry) => entry.name);
};

const extractActiveNamedEntryValues = (
  payload: unknown,
  key: string
): Array<{ name: string; seconds: number }> => {
  const data = asObject(asObject(payload)?.data);
  const entries = Array.isArray(data?.[key]) ? data?.[key] : [];

  const values = entries
    .map((entry) => asObject(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => {
      const seconds =
        asNumber(entry.total_seconds) ??
        asNumber(entry.seconds) ??
        asNumber(entry.total) ??
        0;
      const name =
        typeof entry.name === "string" && entry.name.trim()
          ? entry.name.trim()
          : "unknown";
      return { name, seconds };
    })
    .filter((entry) => entry.seconds > 0);

  const deduped = new Map<string, number>();
  values.forEach((entry) => {
    deduped.set(entry.name, (deduped.get(entry.name) ?? 0) + entry.seconds);
  });

  return Array.from(deduped.entries()).map(([name, seconds]) => ({
    name,
    seconds
  }));
};

/**
 * The most-used distinct names for a breakdown (languages, editors, projects),
 * highest total time first. Used to flavor AI honor titles with the tools a user
 * actually leaned on, rather than just their raw hours.
 */
export const extractTopEntryNames = (
  payload: unknown,
  key: string,
  limit: number
): string[] =>
  extractActiveNamedEntryValues(payload, key)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.name);

const extractActiveEditors = (payload?: unknown): string[] => {
  if (!payload) {
    return [];
  }
  return extractActiveNamedEntries(payload, "editors");
};

const extractActiveLanguages = (payload?: unknown): string[] => {
  if (!payload) {
    return [];
  }
  return extractActiveNamedEntries(payload, "languages");
};

const extractActiveProjects = (payload?: unknown): string[] => {
  if (!payload) {
    return [];
  }
  return extractActiveNamedEntries(payload, "projects");
};

const extractProjectValues = (
  payload?: unknown
): Array<{ name: string; seconds: number }> => {
  if (!payload) {
    return [];
  }
  return extractActiveNamedEntryValues(payload, "projects");
};

const extractWeeklyDaySeconds = (payload?: unknown): number[] => {
  if (!payload) {
    return [];
  }

  const data = asObject(asObject(payload)?.data);
  const days = Array.isArray(data?.days) ? data?.days : [];

  return days
    .map((entry) => asObject(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => {
      const grandTotal = asObject(entry.grand_total);
      return (
        asNumber(entry.total_seconds) ??
        asNumber(entry.total) ??
        asNumber(grandTotal?.total_seconds) ??
        0
      );
    })
    .filter((seconds) => Number.isFinite(seconds) && seconds >= 0);
};

const isWeekendDateKey = (dateKey: string): boolean => {
  const [year, month, day] = dateKey.split("-").map((value) => Number(value));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  return weekday === 5 || weekday === 6 || weekday === 0;
};

const grant = async ({
  store,
  userId,
  achievementId,
  contextKind,
  contextKey,
  awardedAt,
  metadata
}: {
  store: UserRepository;
  userId: number;
  achievementId: string;
  contextKind: AchievementContextKind;
  contextKey: string;
  awardedAt: Date;
  metadata?: unknown;
}) => {
  await store.grantAchievement({
    userId,
    achievementId,
    contextKind,
    contextKey,
    awardedAt,
    metadata: metadata ?? null
  });
};

export const awardDailyAchievements = async ({
  store,
  userId,
  dateKey,
  status,
  totalSeconds,
  payload,
  fetchedAt
}: {
  store: UserRepository;
  userId: number;
  dateKey: string;
  status: DailyStatStatus;
  totalSeconds: number;
  payload?: unknown;
  fetchedAt: Date;
}) => {
  if (status !== "ok") {
    return;
  }

  const awards: Array<{
    id: string;
    thresholdSeconds: number;
    metadata?: Record<string, unknown>;
  }> = DAILY_TIME_ACHIEVEMENTS.filter(
    (achievement) => totalSeconds >= achievement.thresholdSeconds
  );
  const activeEditors = extractActiveEditors(payload);
  const activeLanguages = extractActiveLanguages(payload);
  const activeProjects = extractActiveProjects(payload);
  const soloEditor = activeEditors.length === 1 ? activeEditors[0] : null;
  const isWeekend = isWeekendDateKey(dateKey);

  if (isWeekend && totalSeconds >= DAILY_8_HOURS) {
    awards.push({
      id: "weekend-warrior-8h",
      thresholdSeconds: DAILY_8_HOURS
    });
  }

  if (isWeekend && totalSeconds >= DAILY_12_HOURS) {
    awards.push({
      id: "weekend-overdrive-12h",
      thresholdSeconds: DAILY_12_HOURS
    });
  }

  if (totalSeconds >= DAILY_8_HOURS && soloEditor) {
    awards.push({
      id: "solo-day-8h",
      thresholdSeconds: DAILY_8_HOURS,
      metadata: { editor: soloEditor }
    });
  }

  if (totalSeconds >= DAILY_8_HOURS && activeLanguages.length === 1) {
    awards.push({
      id: "mono-language-day-8h",
      thresholdSeconds: DAILY_8_HOURS,
      metadata: { language: activeLanguages[0] }
    });
  }

  if (totalSeconds >= DAILY_8_HOURS && activeProjects.length === 1) {
    awards.push({
      id: "deep-focus-day-8h",
      thresholdSeconds: DAILY_8_HOURS,
      metadata: { project: activeProjects[0] }
    });
  }

  await Promise.all(
    awards.map((achievement) =>
      grant({
        store,
        userId,
        achievementId: achievement.id,
        contextKind: "daily",
        contextKey: dateKey,
        awardedAt: fetchedAt,
        metadata: {
          totalSeconds,
          thresholdSeconds: achievement.thresholdSeconds,
          dateKey,
          ...achievement.metadata
        }
      })
    )
  );
};

export const awardWeeklyAchievements = async ({
  store,
  userId,
  rangeKey,
  status,
  totalSeconds,
  dailyAverageSeconds,
  payload,
  fetchedAt
}: {
  store: UserRepository;
  userId: number;
  rangeKey: string;
  status: DailyStatStatus;
  totalSeconds: number;
  dailyAverageSeconds: number;
  payload?: unknown;
  fetchedAt: Date;
}) => {
  if (status !== "ok") {
    return;
  }

  const contextKey = resolveWeekContextKey({
    rangeKey,
    payload,
    fallbackDate: fetchedAt
  });

  const weeklyAwards: Array<{
    id: string;
    thresholdSeconds: number;
    metadata?: Record<string, unknown>;
  }> = WEEKLY_TIME_ACHIEVEMENTS.filter(
    (achievement) => totalSeconds >= achievement.thresholdSeconds
  );
  const weeklyAverageAwards = WEEKLY_AVERAGE_ACHIEVEMENTS.filter(
    (achievement) => dailyAverageSeconds >= achievement.thresholdSeconds
  );

  const activeEditors = extractActiveEditors(payload);
  const activeLanguages = extractActiveLanguages(payload);
  const activeProjects = extractActiveProjects(payload);
  const projectValues = extractProjectValues(payload).sort(
    (a, b) => b.seconds - a.seconds
  );
  const weeklyDays = extractWeeklyDaySeconds(payload);
  const activeDayCount = weeklyDays.filter((seconds) => seconds > 0).length;
  const topProjectShare =
    projectValues.length > 0 && totalSeconds > 0
      ? projectValues[0]!.seconds / totalSeconds
      : 0;

  await Promise.all([
    ...weeklyAwards.map((achievement) =>
      grant({
        store,
        userId,
        achievementId: achievement.id,
        contextKind: "weekly",
        contextKey,
        awardedAt: fetchedAt,
        metadata: {
          totalSeconds,
          thresholdSeconds: achievement.thresholdSeconds,
          rangeKey,
          weekContextKey: contextKey,
          ...achievement.metadata
        }
      })
    ),
    ...weeklyAverageAwards.map((achievement) =>
      grant({
        store,
        userId,
        achievementId: achievement.id,
        contextKind: "weekly",
        contextKey,
        awardedAt: fetchedAt,
        metadata: {
          totalSeconds,
          dailyAverageSeconds,
          thresholdSeconds: achievement.thresholdSeconds,
          rangeKey,
          weekContextKey: contextKey
        }
      })
    ),
    ...(totalSeconds >= WEEKLY_80_HOURS && topProjectShare >= 0.75
      ? [
          grant({
            store,
            userId,
            achievementId: "project-monolith-80h",
            contextKind: "weekly",
            contextKey,
            awardedAt: fetchedAt,
            metadata: {
              totalSeconds,
              thresholdSeconds: WEEKLY_80_HOURS,
              dailyAverageSeconds,
              rangeKey,
              weekContextKey: contextKey,
              dominantProject: projectValues[0]?.name ?? "unknown",
              projectShare: topProjectShare
            }
          })
        ]
      : []),
    ...(activeDayCount >= 7
      ? [
          grant({
            store,
            userId,
            achievementId: "seven-sunrise-week",
            contextKind: "weekly",
            contextKey,
            awardedAt: fetchedAt,
            metadata: {
              activeDayCount,
              dailyAverageSeconds,
              rangeKey,
              weekContextKey: contextKey
            }
          })
        ]
      : [])
  ]);
};

export const toAchievementDisplay = (
  unlocks: AchievementUnlockSummary[]
): AchievementDisplay[] => {
  return unlocks
    .map((unlock) => {
      const definition = achievementById.get(unlock.achievementId);
      if (!definition) {
        return null;
      }

      return {
        ...definition,
        count: unlock.count,
        firstAwardedAt: unlock.firstAwardedAt.toISOString(),
        lastAwardedAt: unlock.lastAwardedAt.toISOString()
      };
    })
    .filter((entry): entry is AchievementDisplay => Boolean(entry));
};

export const toAchievementBoard = (
  unlocks: AchievementUnlockSummary[]
): AchievementBoardItem[] => {
  const unlockById = new Map(
    unlocks.map((unlock) => [unlock.achievementId, unlock])
  );

  return ACHIEVEMENT_DEFINITIONS.map((definition) => {
    const unlock = unlockById.get(definition.id);
    if (!unlock) {
      return {
        ...definition,
        count: 0,
        unlocked: false,
        firstAwardedAt: null,
        lastAwardedAt: null
      };
    }

    return {
      ...definition,
      count: unlock.count,
      unlocked: true,
      firstAwardedAt: unlock.firstAwardedAt.toISOString(),
      lastAwardedAt: unlock.lastAwardedAt.toISOString()
    };
  });
};
