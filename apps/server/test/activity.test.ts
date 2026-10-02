import { describe, expect, it, vi } from "vitest";
import { createActivityClient, parseActivity } from "../src/activity.js";
import {
  createSocialStore,
  BOOST_COOLDOWN_MS,
  MUSIC_TTL_MS,
} from "../src/social.js";

const summary = {
  range: { date: "2026-10-02" },
  grand_total: {
    total_seconds: 7200,
    ai_additions: 100,
    ai_deletions: 12,
    ai_input_tokens: 4000,
    ai_output_tokens: 2000,
    ai_sessions: 3,
    ai_model_breakdown: [{ name: "Model A", lines: 112 }],
    ai_model_line_changes: { "Model A": 112 },
  },
  categories: [
    { name: "AI Coding", total_seconds: 900 },
    { name: "Coding", total_seconds: 6300 },
  ],
  editors: [{ name: "Cursor", total_seconds: 7200 }],
  languages: [
    { name: "TypeScript", total_seconds: 7000 },
    { name: "JSON", total_seconds: 200 },
  ],
  projects: [{ name: "private-client" }],
  machines: [{ name: "private-host" }],
  entities: [{ name: "/private/file" }],
};

describe("activity details", () => {
  it("aggregates real AI metrics, with no inferred agent hours or sensitive fields", () => {
    const result = parseActivity(
      { data: [summary, { ...summary, range: { date: "2026-10-01" } }] },
      "mo",
      "week",
      "2026-10-02",
    );
    expect(result.totalSeconds).toBe(14400);
    expect(result.ai.totalSeconds).toBe(1800);
    expect(result.ai.models).toEqual([{ name: "Model A", linesChanged: 224 }]);
    expect(result.ai.sessions).toBe(6);
    expect(result.editors[0].totalSeconds).toBe(14400);
    expect(result.languages[0].percent).toBeCloseTo(97.22, 2);
    expect(JSON.stringify(result)).not.toMatch(
      /private-client|private-host|\/private\/file/,
    );
  });
  it("distinguishes missing AI fields from a reported zero and filters period boundaries", () => {
    const result = parseActivity(
      {
        data: [
          {
            range: { date: "2026-10-02" },
            grand_total: { total_seconds: 12, ai_additions: 0 },
            editors: [{ name: "Cursor", total_seconds: 12 }],
          },
          summary,
          { ...summary, range: { date: "2026-09-01" } },
        ],
      },
      "mo",
      "today",
      "2026-10-02",
    );
    expect(result.days.every((day) => day.date === "2026-10-02")).toBe(true);
    const noAI = parseActivity(
      {
        data: [
          {
            range: { date: "2026-10-02" },
            grand_total: { total_seconds: 12, ai_additions: 0 },
            editors: [{ name: "Cursor", total_seconds: 12 }],
          },
        ],
      },
      "mo",
      "today",
      "2026-10-02",
    );
    expect(noAI.ai.totalSeconds).toBeNull();
    expect(noAI.ai.additions).toBe(0);
    expect(noAI.ai.inputTokens).toBeNull();
  });
  it("rejects malformed metrics rather than allowing NaN or negative chart values", () => {
    const result = parseActivity(
      {
        data: [
          {
            range: { date: "2026-10-02" },
            grand_total: { total_seconds: -2 },
            languages: [
              { name: "invalid", total_seconds: "100" },
              { name: "infinite", total_seconds: Infinity },
            ],
          },
        ],
      },
      "mo",
      "today",
      "2026-10-02",
    );
    expect(result.totalSeconds).toBe(0);
    expect(result.languages).toEqual([]);
  });
  it("deduplicates requests, caches by day, and clears data on revoked access", async () => {
    let now = Date.parse("2026-10-02T12:00:00Z");
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [summary] }), { status: 200 }),
      );
    const client = createActivityClient(fetcher, () => now);
    const input = {
      id: 1,
      username: "mo",
      apiKey: "test-key",
      timezone: "UTC",
      period: "week" as const,
    };
    const [a, b] = await Promise.all([client.get(input), client.get(input)]);
    expect(a).toEqual(b);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await client.get(input);
    expect(fetcher).toHaveBeenCalledTimes(2);
    now += 6 * 60_000;
    fetcher.mockResolvedValueOnce(new Response(null, { status: 403 }));
    const denied = await client.get(input);
    expect(denied.status).toBe("private");
    expect(denied.totalSeconds).toBe(0);
    expect(denied.days).toEqual([]);
  });
  it("retains a marked stale result on provider failure and honors retry backoff", async () => {
    let now = Date.parse("2026-10-02T12:00:00Z");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [summary] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })))
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "retry-after": "600" } }),
      );
    const client = createActivityClient(fetcher, () => now);
    const input = {
      id: 1,
      username: "mo",
      apiKey: "test",
      period: "today" as const,
    };
    await client.get(input);
    now += 6 * 60_000;
    const stale = await client.get(input);
    expect(stale.stale).toBe(true);
    expect(stale.totalSeconds).toBe(7200);
    now += 2 * 60_000;
    await client.get(input);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe("ephemeral social activity", () => {
  it("expires and immediately clears music without storing history", () => {
    let now = 0;
    const store = createSocialStore(() => now);
    const track = {
      title: "Song",
      artist: "Artist",
      album: "Album",
      trackId: "a".repeat(22),
    };
    store.setMusic(1, track);
    expect(store.getMusic(1)?.track).toEqual(track);
    now += MUSIC_TTL_MS;
    expect(store.getMusic(1)).toBeNull();
    store.setMusic(1, track);
    store.setMusic(1, null);
    expect(store.getMusic(1)).toBeNull();
  });
  it("enforces a shared cooldown across reaction types and isolates recipients", () => {
    let now = 0;
    const store = createSocialStore(() => now);
    expect(store.sendBoost(1, 2, "fire").ok).toBe(true);
    expect(store.sendBoost(1, 2, "applause").ok).toBe(false);
    expect(store.getBoosts(3)).toEqual([]);
    expect(store.getBoosts(2)).toHaveLength(1);
    now += BOOST_COOLDOWN_MS;
    expect(store.sendBoost(1, 2, "applause").ok).toBe(true);
  });
});
