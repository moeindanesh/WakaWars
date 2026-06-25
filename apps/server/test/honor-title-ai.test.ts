import { describe, expect, it } from "vitest";
import {
  createHonorTitleGenerator,
  __testing,
} from "../src/honor-title-ai.js";

const { buildSignature, sanitizeTitle } = __testing;

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

describe("createHonorTitleGenerator", () => {
  it("returns null when no API key is configured (deterministic fallback stays)", () => {
    const generator = createHonorTitleGenerator({
      store: {} as never,
      apiKey: "",
    });
    expect(generator).toBeNull();
  });
});
