# WakaWars Changes — Implementation Plan

Plan for 8 changes, scoped against the codebase and the decisions captured in
[CONTEXT.md](../CONTEXT.md) and [ADR-0001](./adr/0001-ai-generated-honor-titles.md).

Key coupling: the "user badge" under each username is the **Honor Title**, computed
from achievement grants. So #1 (remove achievements UI) and #5 (AI badges) share the
same data; the achievement **write path** stays alive while its UI is removed.

---

## 1. Remove the Achievements UI (keep DB + award path)

**Remove from `apps/wakawars-web/src/App.tsx`:**
- Header trophy icon `AchievementHeaderIcon` (~1965–1976) and its `openAchievementsPage` handler.
- Achievements page/panel (~2210–2288) and modal backdrop wiring (~3010–3029).
- `UserAchievementsModal` (~3153–3224) + the per-row hover fetch (`fetchUserAchievements`, `handleRowSelect`).
- State: `achievementCatalog*`, `userAchievements`, `hoveredUsername`; the `loadAchievementCatalog` call; `/achievements` + `/achievements/:username` client calls.
- `apps/wakawars-web/src/achievements.ts` + `achievements.test.ts` if only the UI used them (verify before deleting).
- CSS: `.achievement-*` blocks in `styles.css`.

**Keep untouched:** `awardDailyAchievements` (sync loop), `awardWeeklyAchievements`
(weekly cache), `grantAchievement`, all `ww_user_achievement` data, and the
`/achievements*` server endpoints (dormant). They feed the Honor Title signal (#5).

---

## 2. Remove Skins / Coins / Store from UI — freeze the economy backend

**Remove from `App.tsx`:** shop bag icon `ShopHeaderIcon` (~1952–1963), shop panel
(~2289–2415), coin pill in rows (~2868–2871), wallet/shop state + `/wallet`, `/shop/*`
client calls, and per-skin row styling usage. CSS: `.shop-*`, `.coin-*`,
`.shop-card[data-skin=...]` blocks.

**Backend — freeze (keep tables + endpoints dormant):**
- In `wakatime-sync.ts`, stop calling `settleDailyRankRewards` (remove the call at line ~339). **Keep everything else in the sync**, including the 23:59 Tehran `bypassCache` fetch (Finding E — History depends on it).
- Stop attaching `coinBalance` / `equippedSkinId` to daily & weekly leaderboard payloads (`app.ts` daily builder ~222/242/253, weekly ~1256/1268/1280). Drop the now-unused fields from rows.
- Leave `/wallet`, `/shop/*` endpoints and all economy tables in place (preserved, re-enable-able).

This also dissolves sync **Finding C** (the every-2-min O(N) settlement recompute).

---

## 3. Move Leave/Join Competition to the header (compact labeled pill)

- Remove the `competition-toggle` button from `.league-actions` (~2895–2905).
- Render a compact labeled pill ("Leave" / "Join") in `.header-meta`, reusing
  `handleCompetitionToggle` + `/competition`. Restyle from `.competition-toggle` to a
  header-sized pill; keep the optimistic rollback logic intact.
- Header becomes: `[refresh] [history] [settings]` icons + the Leave/Join pill
  (shop + trophy slots freed by #1/#2; history added by #6).

---

## 4. Today / Week tabs full-width

- With the competition pill gone (#3), `.league-actions` holds only `.tab-group`.
- Make `.tab-group` span the row and each `.tab-button` `flex: 1` (50/50). Update
  `.tab-group` / `.tab-button` in `styles.css`. Purely CSS + small JSX cleanup.

---

## 5. AI-generated Honor Titles (OpenRouter) — see ADR-0001

**Form:** creative text title (no images). **Signal:** hybrid (achievement profile +
raw stats). **Cadence:** daily, in background sync, regenerate only on signal change,
DB-cached, deterministic fallback.

**Server:**
- New `apps/server/src/honor-title-ai.ts`: OpenRouter client (`OPENROUTER_API_KEY`,
  `OPENROUTER_MODEL` default cheap). Input → prompt → short title (length-capped, sanitized).
- DB: add `ai_honor_title`, `ai_honor_title_signature` (input hash), `ai_honor_title_generated_at`
  to `ww_user` (new Prisma migration). Keep tables additive.
- In the daily sync (after stats/achievements for a user): build the hybrid signal,
  hash it; if changed since `ai_honor_title_signature`, call OpenRouter, store title +
  signature + timestamp. On failure, leave prior value (or null).
- Serving: `resolveHonorTitles` returns `ai_honor_title` when present, else the existing
  deterministic `resolveHonorTitlesByUserId` result. No AI call in the request path.
- Keep deterministic resolver as the fallback (do not delete `honor-titles.ts`).

**Renderer:** none — already renders `entry.honorTitle`.

**Risks/mitigations:** latency/cost off hot path (daily cache + hash dedup); availability
via fallback; key server-side only.

---

## 6. Previous-days leaderboard — dedicated History section

**Server:** generalize the per-day board. Add `GET /stats/day?offset=-N` (or `/stats/day/:offset`)
returning a full `LeaderboardResponse` via the existing `buildDailyLeaderboard(config, offset)`.
Optionally a lightweight `GET /stats/history/days` listing the last 14 available dates
(date + small preview) for the picker. Bound to ~14 days (matches log retention; daily
stats are persisted so data exists).

**Renderer:** new History view reached from a new header **history/calendar icon** (like
Settings). Lists recent days; selecting one lazy-loads that day's **full ranked board**
(same row component as Today). Remove the buried podium-only history from Settings
(~2707–2752) or repoint it here.

**Why lazy per-day:** avoids shipping a 14-day full-board payload at once.

---

## 7. Provider-log growth — retention + reduced writes

**Cut write volume (`wakatime-sync.ts`):** only create a provider log on **failure /
anomaly** (network error, `!ok`, non-2xx, error message). Stop logging successful/cached
`status_bar/today` responses. Removes the dominant row + payload source.

**Retention job:** add a daily cleanup deleting `ww_provider_log` older than
`PROVIDER_LOG_RETENTION_DAYS` (default 14). New repository method
`deleteProviderLogsOlderThan(date)`; schedule it next to the existing sync/weekly loops
in `app.ts` (e.g. a daily timer, run once on boot). Index on `fetched_at`/`created_at`
for the delete if needed.

---

## 8. WakaTime sync audit — fixes + documentation

**Fix (this round):**
- **A — Weekly board restart-safety:** in `GET /stats/weekly`, when `weeklyCache.getStats`
  misses a user, fall back to persisted `ww_weekly_stat` (new `getWeeklyStats` read).
  Mirrors the daily board, which already serves persisted rows.
- **B — Decouple cache TTL from interval:** make the WakaTime client TTL `< ` the 2-min
  sync interval (or have the periodic daily loop pass `bypassCache`) so cycles reliably
  persist fresh stats. Configurable.

**Documented, not changed (low risk):**
- **D** — timezone→UTC fallback can misbucket near midnight only when WakaTime omits
  `range.date` (those payloads carry 0s).
- DST robustness of `resolveNextDailyRunAt` (Tehran has no DST today).
- Scalability: sync time ≈ `ceil(users/9)` s; the `running` guard self-throttles.

**Verified safe (no change):** coin settlement is transactional + `@@unique(user_id,date_key)`
→ no double-credit; achievement re-award is an idempotent upsert; daily board is
restart-safe (reads persisted `ww_daily_stat`).

---

## Cross-cutting / sequencing

1. **Server first:** #5 migration + AI module, #2 freeze, #6 endpoint, #7 retention, #8 A/B.
2. **Renderer:** #1, #2, #3, #4, #6 view — share `App.tsx`/`styles.css`, do together.
3. **Tests:** keep `honor-titles` deterministic tests (fallback still used); update/remove
   renderer achievement tests; add tests for the AI signature-dedup, the day endpoint, and
   the weekly DB fallback.
4. **Docs:** README mentions achievements/economy/skins — update after UI removal.

## Open defaults (adjustable)
- History depth: **14 days**. History entry point: **new header icon**.
- Provider-log retention: **14 days**, log **failures only**.
- OpenRouter model: cheap default, `OPENROUTER_MODEL` overridable.
