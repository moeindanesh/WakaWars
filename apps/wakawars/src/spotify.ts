import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);
type Track = { title: string; artist: string; album: string; trackId: string };
export type MusicState = {
  supported: boolean;
  enabled: boolean;
  status: "off" | "waiting" | "sharing" | "permission" | "error";
  track: Track | null;
  error: string | null;
};

// Fixed, read-only script. No renderer-supplied strings are evaluated. Checking
// running() first avoids launching Spotify when the user isn't listening.
const SPOTIFY_SCRIPT = `
const spotify = Application('com.spotify.client');
if (!spotify.running() || spotify.playerState() !== 'playing') {
  JSON.stringify(null);
} else {
  const track = spotify.currentTrack();
  JSON.stringify({ title: track.name(), artist: track.artist(), album: track.album(), id: track.id() });
}
`;

export async function readSpotifyTrack(): Promise<Track | null> {
  const { stdout } = await exec(
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", SPOTIFY_SCRIPT],
    { timeout: 10_000, maxBuffer: 64 * 1024 },
  );
  const raw = JSON.parse(stdout.trim()) as {
    title?: unknown;
    artist?: unknown;
    album?: unknown;
    id?: unknown;
  } | null;
  const match =
    typeof raw?.id === "string"
      ? /^spotify:track:([a-zA-Z0-9]{22})$/.exec(raw.id)
      : null;
  const track: Track | null =
    raw && match && typeof raw.title === "string" && raw.title.trim()
      ? {
          title: raw.title.slice(0, 300),
          artist:
            typeof raw.artist === "string" ? raw.artist.slice(0, 300) : "",
          album: typeof raw.album === "string" ? raw.album.slice(0, 300) : "",
          trackId: match[1],
        }
      : null;
  return track;
}

export function createSpotifySharing(
  apiBase: string,
  settingsPath: string,
  readSong = readSpotifyTrack,
) {
  let state: MusicState = {
    supported: process.platform === "darwin",
    enabled: false,
    status: "off",
    track: null,
    error: null,
  };
  let session: string | null = null;
  let username: string | null = null;
  let generation = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;
  let suspended = false;
  let preferences: Record<string, boolean> = {};
  const ready = readFile(settingsPath, "utf8")
    .then((raw) => {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        preferences = Object.fromEntries(
          Object.entries(parsed).filter(
            ([key, value]) => key.length <= 100 && typeof value === "boolean",
          ),
        );
      }
    })
    .catch(() => {});
  const publish = async (token: string, track: Track | null) => {
    const response = await fetch(`${apiBase}/music`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-wakawars-session": token,
      },
      body: JSON.stringify({ track }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
      throw new Error(
        "Could not update music sharing. Check your connection or sign in again.",
      );
  };
  const tick = async () => {
    if (busy || suspended || !session || !state.enabled || !state.supported)
      return;
    busy = true;
    const token = session;
    const revision = generation;
    try {
      const track = await readSong();
      if (revision !== generation) return;
      await publish(token, track);
      // A disable/account switch may happen while fetch is in flight.
      if (revision !== generation) {
        await publish(token, null).catch(() => {});
        return;
      }
      state = {
        ...state,
        status: track ? "sharing" : "waiting",
        track,
        error: null,
      };
    } catch (error) {
      if (revision !== generation) return;
      const message =
        error instanceof Error ? error.message : "Spotify is unavailable";
      const denied = /1743|not authorized|not permitted/i.test(message);
      state = {
        ...state,
        status: denied ? "permission" : "error",
        track: null,
        error: denied
          ? "Allow WakaWars to read Spotify in System Settings → Privacy & Security → Automation, then retry."
          : "Could not read or share Spotify. Make sure Spotify is installed and your connection is available.",
      };
      await publish(token, null).catch(() => {});
      if (denied && timer) {
        clearInterval(timer);
        timer = null;
      }
    } finally {
      busy = false;
    }
  };
  const start = () => {
    if (timer) clearInterval(timer);
    timer =
      state.enabled && session && !suspended
        ? setInterval(() => void tick(), 25_000)
        : null;
    void tick();
  };
  return {
    getState: () => ({ ...state }),
    async configure(token: string | null) {
      await ready;
      if (session === token) return { ...state };
      const previous = session;
      const revision = ++generation;
      session = null;
      username = null;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      state = {
        ...state,
        enabled: false,
        status: "off",
        track: null,
        error: null,
      };
      if (previous) await publish(previous, null).catch(() => {});
      if (!token || !state.supported) return { ...state };
      try {
        const response = await fetch(`${apiBase}/config`, {
          headers: { "x-wakawars-session": token },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error("Sign in to share music.");
        const user = (await response.json()) as { wakawarsUsername?: string };
        if (revision !== generation || !user.wakawarsUsername)
          return { ...state };
        username = user.wakawarsUsername;
        session = token;
        state = {
          ...state,
          enabled: preferences[username] === true,
          status: preferences[username] ? "waiting" : "off",
        };
        start();
      } catch {
        if (revision === generation)
          state = {
            ...state,
            error: "Sign in and check your connection before sharing music.",
          };
      }
      return { ...state };
    },
    async setEnabled(enabled: boolean) {
      await ready;
      if (!username || !session || !state.supported)
        return {
          ...state,
          error: "Sign in to the macOS app to share Spotify.",
        };
      const token = session;
      const revision = ++generation;
      preferences[username] = enabled;
      if (timer) { clearInterval(timer); timer = null; }
      state = {
        ...state,
        enabled,
        track: null,
        error: null,
        status: enabled ? "waiting" : "off",
      };
      if (!enabled) await publish(token, null).catch(() => {});
      await writeFile(settingsPath, JSON.stringify(preferences), {
        encoding: "utf8",
        mode: 0o600,
      });
      if (revision !== generation) return { ...state };
      start();
      return { ...state };
    },
    async suspend() {
      suspended = true;
      ++generation;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (session) await publish(session, null).catch(() => {});
    },
    resume() {
      suspended = false;
      start();
    },
    stop() {
      ++generation;
      if (timer) clearInterval(timer);
      timer = null;
      if (session) void publish(session, null).catch(() => {});
      session = null;
    },
  };
}
