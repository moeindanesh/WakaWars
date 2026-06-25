import { createHash } from "node:crypto";
import type { UserRepository } from "./repository.js";
import { extractTopEntryNames } from "./achievements.js";
import {
  HONOR_TITLE_ACHIEVEMENT_IDS,
  TITLE_BY_ACHIEVEMENT_ID,
  resolveHonorTitlesByUserId,
} from "./honor-titles.js";
import { DEFAULT_WAKATIME_WEEKLY_RANGE } from "./wakatime-weekly-cache.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "meta-llama/llama-3.1-8b-instruct";
const REQUEST_TIMEOUT_MS = 8000;
const MAX_TITLE_LENGTH = 40;

export type HonorTitleSignalAchievement = {
  id: string;
  title: string;
  count: number;
};

export type HonorTitleSignal = {
  username: string;
  deterministicTitle: string | null;
  achievements: HonorTitleSignalAchievement[];
  /** Top languages/editors/projects from today's payload, most-used first. */
  languages: string[];
  editors: string[];
  projects: string[];
  weeklyHours: number;
  dailyAverageHours: number;
  todayHours: number;
};

export type HonorTitleGenerator = {
  /**
   * Generate-and-cache a user's AI honor title if their signal changed since the
   * last generation. Never throws — failures leave the previous title in place.
   * `todayPayload` is the raw WakaTime status_bar/today response, mined for the
   * languages/editors/projects that flavor the title.
   */
  maybeGenerate: (input: {
    userId: number;
    todaySeconds: number;
    todayPayload?: unknown;
  }) => Promise<void>;
};

const roundHours = (seconds: number): number =>
  Math.round((Math.max(0, seconds) / 3600) * 10) / 10;

/**
 * A stable fingerprint of the *meaningful* signal. Deliberately excludes volatile
 * inputs (raw today/weekly seconds) so the title is only regenerated when the user
 * crosses a milestone or switches their main stack, not every sync cycle. Only the
 * single dominant language/editor/project feeds the fingerprint — minor reshuffles
 * between secondary tools don't trigger a regeneration. Today/weekly hours and the
 * full tool lists still feed the prompt for flavor, just not the trigger.
 */
const buildSignature = (signal: HonorTitleSignal): string => {
  const achievements = [...signal.achievements]
    .map((entry) => `${entry.id}:${entry.count}`)
    .sort()
    .join(",");
  const weeklyBucket = Math.floor(signal.weeklyHours);
  const primaryTools = [
    signal.languages[0] ?? "",
    signal.editors[0] ?? "",
    signal.projects[0] ?? "",
  ].join("|");
  const raw = JSON.stringify({
    deterministicTitle: signal.deterministicTitle,
    achievements,
    weeklyBucket,
    primaryTools,
  });
  return createHash("sha1").update(raw).digest("hex");
};

