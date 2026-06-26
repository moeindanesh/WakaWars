import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createPrismaRepository } from "../repository.js";
import { createWakaTimeClient } from "../wakatime.js";
import { createHonorTitleGenerator } from "../honor-title-ai.js";
import { DEFAULT_WAKATIME_WEEKLY_RANGE } from "../wakatime-weekly-cache.js";
import {
  DEFAULT_WAKATIME_BATCH_DELAY_MS,
  DEFAULT_WAKATIME_BATCH_SIZE,
  runInBatches,
} from "../wakatime-rate-limit.js";

/**
 * Manually (re)generate AI honor titles for users.
 *
 * Unlike the scheduled sync, this script forces regeneration by default —
 * it bypasses the three-daily-slot guard and the unchanged-signature guard so
 * every targeted user gets a fresh title now. Pass --respect-gates to honor the
 * normal slot/signature logic instead.
 *
 * Usage:
 *   pnpm --filter @molty/server titles:update              # all users, forced
 *   pnpm --filter @molty/server titles:update -- alice bob  # only these usernames/ids
 *   pnpm --filter @molty/server titles:update -- --respect-gates
 *
 * Requires DATABASE_URL and OPENROUTER_API_KEY in the environment.
 */

const log = (...args: unknown[]) => {
  // eslint-disable-next-line no-console
  console.log("[titles:update]", ...args);
};

const parseArgs = (argv: string[]) => {
  const filters = new Set<string>();
  let respectGates = false;

  for (const arg of argv) {
    if (arg === "--respect-gates") {
      respectGates = true;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    filters.add(arg.toLowerCase());
  }

  return { filters, respectGates };
};

const run = async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is required to generate AI honor titles."
    );
  }

  const { filters, respectGates } = parseArgs(process.argv.slice(2));
  const weeklyRangeKey =
    process.env.WAKAWARS_WEEKLY_RANGE_KEY ?? DEFAULT_WAKATIME_WEEKLY_RANGE;

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  try {
    const store = createPrismaRepository(prisma);
    const wakatime = createWakaTimeClient({ fetcher: globalThis.fetch });
    const generator = createHonorTitleGenerator({
      store,
      apiKey,
      model: process.env.OPENROUTER_MODEL,
      weeklyRangeKey,
    });

    if (!generator) {
      throw new Error("Honor title generator could not be created.");
    }

    const allUsers = await store.listUsers();
    const targets = allUsers
      .map((user) => ({ ...user, apiKey: user.apiKey.trim() }))
      .filter((user) => Boolean(user.apiKey))
      .filter(
        (user) =>
          filters.size === 0 ||
          filters.has(String(user.id)) ||
          filters.has(user.wakawarsUsername.toLowerCase())
      );

    log(
      `targeting ${targets.length} user(s)`,
      respectGates ? "(respecting slot/signature gates)" : "(forced regeneration)"
    );

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    await runInBatches(
      targets,
      async (user) => {
        const before = await store.getAiHonorTitleState(user.id);
        const daily = await wakatime.getStatusBarToday("current", user.apiKey, {
          bypassCache: true,
        });

        await generator.maybeGenerate({
          userId: user.id,
          todaySeconds: daily.totalSeconds,
          todayPayload: daily.payload,
          force: !respectGates,
        });

        const after = await store.getAiHonorTitleState(user.id);
        if (after?.title && after.title !== before?.title) {
          updated += 1;
          log(`${user.wakawarsUsername}: "${after.title}"`);
        } else {
          skipped += 1;
        }
      },
      {
        batchSize: DEFAULT_WAKATIME_BATCH_SIZE,
        delayMs: DEFAULT_WAKATIME_BATCH_DELAY_MS,
        onError: (error) => {
          failed += 1;
          // eslint-disable-next-line no-console
          console.error("[titles:update] user failed", error);
        },
      }
    );

    log("done", { targeted: targets.length, updated, skipped, failed });
  } finally {
    await prisma.$disconnect();
  }
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("[titles:update] failed", error);
  process.exit(1);
});
