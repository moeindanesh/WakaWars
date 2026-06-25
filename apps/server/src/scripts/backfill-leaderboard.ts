import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import type { DailyStatStatus } from "@molty/shared";
import { createPrismaRepository } from "../repository.js";
import type { UserRepository } from "../repository.js";
import { shiftDateKey, toDateKeyInTimeZone } from "../date-key.js";
import {
  DEFAULT_WAKATIME_BATCH_DELAY_MS,
  DEFAULT_WAKATIME_BATCH_SIZE,
  runInBatches
} from "../wakatime-rate-limit.js";

/**
 * Backfills (and refreshes) the daily leaderboard source — `ww_daily_stat` — for
 * every user across a trailing window of days.
 *
 * The live sync only ever fetches `status_bar/today`, so prior days are never
 * filled in. This script pulls WakaTime's `summaries` endpoint, which returns a
 * per-day grand total over a date range, and upserts one daily stat per returned
 * day. Existing rows are updated; missing rows are created.
 *
 * `days` is the number of *history* days to fill, counted back from today — the
 * history view renders offsets -1..-14 (yesterday back through 14 days ago), so
 * the default of 14 covers the full history page. We fetch from `today - days`
 * through `today` inclusive, which also fills today's live board for free.
 *
 * WakaTime free accounts only retain ~2 weeks and reject a `start` older than
 * that for the whole request, so when the ideal window is rejected we retry with
 * a free-plan-safe window (the last 14 days including today) rather than failing
 * the user entirely. Override the window with `--days=N` / `LEADERBOARD_BACKFILL_DAYS=N`.
 *
 * Usage:
 *   pnpm --filter @molty/server backfill:leaderboard
 *   pnpm --filter @molty/server backfill:leaderboard -- --days=7
 */

const DEFAULT_BACKFILL_DAYS = 14;
// Free accounts can read summaries for the last 14 days including today, i.e. a
// `start` no older than today - 13.
const WAKATIME_FREE_PLAN_MAX_DAYS = 14;

type SummaryDay = {
  dateKey: string;
  totalSeconds: number;
  timezone: string | null;
};

type SummariesResult = {
  status: DailyStatStatus;
  days: SummaryDay[];
  error: string | null;
  timezone: string | null;
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const asNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const extractErrorMessage = (payload: unknown): string | null => {
  const data = asObject(payload);
  if (!data) {
    return typeof payload === "string" && payload.trim() ? payload.trim() : null;
  }
  const value = data.error ?? data.message ?? data.errors;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value) && value.length) {
    return value.filter(Boolean).join(", ").trim() || null;
  }
  return null;
};

const parseDays = (): number => {
  const flag = process.argv
    .find((arg) => arg.startsWith("--days="))
    ?.split("=")[1];
  const raw = flag ?? process.env.LEADERBOARD_BACKFILL_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_BACKFILL_DAYS;
  }
  return Math.trunc(parsed);
};

const fetchSummaries = async ({
  apiKey,
  start,
  end
}: {
  apiKey: string;
  start: string;
  end: string;
}): Promise<SummariesResult> => {
  const url = new URL("https://wakatime.com/api/v1/users/current/summaries");
  url.searchParams.set("start", start);
  url.searchParams.set("end", end);
  const auth = Buffer.from(`${apiKey}:`).toString("base64");

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    return { status: "error", days: [], error: message, timezone: null };
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.status === 401 || response.status === 403) {
    return {
      status: "private",
      days: [],
      error: extractErrorMessage(payload) ?? "User data is private or unauthorized",
      timezone: null
    };
  }

  if (response.status === 404) {
    const message = extractErrorMessage(payload);
    const normalized = message?.toLowerCase() ?? "";
    const isPrivate =
      normalized.includes("private") ||
      normalized.includes("unauthorized") ||
      normalized.includes("forbidden");
    return {
      status: isPrivate ? "private" : "not_found",
      days: [],
      error: message ?? (isPrivate ? "User data is private or unauthorized" : "User not found"),
      timezone: null
    };
  }

  if (!response.ok) {
    return {
      status: "error",
      days: [],
      error: extractErrorMessage(payload) ?? `Unexpected response (${response.status})`,
      timezone: null
    };
  }

  const data = asObject(payload)?.data;
  const entries = Array.isArray(data) ? data : [];
  let timezone: string | null = null;

  const days = entries
    .map((entry) => {
      const range = asObject(asObject(entry)?.range);
      const grandTotal = asObject(asObject(entry)?.grand_total);
      const dateKey =
        typeof range?.date === "string" && range.date ? range.date : null;
      if (!dateKey) return null;
      const entryTimezone =
        typeof range?.timezone === "string" && range.timezone.trim()
          ? range.timezone.trim()
          : null;
      if (entryTimezone) timezone = entryTimezone;
      return {
        dateKey,
        totalSeconds: Math.round(asNumber(grandTotal?.total_seconds)),
        timezone: entryTimezone
      } satisfies SummaryDay;
    })
    .filter((day): day is SummaryDay => day !== null);

  return { status: "ok", days, error: null, timezone };
};

