import type { DailyStatStatus } from "@molty/shared";
import { toDateKeyInTimeZone, toUtcDateKey } from "./date-key.js";

export type WakaTimeResult = {
  status: DailyStatStatus;
  totalSeconds: number;
  dateKey?: string;
  timezone?: string | null;
  error?: string | null;
  fetchedAt: number;
  responseStatus?: number;
  responseOk?: boolean;
  payload?: unknown;
  fromCache?: boolean;
  networkError?: string | null;
};

export type WakaTimeStatsResult = {
  status: DailyStatStatus;
  totalSeconds: number;
  dailyAverageSeconds: number;
  error?: string | null;
  fetchedAt: number;
  responseStatus?: number;
  responseOk?: boolean;
  payload?: unknown;
  fromCache?: boolean;
  networkError?: string | null;
};

export type WakaTimeClient = {
  getStatusBarToday: (
    username: string,
    apiKey: string,
    options?: { bypassCache?: boolean }
  ) => Promise<WakaTimeResult>;
  getStatsRange: (
    rangeKey: string,
    apiKey: string,
    options?: { bypassCache?: boolean }
  ) => Promise<WakaTimeStatsResult>;
};

type CacheEntry<T> = {
  dateKey: string;
  fetchedAt: number;
  result: T;
};

// Kept strictly below the 2-minute sync interval so a cached entry is reliably
// expired by the next sync cycle; otherwise a cycle could read from cache and
// skip persisting fresh stats.
const DEFAULT_TTL_MS = 90 * 1000;

