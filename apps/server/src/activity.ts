import type { ActivityBreakdown, ActivityDetails } from "@molty/shared";
import { shiftDateKey, toDateKeyInTimeZone } from "./date-key.js";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

// An explicit allowlist: project names, file paths, machine IDs, prompts and
// provider credentials never enter the public activity response or this cache.
export function parseActivity(
  payload: unknown,
  username: string,
  period: "today" | "week",
  end: string,
  now = Date.now(),
): ActivityDetails {
  const start = period === "today" ? end : shiftDateKey(end, -6);
  const rows = array(object(payload).data)
    .map(object)
    .filter((row) => {
      const date = object(row.range).date;
      return typeof date === "string" && date >= start && date <= end;
    });
  const breakdown = (key: string): ActivityBreakdown[] => {
    const totals = new Map<string, number>();
    for (const row of rows)
      for (const raw of array(row[key])) {
        const item = object(raw);
        if (typeof item.name !== "string" || !item.name.trim()) continue;
        const seconds = number(item.total_seconds);
        if (seconds === null) continue;
        const name = item.name.slice(0, 100);
        totals.set(name, (totals.get(name) ?? 0) + seconds);
      }
    const sum = [...totals.values()].reduce((a, b) => a + b, 0);
    return [...totals]
      .map(([name, totalSeconds]) => ({
        name,
        totalSeconds,
        percent: sum ? (totalSeconds / sum) * 100 : 0,
      }))
      .sort(
        (a, b) =>
          b.totalSeconds - a.totalSeconds || a.name.localeCompare(b.name),
      )
      .slice(0, 30);
  };
  const sumField = (key: string): number | null => {
    const values = rows
      .map((row) => number(object(row.grand_total)[key]))
      .filter((n): n is number => n !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  const aiSeconds = (row: Record<string, unknown>): number | null => {
    const category = array(row.categories)
      .map(object)
      .find(
        (item) =>
          typeof item.name === "string" &&
          item.name.toLowerCase() === "ai coding",
      );
    return category ? number(category.total_seconds) : null;
  };
  const models = new Map<string, number>();
  for (const row of rows) {
    const total = object(row.grand_total);
    const modelRows = array(total.ai_model_breakdown);
    // Prefer the breakdown; the map is an alternative representation, not extra data.
    const entries = modelRows.length
      ? modelRows.map(object).map((item) => [item.name, item.lines] as const)
      : Object.entries(object(total.ai_model_line_changes));
    for (const [name, lines] of entries) {
      if (typeof name === "string" && number(lines) !== null) {
        models.set(
          name.slice(0, 100),
          (models.get(name.slice(0, 100)) ?? 0) + (number(lines) ?? 0),
        );
      }
    }
  }
  const days = rows
    .map((row) => ({
      date: String(object(row.range).date),
      totalSeconds: number(object(row.grand_total).total_seconds) ?? 0,
      aiSeconds: aiSeconds(row),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const totalSeconds = days.reduce((sum, day) => sum + day.totalSeconds, 0);
  const reportedAI = days.flatMap((day) =>
    day.aiSeconds === null ? [] : [day.aiSeconds],
  );
  return {
    username,
    period,
    status: "ok",
    updatedAt: new Date(now).toISOString(),
    stale: false,
    totalSeconds,
    dailyAverageSeconds: days.length ? totalSeconds / days.length : 0,
    days,
    languages: breakdown("languages"),
    editors: breakdown("editors"),
    categories: breakdown("categories"),
    ai: {
      totalSeconds: reportedAI.length
        ? reportedAI.reduce((a, b) => a + b, 0)
        : null,
      additions: sumField("ai_additions"),
      deletions: sumField("ai_deletions"),
      inputTokens: sumField("ai_input_tokens"),
      outputTokens: sumField("ai_output_tokens"),
      sessions: sumField("ai_sessions"),
      models: [...models]
        .map(([name, linesChanged]) => ({ name, linesChanged }))
        .sort((a, b) => b.linesChanged - a.linesChanged)
        .slice(0, 20),
    },
  };
}

export function createActivityClient(
  fetcher: typeof fetch = globalThis.fetch,
  clock = Date.now,
) {
  type Cached = { value: ActivityDetails; retryAt: number };
  const cache = new Map<string, Cached>();
  const pending = new Map<string, Promise<ActivityDetails>>();
  const profiles = new Map<
    string,
    { expires: number; value: NonNullable<ActivityDetails["profile"]> }
  >();
  const profile = async (id: number, apiKey: string) => {
    const key = `${id}:${apiKey}`;
    const previous = profiles.get(key);
    if (previous && previous.expires > clock()) return previous.value;
    const value: NonNullable<ActivityDetails["profile"]> = {
      displayName: null,
      photoUrl: null,
      bio: null,
    };
    try {
      const response = await fetcher(
        "https://wakatime.com/api/v1/users/current",
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (response.ok) {
        const data = object(object(await response.json()).data);
        if (typeof data.display_name === "string")
          value.displayName = data.display_name.slice(0, 100);
        if (typeof data.bio === "string") value.bio = data.bio.slice(0, 240);
        if (data.is_photo_public === true && typeof data.photo === "string") {
          const url = new URL(data.photo);
          if (url.protocol === "https:" && !url.username && !url.password)
            value.photoUrl = url.toString();
        }
      }
    } catch {
      /* Optional profile metadata must not prevent viewing activity. */
    }
    if (profiles.size >= 500) profiles.delete(profiles.keys().next().value!);
    profiles.set(key, { value, expires: clock() + 30 * 60_000 });
    return value;
  };
  return {
    async get(input: {
      id: number;
      username: string;
      apiKey: string;
      timezone?: string | null;
      period: "today" | "week";
    }) {
      const end = toDateKeyInTimeZone(
        new Date(clock()),
        input.timezone ?? null,
      );
      // Key rotation must not reuse responses fetched with previous credentials.
      const key = `${input.id}:${input.apiKey}:${input.period}:${end}`;
      const existing = cache.get(key);
      if (existing && clock() < existing.retryAt)
        return { ...existing.value, username: input.username };
      if (pending.has(key)) return pending.get(key)!;
      const run = async (): Promise<ActivityDetails> => {
        const unavailable = (status: "private" | "unavailable") => ({
          ...parseActivity(
            { data: [] },
            input.username,
            input.period,
            end,
            clock(),
          ),
          status,
        });
        let value: ActivityDetails;
        let retryMs = 5 * 60_000;
        try {
          const url = new URL(
            "https://wakatime.com/api/v1/users/current/summaries",
          );
          url.searchParams.set(
            "start",
            input.period === "today" ? end : shiftDateKey(end, -6),
          );
          url.searchParams.set("end", end);
          if (input.timezone) url.searchParams.set("timezone", input.timezone);
          const response = await fetcher(url, {
            headers: {
              Authorization: `Basic ${Buffer.from(`${input.apiKey}:`).toString("base64")}`,
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(12_000),
          });
          if (response.status === 401 || response.status === 403)
            value = unavailable("private");
          else {
            if (!response.ok) {
              const retry = Number(response.headers.get("retry-after"));
              retryMs =
                Number.isFinite(retry) && retry > 0
                  ? Math.min(retry * 1000, 3_600_000)
                  : 60_000;
              throw new Error("Provider unavailable");
            }
            const payload: unknown = await response.json();
            if (!Array.isArray(object(payload).data))
              throw new Error("Invalid summaries");
            value = parseActivity(
              payload,
              input.username,
              input.period,
              end,
              clock(),
            );
            value.profile = await profile(input.id, input.apiKey);
          }
        } catch {
          value =
            existing?.value.status === "ok" &&
            clock() - Date.parse(existing.value.updatedAt) < 30 * 60_000
              ? { ...existing.value, username: input.username, stale: true }
              : unavailable("unavailable");
          retryMs = Math.min(retryMs, 3_600_000);
        }
        if (cache.size >= 500) cache.delete(cache.keys().next().value!);
        cache.set(key, { value, retryAt: clock() + retryMs });
        return value;
      };
      const task = run().finally(() => pending.delete(key));
      pending.set(key, task);
      return task;
    },
  };
}
