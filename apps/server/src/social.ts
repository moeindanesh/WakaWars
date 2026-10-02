import { randomUUID } from "node:crypto";
import type { BoostKind, NowPlaying } from "@molty/shared";

export const MUSIC_TTL_MS = 90_000;
export const BOOST_COOLDOWN_MS = 30 * 60_000;

// Presence is intentionally ephemeral; stale songs and encouragement disappear
// on restart. Deploy this store behind one API instance (or replace with Redis).
export function createSocialStore(clock = Date.now) {
  const music = new Map<number, { track: NowPlaying; expires: number }>();
  const boosts = new Map<
    string,
    { id: string; fromId: number; toId: number; kind: BoostKind; at: number }
  >();
  const prune = () => {
    for (const [id, entry] of music)
      if (entry.expires <= clock()) music.delete(id);
    for (const [id, entry] of boosts)
      if (entry.at + BOOST_COOLDOWN_MS <= clock()) boosts.delete(id);
  };
  return {
    setMusic(userId: number, track: NowPlaying | null) {
      prune();
      if (track) music.set(userId, { track, expires: clock() + MUSIC_TTL_MS });
      else music.delete(userId);
    },
    getMusic(userId: number) {
      prune();
      return music.get(userId) ?? null;
    },
    sendBoost(fromId: number, toId: number, kind: BoostKind) {
      prune();
      const key = `${fromId}:${toId}`;
      const previous = boosts.get(key);
      if (previous)
        return {
          ok: false as const,
          retryAfter: Math.ceil(
            (previous.at + BOOST_COOLDOWN_MS - clock()) / 1000,
          ),
        };
      boosts.set(key, { id: randomUUID(), fromId, toId, kind, at: clock() });
      return { ok: true as const, retryAfter: BOOST_COOLDOWN_MS / 1000 };
    },
    getBoosts(userId: number) {
      prune();
      return [...boosts.values()]
        .filter((entry) => entry.toId === userId)
        .slice(-20);
    },
  };
}