export const createWakaTimeClient = ({
  fetcher = globalThis.fetch,
  ttlMs = DEFAULT_TTL_MS
}: {
  fetcher?: typeof fetch;
  ttlMs?: number;
} = {}): WakaTimeClient => {
  const statusCache = new Map<string, CacheEntry<WakaTimeResult>>();
  const statsCache = new Map<string, CacheEntry<WakaTimeStatsResult>>();

  const extractErrorMessageFromPayload = (payload: unknown): string | null => {
    if (!payload) return null;
    if (typeof payload === "string") {
      return payload.trim() || null;
    }

    if (typeof payload === "object") {
      const typed = payload as {
        error?: string;
        errors?: string[] | string;
        message?: string;
      };
      const errorValue = typed.error ?? typed.message ?? typed.errors;
      if (typeof errorValue === "string" && errorValue.trim()) {
        return errorValue.trim();
      }
      if (Array.isArray(errorValue) && errorValue.length) {
        return errorValue.filter(Boolean).join(", ").trim();
      }
    }

    return null;
  };

  const readPayload = async (
    response: Response
  ): Promise<{ payload: unknown; isJson: boolean }> => {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        return { payload: await response.json(), isJson: true };
      } catch {
        // Fall through to text parsing.
      }
    }

    try {
      const text = await response.text();
      return { payload: text, isJson: false };
    } catch {
      return { payload: null, isJson: false };
    }
  };

  const getStatusBarToday = async (
    username: string,
    apiKey: string,
    options?: { bypassCache?: boolean }
  ): Promise<WakaTimeResult> => {
    const cacheKey = `${username}:${apiKey}`;
    const cached = statusCache.get(cacheKey);
    const now = Date.now();
    const fallbackTimezone = cached?.result.timezone ?? null;
    const fallbackDateKey = toDateKeyInTimeZone(new Date(), fallbackTimezone);

    if (
      !options?.bypassCache &&
      cached &&
      cached.dateKey === fallbackDateKey &&
      now - cached.fetchedAt < ttlMs
    ) {
      return { ...cached.result, fromCache: true };
    }

    const url = new URL(`https://wakatime.com/api/v1/users/${encodeURIComponent(username)}/status_bar/today`);
    const auth = Buffer.from(`${apiKey}:`).toString("base64");

    try {
      const response = await fetcher(url.toString(), {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json"
        }
      });

      const { payload, isJson } = await readPayload(response);
      const responseStatus = response.status;
      const responseOk = response.ok;

      if (responseStatus === 401 || responseStatus === 403) {
        const errorMessage = extractErrorMessageFromPayload(payload);
        const result: WakaTimeResult = {
          status: "private",
          totalSeconds: 0,
          dateKey: fallbackDateKey,
          timezone: fallbackTimezone,
          error: errorMessage || "User data is private or unauthorized",
          fetchedAt: now,
          responseStatus,
          responseOk,
          payload
        };
        statusCache.set(cacheKey, {
          dateKey: result.dateKey ?? fallbackDateKey,
          fetchedAt: now,
          result
        });
        return result;
      }

      if (responseStatus === 404) {
        const errorMessage = extractErrorMessageFromPayload(payload);
        const normalizedError = errorMessage?.toLowerCase() ?? "";
        const isPrivate =
          normalizedError.includes("private") ||
          normalizedError.includes("unauthorized") ||
          normalizedError.includes("forbidden");
        const result: WakaTimeResult = {
          status: isPrivate ? "private" : "not_found",
          totalSeconds: 0,
          dateKey: fallbackDateKey,
          timezone: fallbackTimezone,
          error:
            errorMessage ||
            (isPrivate ? "User data is private or unauthorized" : "User not found"),
          fetchedAt: now,
          responseStatus,
          responseOk,
          payload
        };
        statusCache.set(cacheKey, {
          dateKey: result.dateKey ?? fallbackDateKey,
          fetchedAt: now,
          result
        });
        return result;
      }

      if (!responseOk) {
        const errorMessage = extractErrorMessageFromPayload(payload);
        const result: WakaTimeResult = {
          status: "error",
          totalSeconds: 0,
          dateKey: fallbackDateKey,
          timezone: fallbackTimezone,
          error: errorMessage || `Unexpected response (${response.status})`,
          fetchedAt: now,
          responseStatus,
          responseOk,
          payload
        };
        statusCache.set(cacheKey, {
          dateKey: result.dateKey ?? fallbackDateKey,
          fetchedAt: now,
          result
        });
        return result;
      }

      const dataPayload = isJson
        ? (payload as {
            data?: {
              grand_total?: { total_seconds?: number };
              range?: { date?: string; timezone?: string };
            };
          })
        : null;
      const totalSeconds = dataPayload?.data?.grand_total?.total_seconds ?? 0;
      const range = dataPayload?.data?.range;
      const timezone =
        typeof range?.timezone === "string" && range.timezone.trim()
          ? range.timezone.trim()
          : null;
      const dateKey =
        typeof range?.date === "string" && range.date
          ? range.date
          : toDateKeyInTimeZone(new Date(), timezone);
      const result: WakaTimeResult = {
        status: "ok",
        totalSeconds,
        dateKey,
        timezone,
        fetchedAt: now,
        responseStatus,
        responseOk,
        payload
      };

      statusCache.set(cacheKey, { dateKey, fetchedAt: now, result });
      return result;
    } catch (error) {
      const networkError = error instanceof Error ? error.message : "Network error";
      const fallback = cached?.result ?? {
        status: "error",
        totalSeconds: 0,
        dateKey: fallbackDateKey,
        timezone: fallbackTimezone,
        error: networkError,
        fetchedAt: now,
        responseStatus: undefined,
        responseOk: false,
        payload: undefined
      };

      return {
        ...fallback,
        dateKey: fallback.dateKey ?? fallbackDateKey,
        timezone: fallback.timezone ?? fallbackTimezone,
        fetchedAt: cached?.fetchedAt ?? now,
        fromCache: Boolean(cached),
        networkError: Boolean(cached) ? networkError : null
      };
    }
  };

  const getStatsRange = async (
    rangeKey: string,
    apiKey: string,
    options?: { bypassCache?: boolean }
  ): Promise<WakaTimeStatsResult> => {
    const cacheKey = `stats:${rangeKey}:${apiKey}`;
    const dateKey = toUtcDateKey();
    const cached = statsCache.get(cacheKey);
    const now = Date.now();

    if (
      !options?.bypassCache &&
      cached &&
      cached.dateKey === dateKey &&
      now - cached.fetchedAt < ttlMs
    ) {
      return { ...cached.result, fromCache: true };
    }

    const url = new URL(
      `https://wakatime.com/api/v1/users/current/stats/${encodeURIComponent(rangeKey)}`
    );
    const auth = Buffer.from(`${apiKey}:`).toString("base64");

    try {
      const response = await fetcher(url.toString(), {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json"
        }
      });

      const { payload, isJson } = await readPayload(response);
      const responseStatus = response.status;
      const responseOk = response.ok;

      if (responseStatus === 401 || responseStatus === 403) {
        const errorMessage = extractErrorMessageFromPayload(payload);
        const result: WakaTimeStatsResult = {
          status: "private",
          totalSeconds: 0,
          dailyAverageSeconds: 0,
          error: errorMessage || "User data is private or unauthorized",
          fetchedAt: now,
          responseStatus,
          responseOk,
          payload
        };
        statsCache.set(cacheKey, {
          dateKey,
          fetchedAt: now,
          result
        });
        return result;
      }

      if (responseStatus === 404) {
        const errorMessage = extractErrorMessageFromPayload(payload);
        const normalizedError = errorMessage?.toLowerCase() ?? "";
        const isPrivate =
          normalizedError.includes("private") ||
          normalizedError.includes("unauthorized") ||
          normalizedError.includes("forbidden");
        const result: WakaTimeStatsResult = {
          status: isPrivate ? "private" : "not_found",
          totalSeconds: 0,
          dailyAverageSeconds: 0,
          error:
            errorMessage ||
            (isPrivate ? "User data is private or unauthorized" : "User not found"),
          fetchedAt: now,
          responseStatus,
          responseOk,
          payload
        };
        statsCache.set(cacheKey, {
          dateKey,
          fetchedAt: now,
          result
        });
        return result;
      }

      if (!responseOk) {
        const errorMessage = extractErrorMessageFromPayload(payload);
        const result: WakaTimeStatsResult = {
          status: "error",
          totalSeconds: 0,
          dailyAverageSeconds: 0,
          error: errorMessage || `Unexpected response (${response.status})`,
          fetchedAt: now,
          responseStatus,
          responseOk,
          payload
        };
        statsCache.set(cacheKey, {
          dateKey,
          fetchedAt: now,
          result
        });
        return result;
      }

      const dataPayload = isJson
        ? (payload as {
            data?: {
              total_seconds?: number;
              total_seconds_including_other_language?: number;
              daily_average?: number;
              daily_average_including_other_language?: number;
            };
          })
        : null;
      const totalSeconds =
        dataPayload?.data?.total_seconds_including_other_language ??
        dataPayload?.data?.total_seconds ??
        0;
      const dailyAverageSeconds =
        dataPayload?.data?.daily_average_including_other_language ??
        dataPayload?.data?.daily_average ??
        0;
      const result: WakaTimeStatsResult = {
        status: "ok",
        totalSeconds,
        dailyAverageSeconds,
        fetchedAt: now,
        responseStatus,
        responseOk,
        payload
      };

      statsCache.set(cacheKey, {
        dateKey,
        fetchedAt: now,
        result
      });
      return result;
    } catch (error) {
      const networkError = error instanceof Error ? error.message : "Network error";
      const fallback = cached?.result ?? {
        status: "error",
        totalSeconds: 0,
        dailyAverageSeconds: 0,
        error: networkError,
        fetchedAt: now,
        responseStatus: undefined,
        responseOk: false,
        payload: undefined
      };

      return {
        status: fallback.status,
        totalSeconds: fallback.totalSeconds,
        dailyAverageSeconds: fallback.dailyAverageSeconds ?? 0,
        error: fallback.error ?? null,
        fetchedAt: cached?.fetchedAt ?? now,
        fromCache: Boolean(cached),
        networkError: Boolean(cached) ? networkError : null
      };
    }
  };

  return { getStatusBarToday, getStatsRange };
};
