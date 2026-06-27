import { describe, expect, it } from "vitest";
import {
  createHonorTitleGenerator,
  __testing,
} from "../src/honor-title-ai.js";

const { buildSignature, sanitizeTitle, resolveCurrentSlotStart } = __testing;

const baseSignal = {
  username: "mo",
  deterministicTitle: "Sultan of Weeks",
  achievements: [
    { id: "workweek-warrior-40h", title: "Workweek Warrior", count: 2 },
    { id: "deep-focus-day-8h", title: "Deep Focus Diver", count: 1 },
  ],
  languages: ["TypeScript", "CSS"],
  editors: ["VS Code"],
  projects: ["wakawars"],
  weeklyHours: 41.6,
  dailyAverageHours: 5.9,
  todayHours: 1.2,
};

describe("honor-title-ai buildSignature", () => {
  it("is stable across volatile today/weekly seconds within the same hour bucket", () => {
    const a = buildSignature(baseSignal);
    const b = buildSignature({
      ...baseSignal,
      todayHours: 7.5,
      weeklyHours: 41.9,
      dailyAverageHours: 6.1,
    });
    expect(a).toBe(b);
  });

  it("ignores achievement ordering", () => {
    const reversed = buildSignature({
      ...baseSignal,
      achievements: [...baseSignal.achievements].reverse(),
    });
    expect(reversed).toBe(buildSignature(baseSignal));
  });

  it("changes when a new achievement is unlocked", () => {
    const changed = buildSignature({
      ...baseSignal,
      achievements: [
        ...baseSignal.achievements,
        { id: "matrix-120h", title: "Matrix Sovereign", count: 1 },
      ],
    });
    expect(changed).not.toBe(buildSignature(baseSignal));
  });

  it("changes when crossing a whole-week-hour boundary", () => {
    const changed = buildSignature({ ...baseSignal, weeklyHours: 42.1 });
    expect(changed).not.toBe(buildSignature(baseSignal));
  });

  it("changes when the dominant language switches", () => {
    const changed = buildSignature({
      ...baseSignal,
      languages: ["Rust", "CSS"],
    });
    expect(changed).not.toBe(buildSignature(baseSignal));
  });

  it("ignores reshuffles among secondary tools", () => {
    const changed = buildSignature({
      ...baseSignal,
      languages: ["TypeScript", "Go", "Python"],
    });
    expect(changed).toBe(buildSignature(baseSignal));
  });
});

describe("honor-title-ai sanitizeTitle", () => {
  it("strips quotes, trailing punctuation and extra whitespace", () => {
    expect(sanitizeTitle('  "Night Shift Sentinel."  ')).toBe(
      "Night Shift Sentinel"
    );
  });

  it("keeps only the first line", () => {
    expect(sanitizeTitle("Overclock Core\nSome explanation")).toBe(
      "Overclock Core"
    );
  });

  it("caps length", () => {
    const long = "A".repeat(80);
    expect(sanitizeTitle(long)?.length).toBe(40);
  });

  it("returns null for empty output", () => {
    expect(sanitizeTitle("   ")).toBeNull();
  });
});

describe("honor-title-ai resolveCurrentSlotStart", () => {
  // Asia/Tehran is UTC+03:30 (no DST). Slots: 03:00, 12:00, 20:00 local.
  const tehranSlotUtc = (utcIso: string) =>
    resolveCurrentSlotStart(new Date(utcIso))?.toISOString();

  it("maps a time after the 12:00 slot back to 12:00 Tehran (08:30 UTC)", () => {
    // 2026-06-26 14:00 Tehran == 10:30 UTC → most recent slot is 12:00 Tehran == 08:30 UTC
    expect(tehranSlotUtc("2026-06-26T10:30:00Z")).toBe("2026-06-26T08:30:00.000Z");
  });

  it("maps a time after the 20:00 slot back to 20:00 Tehran (16:30 UTC)", () => {
    // 2026-06-26 22:00 Tehran == 18:30 UTC → slot 20:00 Tehran == 16:30 UTC
    expect(tehranSlotUtc("2026-06-26T18:30:00Z")).toBe("2026-06-26T16:30:00.000Z");
  });

  it("before the day's first slot, falls back to the previous day's 20:00 slot", () => {
    // 2026-06-26 02:00 Tehran == 2026-06-25 22:30 UTC → slot 20:00 Tehran (prev day) == 2026-06-25 16:30 UTC
    expect(tehranSlotUtc("2026-06-25T22:30:00Z")).toBe("2026-06-25T16:30:00.000Z");
  });
});

