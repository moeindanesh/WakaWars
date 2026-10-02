import { useEffect, useState } from "react";
import { Headphones } from "lucide-react";
import type { MusicState } from "../types";
import { Song } from "./ActivityUI";

export function MusicSettings({ sessionId }: { sessionId: string | null }) {
  const [state, setState] = useState<MusicState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      window.molty
        ?.getSpotifyState?.()
        .then((next) => {
          if (alive) setState(next);
        })
        .catch(() => {
          if (alive) setError("Could not read Spotify settings.");
        });
    void read();
    const timer = window.setInterval(read, 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [sessionId]);
  const toggle = async (enabled: boolean) => {
    if (!window.molty?.setSpotifyEnabled) return;
    setBusy(true);
    setError(null);
    try {
      await window.molty.configureSpotify?.(sessionId);
      setState(await window.molty.setSpotifyEnabled(enabled));
    } catch {
      setError("Could not update music sharing. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel music-settings">
      <div className="panel-head">
        <div>
          <p className="eyebrow">
            <Headphones size={13} /> Shared soundtrack
          </p>
          <h2>Music makes good company.</h2>
          <p className="muted">
            Share what’s playing in Spotify on this Mac with mutual friends and
            squad members who can see your activity.
          </p>
        </div>
      </div>
      <div className="settings-row">
        <label htmlFor="spotify-sharing">Share my Spotify song</label>
        <label className="toggle">
          <input
            id="spotify-sharing"
            type="checkbox"
            checked={state?.enabled ?? false}
            disabled={busy || !state?.supported}
            onChange={(event) => void toggle(event.target.checked)}
          />
          <span className="toggle-ui" />
        </label>
      </div>
      {!window.molty?.getSpotifyState || state?.supported === false ? (
        <p className="muted">
          Available in the WakaWars macOS app with Spotify installed.
        </p>
      ) : (
        <p className="muted">
          Optional, and off by default. macOS will ask for permission to read
          Spotify. We share the song, artist, album and Spotify link; paused
          songs disappear. No listening history is stored.
        </p>
      )}
      {state?.track && state.enabled && <Song track={state.track} />}
      {state?.enabled && state.status === "waiting" && (
        <p className="inline-notice" role="status">
          Ready when you are. Play a song in Spotify on this Mac.
        </p>
      )}
      {(error || state?.error) && (
        <div className="inline-notice" role="alert">
          <p>{error || state?.error}</p>
          {state?.enabled && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void toggle(true)}
            >
              Retry Spotify
            </button>
          )}
        </div>
      )}
    </section>
  );
}
