# WakaWars social activity refactor

The visual reference is [Firstlight’s menu-bar demo](https://x.com/korablev/status/2102144168282017813). The implementation uses a smoked-glass macOS popover, centered member profile, rounded period control, soft-green activity chart and floating encouragement menu. Desktop rendering uses Electron `vibrancy: popover`; web rendering uses translucent surfaces without native desktop blur. Motion is implemented with Motion for React and respects reduced motion and window visibility. Public WakaTime profile pictures are optional; initials are the fallback.

## Activity

`GET /wakawars/v0/users/:username/activity?period=today|week` reads WakaTime summaries using the target user's server-held API key, after checking existing visibility rules. Today and last-seven-days use the target's WakaTime timezone. A five-minute in-memory cache, in-flight request deduplication, timeouts and rate-limit backoff keep profile browsing inexpensive. Temporary failures can show a marked stale result for up to 30 minutes. Auth errors clear cached display data. Cache is bounded and lost on restart.

Returned fields are explicitly allowlisted: daily totals, languages, editors, categories, AI coding time, AI model line changes, additions/deletions, tokens and sessions. Public profile photo, display name and bio are cached for 30 minutes. Projects, paths, machine names, email addresses, prompts, keys and raw provider responses are not returned. A missing AI metric stays null; using Cursor does not prove AI-agent time. AI Coding category time is the only source of the AI duration chart. Plugin support and account data availability determine which metrics exist.

References checked October 2, 2026: [WakaTime API](https://wakatime.com/developers), especially Summaries and Users.

## Spotify on macOS

Chosen approach: local Spotify desktop metadata through a fixed, read-only JXA script in Electron’s main process. No Spotify OAuth, client ID, secret, or Premium account is required by this implementation. This does not read songs playing exclusively on a phone or in Spotify’s web player. Local tracks without a Spotify track ID are not shared.

1. Install the new desktop build and sign into WakaWars.
2. Open Settings → Shared soundtrack → Share my Spotify song.
3. Allow WakaWars to communicate with Spotify when macOS asks. If denied, allow it in System Settings → Privacy & Security → Automation and use Retry Spotify.
4. Play a song in the Spotify desktop app. WakaWars reads it every 25 seconds even while the tray window is hidden. It does not launch Spotify.

Only title, artist, album and Spotify track ID are published. Access is limited to mutual friends and squad peers who also pass stats visibility. Sharing defaults off and preference is stored per WakaWars username on that Mac, with no extra auth token written to disk. Pausing/closing Spotify clears the song at the next poll; disabling clears it immediately where connectivity permits. Disconnect, crash and sleep are bounded by a 90-second server expiry; receiver polling adds up to 20 seconds of UI latency. State is ephemeral and no listening history is persisted. Several concurrent devices for one account use last-writer-wins presence.

The packaged app includes NSAppleEventsUsageDescription and Apple Events entitlement. Native Spotify automation and the permission prompt still require a signed macOS build verification with a real Spotify installation. Tests inject the metadata reader and do not exercise macOS permissions.

The alternative Spotify Web API currently limits development-mode apps to five allowlisted users and requires a Premium app owner: [Spotify quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes). It was not chosen.

## Encouragement

`POST /users/:username/boost` supports applause, fire, keep_going and break. Mutual friends and squad peers can send one per recipient per 30 minutes. The server enforces this across reaction types. `GET /social` returns permitted current songs and recent encouragement for the signed-in user. No OS push notification is generated. The foreground renderer polls every 20 seconds.

Presence and encouragement currently live in one server process. Run one API instance, or move the store to shared Redis before horizontal scaling. Restarts clear the cooldown and recent encouragement. No database migration is needed.

## Validation and rollout

- Shared/server tests include activity parsing, missing AI fields, provider failure, caching, privacy, music expiry, reaction cooldown and desktop opt-in/opt-out races.
- `bun run build` now also type-checks the renderer, then builds shared, server, web and Electron.
- Browser visual checks use isolated synthetic data, not production accounts. Screenshots under `output/playwright` are local QA artifacts and ignored by Git.
- Deploy the API and web renderer, and release a rebuilt Electron app for native blur and Spotify support. Existing desktop builds can render the new web UI but cannot expose the new native music bridge.
- Exact native transparency, signed Spotify permission flow and live WakaTime account responses need an end-to-end test on the packaged macOS app. Unit tests and browser screenshots do not establish those results.

## Profile motion and glass follow-up

Profiles now open in a fixed glass layer from the clicked row, with an independent avatar transition and a reversed close. The underlying list stays mounted to retain scroll, ranking context and focus. Background controls are inert while the dialog is open; Tab stays inside, Escape dismisses the reaction menu/title editor first, and closing restores row focus. Reduced motion uses short fades.

The smoke coating is translucent over native macOS vibrancy. A static optical rim and a composited, pointer-following reflection add depth; web preview has its own muted backdrop. This approximates the reference rather than using Apple's Liquid Glass API. Full-window SVG backdrop distortion and animated blur were removed after frame stalls in browser profiling. Navigation now animates the panel clip, avatar transforms and content opacity/translation without repeatedly filtering the entire window. Pointer feedback only transforms the reflection layer and pauses when the window is hidden.

The production browser preview was measured over three open/close cycles with sample data: 93 frames per cycle, no frame over 25 ms, and a roughly 17.7 ms 95th percentile on this machine. These browser measurements do not establish performance on every Mac or packaged native vibrancy.