describe("createHonorTitleGenerator", () => {
  it("returns null when no API key is configured (deterministic fallback stays)", () => {
    const generator = createHonorTitleGenerator({
      store: {} as never,
      apiKey: "",
    });
    expect(generator).toBeNull();
  });

  const makeStore = (state: {
    title: string | null;
    signature: string | null;
    generatedAt: Date | null;
    custom?: boolean;
  }) => {
    const sets: unknown[] = [];
    const store = {
      getUserById: async () => ({ id: 1, wakawarsUsername: "mo" }),
      listAchievementUnlocks: async () => [],
      listAchievementGrants: async () => [],
      getWeeklyStats: async () => [{ totalSeconds: 0, dailyAverageSeconds: 0 }],
      getAiHonorTitleState: async () => state,
      setAiHonorTitle: async (input: unknown) => {
        sets.push(input);
      },
    } as never;
    return { store, sets };
  };

  it("skips generation when a title already exists for the current slot", async () => {
    const { store, sets } = makeStore({
      title: "Vim Hostage",
      signature: "old",
      // generated at 13:00 Tehran, same slot as the 14:00 Tehran "now"
      generatedAt: new Date("2026-06-26T09:30:00Z"),
    });
    let fetched = false;
    const generator = createHonorTitleGenerator({
      store,
      apiKey: "key",
      fetcher: (async () => {
        fetched = true;
        return new Response("{}");
      }) as never,
      now: () => new Date("2026-06-26T10:30:00Z"), // 14:00 Tehran
    });

    await generator?.maybeGenerate({ userId: 1, todaySeconds: 3600 });
    expect(fetched).toBe(false);
    expect(sets).toHaveLength(0);
  });

  it("regenerates once the next slot opens", async () => {
    const { store, sets } = makeStore({
      title: "Vim Hostage",
      signature: "old",
      // generated in the 12:00 slot…
      generatedAt: new Date("2026-06-26T09:30:00Z"),
    });
    const generator = createHonorTitleGenerator({
      store,
      apiKey: "key",
      fetcher: (async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Localhost Hermit" } }],
          })
        )) as never,
      // …now it's 21:00 Tehran, the 20:00 slot is open
      now: () => new Date("2026-06-26T17:30:00Z"),
    });

    await generator?.maybeGenerate({ userId: 1, todaySeconds: 3600 });
    expect(sets).toHaveLength(1);
  });

  it("never overwrites a hand-typed (custom) title on the scheduled sync", async () => {
    const { store, sets } = makeStore({
      title: "My Own Title",
      signature: null,
      // generated yesterday — a new slot is open, but the title is custom
      generatedAt: new Date("2026-06-25T09:30:00Z"),
      custom: true,
    });
    let fetched = false;
    const generator = createHonorTitleGenerator({
      store,
      apiKey: "key",
      fetcher: (async () => {
        fetched = true;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Robot Title" } }],
          })
        );
      }) as never,
      now: () => new Date("2026-06-26T17:30:00Z"), // 21:00 Tehran, 20:00 slot open
    });

    await generator?.maybeGenerate({ userId: 1, todaySeconds: 3600 });
    expect(fetched).toBe(false);
    expect(sets).toHaveLength(0);
  });

  it("regenerates over a custom title when forced", async () => {
    const { store, sets } = makeStore({
      title: "My Own Title",
      signature: null,
      generatedAt: new Date("2026-06-25T09:30:00Z"),
      custom: true,
    });
    const generator = createHonorTitleGenerator({
      store,
      apiKey: "key",
      fetcher: (async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Robot Title" } }],
          })
        )) as never,
      now: () => new Date("2026-06-26T17:30:00Z"),
    });

    await generator?.maybeGenerate({
      userId: 1,
      todaySeconds: 3600,
      force: true,
    });
    expect(sets).toHaveLength(1);
  });
});
