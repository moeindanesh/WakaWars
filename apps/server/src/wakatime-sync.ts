import type { UserRepository } from "./repository.js";
import type { WakaTimeClient, WakaTimeResult } from "./wakatime.js";
import { toDateKeyInTimeZone } from "./date-key.js";
import { awardDailyAchievements } from "./achievements.js";
import type { HonorTitleGenerator } from "./honor-title-ai.js";
import {
  DEFAULT_WAKATIME_BATCH_DELAY_MS,
  DEFAULT_WAKATIME_BATCH_SIZE,
  runInBatches
} from "./wakatime-rate-limit.js";
export { DEFAULT_WAKATIME_WEEKLY_RANGE } from "./wakatime-weekly-cache.js";

export const DEFAULT_WAKATIME_SYNC_INTERVAL_MS = 2 * 60 * 1000;
export const IRAN_DAILY_SYNC_TIME_ZONE = "Asia/Tehran";
export const IRAN_DAILY_SYNC_HOUR = 23;
export const IRAN_DAILY_SYNC_MINUTE = 59;

const MINUTE_MS = 60 * 1000;
const MAX_SCHEDULE_LOOKAHEAD_MINUTES = 48 * 60;

export type WakaTimeSyncOptions = {
  store: UserRepository;
  wakatime: WakaTimeClient;
  intervalMs?: number;
  honorTitle?: HonorTitleGenerator | null;
  onError?: (error: unknown) => void;
};

/**
 * Provider logs are kept for debugging only, so we persist a row solely when a
 * fetch fails (network error, non-2xx, or a surfaced error message). Successful
 * and cached responses are not logged — this is the dominant volume reduction.
 */
const isProviderFailure = (result: WakaTimeResult): boolean =>
  Boolean(result.networkError) ||
  result.responseOk === false ||
  Boolean(result.error);

export type WakaTimeSync = {
  start: () => void;
  stop: () => void;
  runOnce: () => Promise<void>;
  syncUser: (input: {
    id: number;
    apiKey: string;
    wakatimeTimezone?: string | null;
    bypassCache?: boolean;
  }) => Promise<void>;
};

const createTimePartsFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });

const getTimePartsInTimeZone = (date: Date, formatter: Intl.DateTimeFormat) => {
  const parts = formatter.formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (!hour || !minute) {
    return null;
  }

  return {
    hour: Number(hour),
    minute: Number(minute)
  };
};

export const resolveNextDailyRunAt = ({
  now = new Date(),
  timeZone,
  hour,
  minute
}: {
  now?: Date;
  timeZone: string;
  hour: number;
  minute: number;
}): Date => {
  const currentMinuteStartMs = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;
  let formatter: Intl.DateTimeFormat;

  try {
    formatter = createTimePartsFormatter(timeZone);
  } catch {
    return new Date(currentMinuteStartMs + 24 * 60 * MINUTE_MS);
  }

  for (
    let offsetMinutes = 1;
    offsetMinutes <= MAX_SCHEDULE_LOOKAHEAD_MINUTES;
    offsetMinutes += 1
  ) {
    const candidate = new Date(currentMinuteStartMs + offsetMinutes * MINUTE_MS);
    const candidateParts = getTimePartsInTimeZone(candidate, formatter);
    if (!candidateParts) {
      continue;
    }
    if (candidateParts.hour === hour && candidateParts.minute === minute) {
      return candidate;
    }
  }

  return new Date(currentMinuteStartMs + 24 * 60 * MINUTE_MS);
};

