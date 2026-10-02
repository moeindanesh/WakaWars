import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSpotifySharing } from "../../wakawars/src/spotify.js";

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe.skipIf(process.platform !== "darwin")(
  "desktop Spotify consent",
  () => {
    it("does not inspect Spotify before opt-in and clears sharing on opt-out/account switch", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "wakawars-spotify-test-"));
      dirs.push(dir);
      const settings = path.join(dir, "prefs.json");
      const song = {
        title: "Song",
        artist: "Artist",
        album: "Album",
        trackId: "a".repeat(22),
      };
      const readSong = vi.fn().mockResolvedValue(song);
      const published: Array<{ token: string; track: unknown }> = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, options: RequestInit) => {
          const token = (options.headers as Record<string, string>)[
            "x-wakawars-session"
          ];
          if (url.endsWith("/config"))
            return Response.json({
              wakawarsUsername: token === "alice-session" ? "alice" : "bob",
            });
          published.push({
            token,
            track: JSON.parse(options.body as string).track,
          });
          return Response.json({ ok: true });
        }),
      );
      const sharing = createSpotifySharing(
        "https://test.invalid",
        settings,
        readSong,
      );
      try {
        expect((await sharing.configure("alice-session")).enabled).toBe(false);
        expect(readSong).not.toHaveBeenCalled();
        await sharing.setEnabled(true);
        await vi.waitFor(() =>
          expect(sharing.getState().status).toBe("sharing"),
        );
        expect(published.at(-1)).toEqual({
          token: "alice-session",
          track: song,
        });
        expect(await readFile(settings, "utf8")).not.toContain("session");
        await sharing.setEnabled(false);
        expect(sharing.getState().enabled).toBe(false);
        expect(published.at(-1)?.track).toBeNull();
        await sharing.setEnabled(true);
        await vi.waitFor(() =>
          expect(sharing.getState().status).toBe("sharing"),
        );
        await sharing.configure("bob-session");
        expect(sharing.getState().enabled).toBe(false);
        expect(published.at(-1)).toEqual({
          token: "alice-session",
          track: null,
        });
      } finally {
        sharing.stop();
      }
    });
    it("cannot publish an in-flight song after consent is withdrawn", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "wakawars-spotify-test-"));
      dirs.push(dir);
      let resolveSong!: (value: {
        title: string;
        artist: string;
        album: string;
        trackId: string;
      }) => void;
      const readSong = () =>
        new Promise<{
          title: string;
          artist: string;
          album: string;
          trackId: string;
        }>((resolve) => {
          resolveSong = resolve;
        });
      const tracks: unknown[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, options: RequestInit) => {
          if (url.endsWith("/config"))
            return Response.json({ wakawarsUsername: "alice" });
          tracks.push(JSON.parse(options.body as string).track);
          return Response.json({ ok: true });
        }),
      );
      const sharing = createSpotifySharing(
        "https://test.invalid",
        path.join(dir, "prefs.json"),
        readSong,
      );
      try {
        await sharing.configure("session");
        await sharing.setEnabled(true);
        await sharing.setEnabled(false);
        resolveSong({
          title: "Song",
          artist: "Artist",
          album: "Album",
          trackId: "a".repeat(22),
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(tracks.every((track) => track === null)).toBe(true);
        expect(sharing.getState().status).toBe("off");
      } finally {
        sharing.stop();
      }
    });
  },
);