const backfillUser = async ({
  store,
  user,
  days,
  now
}: {
  store: UserRepository;
  user: { id: number; wakawarsUsername: string; apiKey: string; wakatimeTimezone?: string | null };
  days: number;
  now: Date;
}): Promise<{ daysWritten: number; status: DailyStatStatus }> => {
  const endKey = toDateKeyInTimeZone(now, user.wakatimeTimezone ?? null);
  // Fill from `today - days` (offset -days) through today, covering the full
  // history range (offsets -1..-days) plus today's live board.
  const idealStartKey = shiftDateKey(endKey, -days);
  const safeStartKey = shiftDateKey(endKey, -(WAKATIME_FREE_PLAN_MAX_DAYS - 1));

  let result = await fetchSummaries({
    apiKey: user.apiKey,
    start: idealStartKey,
    end: endKey
  });

  // Free accounts reject a too-old `start` for the entire request — fall back to
  // the last 14 days so they still get as much history as the plan allows.
  if (result.status === "error" && idealStartKey < safeStartKey) {
    const fallback = await fetchSummaries({
      apiKey: user.apiKey,
      start: safeStartKey,
      end: endKey
    });
    if (fallback.status === "ok") {
      // eslint-disable-next-line no-console
      console.warn(
        `[backfill-leaderboard] user=${user.wakawarsUsername} (${user.id}) fell back to free-plan window (last ${WAKATIME_FREE_PLAN_MAX_DAYS} days)`
      );
      result = fallback;
    }
  }

  if (result.timezone && result.timezone !== user.wakatimeTimezone) {
    await store.setWakaTimeTimezone(user.id, result.timezone);
  }

  // Only overwrite leaderboard rows with real data — a private/error response
  // must not clobber previously-synced good days.
  if (result.status !== "ok") {
    // eslint-disable-next-line no-console
    console.warn(
      `[backfill-leaderboard] skip user=${user.wakawarsUsername} (${user.id}) status=${result.status} error=${result.error ?? "n/a"}`
    );
    return { daysWritten: 0, status: result.status };
  }

  const fetchedAt = new Date();
  for (const day of result.days) {
    await store.upsertDailyStat({
      userId: user.id,
      dateKey: day.dateKey,
      totalSeconds: day.totalSeconds,
      status: "ok",
      error: null,
      fetchedAt
    });
  }

  return { daysWritten: result.days.length, status: "ok" };
};

export const runLeaderboardBackfill = async ({
  store,
  days,
  now = new Date()
}: {
  store: UserRepository;
  days: number;
  now?: Date;
}) => {
  const allUsers = await store.listUsers();
  const targets = allUsers
    .map((user) => ({ ...user, apiKey: user.apiKey.trim() }))
    .filter((user) => Boolean(user.apiKey));

  // eslint-disable-next-line no-console
  console.log(
    `[backfill-leaderboard] starting: ${targets.length}/${allUsers.length} users with API keys, window=${days} day(s)`
  );

  let usersProcessed = 0;
  let usersSucceeded = 0;
  let usersSkipped = 0;
  let daysWritten = 0;

  await runInBatches(
    targets,
    async (user) => {
      const summary = await backfillUser({ store, user, days, now });
      usersProcessed += 1;
      daysWritten += summary.daysWritten;
      if (summary.status === "ok") {
        usersSucceeded += 1;
      } else {
        usersSkipped += 1;
      }
      if (summary.status === "ok") {
        // eslint-disable-next-line no-console
        console.log(
          `[backfill-leaderboard] user=${user.wakawarsUsername} (${user.id}) wrote ${summary.daysWritten} day(s)`
        );
      }
    },
    {
      batchSize: DEFAULT_WAKATIME_BATCH_SIZE,
      delayMs: DEFAULT_WAKATIME_BATCH_DELAY_MS,
      onError: (error) => {
        usersSkipped += 1;
        // eslint-disable-next-line no-console
        console.error("[backfill-leaderboard] user failed", error);
      }
    }
  );

  return {
    users: targets.length,
    usersProcessed,
    usersSucceeded,
    usersSkipped,
    daysWritten,
    days
  };
};

const run = async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const days = parseDays();

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } }
  });

  try {
    const store = createPrismaRepository(prisma);
    const summary = await runLeaderboardBackfill({ store, days });
    // eslint-disable-next-line no-console
    console.log("[backfill-leaderboard] complete", summary);
  } finally {
    await prisma.$disconnect();
  }
};

// Only auto-run when invoked directly (not when imported by a test).
const invokedDirectly =
  typeof process.argv[1] === "string" &&
  /backfill-leaderboard(\.[cm]?[jt]s)?$/.test(process.argv[1]);

if (invokedDirectly) {
  run().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[backfill-leaderboard] failed", error);
    process.exit(1);
  });
}