const sanitizeTitle = (value: string): string | null => {
  const firstLine = value.split(/\r?\n/)[0] ?? "";
  const cleaned = firstLine
    .replace(/["'`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;:,!]+$/g, "")
    .trim();
  if (!cleaned) {
    return null;
  }
  return cleaned.length > MAX_TITLE_LENGTH
    ? cleaned.slice(0, MAX_TITLE_LENGTH).trim()
    : cleaned;
};

const requestTitle = async ({
  signal,
  apiKey,
  model,
  fetcher,
}: {
  signal: HonorTitleSignal;
  apiKey: string;
  model: string;
  fetcher: typeof fetch;
}): Promise<string | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const systemPrompt =
    "You are the snarky title-bard of WakaWars, a coding-time leaderboard. " +
    "Given a developer's stats and the tools they actually used (languages, " +
    "editors, projects), crown them with ONE witty, sarcastic honor title that " +
    "lovingly roasts their coding habits. Lean on their tools when they're juicy " +
    "(e.g. 'Vim Hostage', 'TypeScript Apologist', 'Rust Evangelist', " +
    "'Localhost Hermit') and tease the grinders and the slackers alike. Rules: " +
    "2 to 5 words, Title Case, playful not mean, no quotes, no emoji, no hashtags, " +
    "no trailing punctuation, no explanation. Return only the title.";

  const userPrompt = JSON.stringify({
    previousBoringTitle: signal.deterministicTitle,
    topLanguages: signal.languages,
    editors: signal.editors,
    topProjects: signal.projects,
    unlockedMilestones: signal.achievements.map((entry) => ({
      milestone: entry.title,
      timesUnlocked: entry.count,
    })),
    weeklyHours: signal.weeklyHours,
    dailyAverageHours: signal.dailyAverageHours,
    todayHours: signal.todayHours,
  });

  try {
    const response = await fetcher(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 32,
        temperature: 0.95,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return null;
    }
    return sanitizeTitle(content);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

export type HonorTitleGeneratorOptions = {
  store: UserRepository;
  apiKey?: string | null;
  model?: string;
  fetcher?: typeof fetch;
  weeklyRangeKey?: string;
  onError?: (error: unknown) => void;
};

export const createHonorTitleGenerator = ({
  store,
  apiKey,
  model,
  fetcher = globalThis.fetch,
  weeklyRangeKey = DEFAULT_WAKATIME_WEEKLY_RANGE,
  onError,
}: HonorTitleGeneratorOptions): HonorTitleGenerator | null => {
  const trimmedKey = apiKey?.trim();
  if (!trimmedKey) {
    return null;
  }
  const resolvedModel = model?.trim() || DEFAULT_MODEL;

  const buildSignal = async (
    userId: number,
    todaySeconds: number,
    todayPayload: unknown
  ): Promise<HonorTitleSignal | null> => {
    const user = await store.getUserById(userId);
    if (!user) {
      return null;
    }

    const [unlocks, grants, weeklyStats] = await Promise.all([
      store.listAchievementUnlocks({ userId }),
      store.listAchievementGrants({
        userIds: [userId],
        achievementIds: HONOR_TITLE_ACHIEVEMENT_IDS,
      }),
      store.getWeeklyStats({ userIds: [userId], rangeKey: weeklyRangeKey }),
    ]);

    const deterministicTitle =
      resolveHonorTitlesByUserId({ userIds: [userId], grants }).get(userId) ??
      null;
    const weekly = weeklyStats[0];

    return {
      username: user.wakawarsUsername,
      deterministicTitle,
      achievements: unlocks.map((entry) => ({
        id: entry.achievementId,
        title: TITLE_BY_ACHIEVEMENT_ID[entry.achievementId] ?? entry.achievementId,
        count: entry.count,
      })),
      languages: extractTopEntryNames(todayPayload, "languages", 3),
      editors: extractTopEntryNames(todayPayload, "editors", 3),
      projects: extractTopEntryNames(todayPayload, "projects", 3),
      weeklyHours: roundHours(weekly?.totalSeconds ?? 0),
      dailyAverageHours: roundHours(weekly?.dailyAverageSeconds ?? 0),
      todayHours: roundHours(todaySeconds),
    };
  };

  const maybeGenerate: HonorTitleGenerator["maybeGenerate"] = async ({
    userId,
    todaySeconds,
    todayPayload,
  }) => {
    try {
      const signal = await buildSignal(userId, todaySeconds, todayPayload);
      if (!signal) {
        return;
      }

      const signature = buildSignature(signal);
      const state = await store.getAiHonorTitleState(userId);
      if (state?.signature === signature && state.title) {
        return;
      }

      const title = await requestTitle({
        signal,
        apiKey: trimmedKey,
        model: resolvedModel,
        fetcher,
      });
      if (!title) {
        return;
      }

      await store.setAiHonorTitle({
        userId,
        title,
        signature,
        generatedAt: new Date(),
      });
    } catch (error) {
      onError?.(error);
    }
  };

  return { maybeGenerate };
};

export const __testing = { buildSignature, sanitizeTitle };
