# WakaWars

![WakaWars Logo](./logo.png)

![WakaWars](./wakawars.png)

WakaWars is a local-first coding leaderboard for friends, built as a macOS menu bar app with a shared backend.

## What It Does

- Tracks daily and weekly coding time using WakaTime.
- Ranks you against friends (and group members) with competitive leaderboard views.
- Supports private/friends/public visibility controls.
- Shows an AI-generated honor title next to each player (OpenRouter), with a deterministic fallback.
- Lets you browse previous days' full leaderboards in a History view.
- Runs as a tray-first app on macOS with auto-update support and a native glass popover.
- Opens member profiles with daily charts, languages, editors and AI metrics actually reported by WakaTime.
- Shares the current Spotify desktop song with mutual friends/squad peers, after explicit opt-in on each Mac.
- Sends lightweight encouragement with a server-enforced 30-minute cooldown.

See [refactor notes](docs/refactor-notes.md) for setup, privacy, API details and validation limits.

> Achievements, coins, and the skin shop remain in the database and on the server
> but are no longer surfaced in the UI. Achievements are still awarded during sync
> because they feed the honor-title signal.

## Monorepo Layout

```text
apps/
  server/         Elysia API + Prisma + PostgreSQL
  wakawars/       Electron menu bar shell (main/preload)
  wakawars-web/   React + Vite renderer UI
packages/
  shared/         Shared types + leaderboard helpers
```

## Stack

- Runtime/package manager: Bun workspaces
- API: Elysia (`/wakawars/v0`)
- DB: PostgreSQL + Prisma
- Desktop: Electron + `electron-builder` + `electron-updater`
- UI: React + Vite
- AI: OpenRouter (honor titles), generated in the background sync and cached in the database

## Local Development

### 1) Install dependencies

```bash
bun install
```

### 2) Configure server env

```bash
cp apps/server/.env.example apps/server/.env
```

`apps/server/.env` needs a PostgreSQL `DATABASE_URL`. Optional:

- `OPENROUTER_API_KEY` enables AI honor titles (unset → deterministic fallback).
- `OPENROUTER_MODEL` overrides the default cheap model.
- `PROVIDER_LOG_RETENTION_DAYS` (default `14`) bounds the `ww_provider_log` table; a
  daily job deletes older rows, and only failed/anomalous provider responses are logged.

### 3) Run migrations

```bash
bun run --filter @molty/server prisma:migrate
```

### 4) Seed shop skins (recommended)

```bash
bun run --filter @molty/server seed:skins
```

### 5) Start everything

```bash
bun run dev
```

This starts:

- API server at `http://localhost:3000`
- Renderer dev server at `http://localhost:5173`
- Electron menu bar app connected to those services

## Core API

Base path: `/wakawars/v0`

### Session and config

- `GET /session`
- `POST /session/login`
- `POST /session/logout`
- `POST /password`
- `POST /username`
- `GET /config`
- `POST /config`
- `POST /visibility`
- `POST /competition`

### Social and groups

- `POST /friends`
- `DELETE /friends/:username`
- `GET /users/search`
- `GET /users/:username/activity?period=today|week`
- `GET /social`
- `POST /music`
- `POST /users/:username/boost`
- `POST /groups`
- `DELETE /groups/:groupId`
- `POST /groups/:groupId/members`
- `DELETE /groups/:groupId/members/:username`

### Stats and achievements

- `GET /stats/today`
- `GET /stats/yesterday`
- `GET /stats/history` (last 14 days, podium preview)
- `GET /stats/day?offset=-N` (full board for a past day, History view)
- `POST /stats/refresh`
- `GET /stats/weekly`
- `GET /achievements` (server-side; not shown in the UI)
- `GET /achievements/:username` (server-side; not shown in the UI)

### Economy

- `GET /wallet`
- `GET /shop/skins`
- `POST /shop/skins/:skinId/purchase`
- `POST /shop/skins/:skinId/equip`

Session auth uses `x-wakawars-session`.

## WakaTime Integration

- Daily source: `GET https://wakatime.com/api/v1/users/current/status_bar/today`
- Weekly source: `GET https://wakatime.com/api/v1/users/current/stats/{range}`
- Auth: Basic auth with the WakaTime API key
- Server caches provider responses in memory to reduce request volume
- Background sync intervals:
  - Daily sync loop: every 2 minutes
  - Weekly cache loop: every 30 minutes
- Renderer auto-refresh: every 15 minutes

## Tests and Build

Run workspace tests:

```bash
bun run test
```

Run renderer tests:

```bash
bun run --filter @molty/wakawars-web test
```

Build all packages:

```bash
bun run build
```

## Desktop Packaging (macOS)

Local package:

```bash
bun run --filter @molty/wakawars pack
```

Publish build (DMG + ZIP + update metadata):

```bash
bun run --filter @molty/wakawars dist
```

- Auto-update feed: `https://core.molty.cool/updates`
- API base in packaged app: `https://core.molty.cool/wakawars/v0`
- Notarization hook: `apps/wakawars/build/notarize.cjs`

## Production URLs

- API: `https://core.molty.cool/wakawars/v0`
- Web renderer: `https://wakawars.molty.cool`
- Updates feed: `https://core.molty.cool/updates`