export const createWakaTimeSync = ({
  store,
  wakatime,
  intervalMs = DEFAULT_WAKATIME_SYNC_INTERVAL_MS,
  honorTitle,
  onError
}: WakaTimeSyncOptions): WakaTimeSync => {
  let timer: NodeJS.Timeout | null = null;
  let dailyTimer: NodeJS.Timeout | null = null;
  let running = false;
  let stopped = false;

  const reportError = (error: unknown) => {
    if (onError) {
      onError(error);
      return;
    }

    // eslint-disable-next-line no-console
    console.error("[wakawars] WakaTime sync failed", error);
  };

  const resolveDateKey = (input: {
    dateKey?: string;
    timeZone?: string | null;
  }) => {
    if (input.dateKey) {
      return input.dateKey;
    }

    return toDateKeyInTimeZone(new Date(), input.timeZone ?? null);
  };

  const runOnceInternal = async ({
    bypassCache = false
  }: { bypassCache?: boolean } = {}) => {
    if (running) return;
    running = true;

    try {
      const users = await store.listUsers();
      const targets = users
        .map((user) => ({
          ...user,
          apiKey: user.apiKey.trim()
        }))
        .filter((user) => Boolean(user.apiKey));

      await runInBatches(
        targets,
        async (user) => {
          const dailyResult = await wakatime.getStatusBarToday("current", user.apiKey, {
            bypassCache
          });
          const resolvedTimezone =
            dailyResult.timezone ?? user.wakatimeTimezone ?? null;
          const dateKey = resolveDateKey({
            dateKey: dailyResult.dateKey,
            timeZone: resolvedTimezone
          });

          const logTasks: Promise<unknown>[] = [];
          if (dailyResult.timezone && dailyResult.timezone !== user.wakatimeTimezone) {
            logTasks.push(store.setWakaTimeTimezone(user.id, dailyResult.timezone));
          }
          if (isProviderFailure(dailyResult)) {
            logTasks.push(
              store.createProviderLog({
                provider: "wakatime",
                userId: user.id,
                endpoint: "status_bar/today",
                rangeKey: null,
                statusCode: dailyResult.responseStatus ?? null,
                ok: dailyResult.responseOk ?? false,
                payload: dailyResult.payload ?? null,
                error: dailyResult.error ?? dailyResult.networkError ?? null,
                fetchedAt: new Date(dailyResult.fetchedAt)
              })
            );
          }

          if (!dailyResult.fromCache) {
            await store.upsertDailyStat({
              userId: user.id,
              dateKey,
              totalSeconds: dailyResult.totalSeconds,
              status: dailyResult.status,
              error: dailyResult.error ?? null,
              fetchedAt: new Date(dailyResult.fetchedAt)
            });
          }

          await awardDailyAchievements({
            store,
            userId: user.id,
            dateKey,
            status: dailyResult.status,
            totalSeconds: dailyResult.totalSeconds,
            payload: dailyResult.payload,
            fetchedAt: new Date(dailyResult.fetchedAt)
          });

          await honorTitle?.maybeGenerate({
            userId: user.id,
            todaySeconds: dailyResult.totalSeconds,
            todayPayload: dailyResult.payload
          });

          if (logTasks.length) {
            await Promise.allSettled(logTasks);
          }
        },
        {
          batchSize: DEFAULT_WAKATIME_BATCH_SIZE,
          delayMs: DEFAULT_WAKATIME_BATCH_DELAY_MS,
          onError: reportError
        }
      );
    } catch (error) {
      reportError(error);
    } finally {
      running = false;
    }
  };

  const runOnce = async () => {
    await runOnceInternal();
  };

  const syncUser = async ({
    id,
    apiKey,
    wakatimeTimezone,
    bypassCache = false
  }: {
    id: number;
    apiKey: string;
    wakatimeTimezone?: string | null;
    bypassCache?: boolean;
  }) => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      return;
    }

    try {
      const dailyResult = await wakatime.getStatusBarToday("current", trimmedKey, {
        bypassCache
      });
      const resolvedTimezone = dailyResult.timezone ?? wakatimeTimezone ?? null;
      const dateKey = resolveDateKey({
        dateKey: dailyResult.dateKey,
        timeZone: resolvedTimezone
      });

      const logTasks: Promise<unknown>[] = [];
      if (dailyResult.timezone && dailyResult.timezone !== wakatimeTimezone) {
        logTasks.push(store.setWakaTimeTimezone(id, dailyResult.timezone));
      }
      if (isProviderFailure(dailyResult)) {
        logTasks.push(
          store.createProviderLog({
            provider: "wakatime",
            userId: id,
            endpoint: "status_bar/today",
            rangeKey: null,
            statusCode: dailyResult.responseStatus ?? null,
            ok: dailyResult.responseOk ?? false,
            payload: dailyResult.payload ?? null,
            error: dailyResult.error ?? dailyResult.networkError ?? null,
            fetchedAt: new Date(dailyResult.fetchedAt)
          })
        );
      }

      if (!dailyResult.fromCache) {
        await store.upsertDailyStat({
          userId: id,
          dateKey,
          totalSeconds: dailyResult.totalSeconds,
          status: dailyResult.status,
          error: dailyResult.error ?? null,
          fetchedAt: new Date(dailyResult.fetchedAt)
        });
      }

      await awardDailyAchievements({
        store,
        userId: id,
        dateKey,
        status: dailyResult.status,
        totalSeconds: dailyResult.totalSeconds,
        payload: dailyResult.payload,
        fetchedAt: new Date(dailyResult.fetchedAt)
      });

      await honorTitle?.maybeGenerate({
        userId: id,
        todaySeconds: dailyResult.totalSeconds,
        todayPayload: dailyResult.payload
      });

      if (logTasks.length) {
        await Promise.allSettled(logTasks);
      }
    } catch (error) {
      reportError(error);
    }
  };

  const scheduleDailyIranSync = () => {
    if (dailyTimer || stopped) {
      return;
    }

    const nextRunAt = resolveNextDailyRunAt({
      timeZone: IRAN_DAILY_SYNC_TIME_ZONE,
      hour: IRAN_DAILY_SYNC_HOUR,
      minute: IRAN_DAILY_SYNC_MINUTE
    });
    const delayMs = Math.max(nextRunAt.getTime() - Date.now(), 1000);

    dailyTimer = setTimeout(() => {
      dailyTimer = null;
      void runOnceInternal({ bypassCache: true }).finally(() => {
        scheduleDailyIranSync();
      });
    }, delayMs);
  };

  const start = () => {
    if (timer) return;
    stopped = false;
    void runOnce();
    timer = setInterval(() => {
      void runOnce();
    }, intervalMs);
    scheduleDailyIranSync();
  };

  const stop = () => {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (dailyTimer) {
      clearTimeout(dailyTimer);
      dailyTimer = null;
    }
  };

  return { start, stop, runOnce, syncUser };
};
