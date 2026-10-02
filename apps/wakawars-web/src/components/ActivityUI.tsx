import { useEffect, useRef, useState, type CSSProperties } from "react";
import { animate, motion, useReducedMotion } from "motion/react";
import { AudioLines, ArrowUpRight, Sparkles } from "lucide-react";
import { formatDuration, type NowPlaying } from "@molty/shared";
import { useWindowActivity } from "../hooks/useWindowActivity";

export const spring = { type: "spring" as const, stiffness: 380, damping: 32 };
export const formatCount = (n: number) =>
  new Intl.NumberFormat("en", {
    notation: n >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(n);

export function Avatar({
  username,
  large = false,
  photoUrl,
}: {
  username: string;
  large?: boolean;
  photoUrl?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const hue =
    [...username].reduce((sum, char) => sum + char.charCodeAt(0) * 11, 0) % 360;
  return (
    <span
      className={`person-avatar ${large ? "large" : ""}`}
      style={{ "--avatar-hue": hue } as CSSProperties}
      aria-hidden="true"
    >
      {photoUrl && !failed ? (
        <img
          src={photoUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        username
          .replace(/[^a-z0-9]/gi, "")
          .slice(0, 2)
          .toUpperCase() || "?"
      )}
    </span>
  );
}

export function AnimatedTime({ seconds }: { seconds: number }) {
  const [value, setValue] = useState(seconds);
  const previous = useRef(seconds);
  const reduce = useReducedMotion();
  const visible = useWindowActivity();
  useEffect(() => {
    if (reduce || !visible) {
      previous.current = seconds;
      setValue(seconds);
      return;
    }
    const controls = animate(previous.current, seconds, {
      duration: 0.65,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: setValue,
    });
    previous.current = seconds;
    return () => controls.stop();
  }, [seconds, reduce, visible]);
  return (
    <span className="animated-time" aria-label={formatDuration(seconds)}>
      <span aria-hidden="true">{formatDuration(Math.round(value))}</span>
    </span>
  );
}

export function Song({
  track,
  compact = false,
}: {
  track: NowPlaying;
  compact?: boolean;
}) {
  return (
    <a
      className={`song-card ${compact ? "compact" : ""}`}
      href={`https://open.spotify.com/track/${encodeURIComponent(track.trackId)}`}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${track.title} by ${track.artist} in Spotify`}
    >
      <span className="song-art" aria-hidden="true">
        <AudioLines size={20} />
        <span className="equalizer">
          <i />
          <i />
          <i />
          <i />
        </span>
      </span>
      <span className="song-copy">
        <span className="song-label">Listening on Spotify</span>
        <strong>{track.title}</strong>
        <span>{track.artist}</span>
      </span>
      <ArrowUpRight size={15} aria-hidden="true" />
    </a>
  );
}

export function EmptyActivity({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="activity-empty">
      <Sparkles size={23} aria-hidden="true" />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export function ActivitySkeleton() {
  return (
    <div
      className="activity-skeleton"
      role="status"
      aria-label="Loading activity"
    >
      <div />
      <div />
      <div />
      <span className="sr-only">Loading activity…</span>
    </div>
  );
}

export function Meter({
  percent,
  delay = 0,
}: {
  percent: number;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <span className="meter-track" aria-hidden="true">
      <motion.span
        initial={{ scaleX: reduced ? percent / 100 : 0 }}
        animate={{ scaleX: Math.max(0, Math.min(percent, 100)) / 100 }}
        transition={{ ...spring, delay: reduced ? 0 : delay }}
      />
    </span>
  );
}
