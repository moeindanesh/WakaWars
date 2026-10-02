import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  Code2,
  Cpu,
  Flame,
  Hand,
  Leaf,
  Heart,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  X,
  Check,
} from "lucide-react";
import {
  formatDuration,
  type ActivityDetails,
  type ActivityBreakdown,
  type LeaderboardEntry,
  type NowPlaying,
  type BoostKind,
} from "@molty/shared";
import type { ApiRequest } from "../hooks/useSocial";
import {
  ActivitySkeleton,
  AnimatedTime,
  Avatar,
  EmptyActivity,
  formatCount,
  Meter,
  Song,
  spring,
} from "./ActivityUI";

import { TravelingAvatar } from "./ProfileTransition";

const boosts = [
  { kind: "applause", label: "Good job", Icon: Hand, emoji: "👏" },
  { kind: "fire", label: "On fire", Icon: Flame, emoji: "🔥" },
  { kind: "keep_going", label: "Keep going", Icon: Heart, emoji: "💪" },
  { kind: "break", label: "Take a break", Icon: Leaf, emoji: "🌱" },
] as const;

function Breakdown({
  title,
  items,
}: {
  title: string;
  items: ActivityBreakdown[];
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="detail-card breakdown-card">
      <div className="section-heading">
        <h3>{title}</h3>
        <span>{items.length} reported</span>
      </div>
      {items.length ? (
        (expanded ? items : items.slice(0, 4)).map((item, index) => (
          <div className="breakdown-item" key={item.name}>
            <div>
              <span>{item.name}</span>
              <span>
                {formatDuration(item.totalSeconds)}{" "}
                <small>{Math.round(item.percent)}%</small>
              </span>
            </div>
            <Meter percent={item.percent} delay={index * 0.035} />
          </div>
        ))
      ) : (
        <p className="muted">
          No {title.toLowerCase()} reported for this period.
        </p>
      )}
      {items.length > 4 && (
        <button
          className="text-button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {expanded ? "Show less" : `Show all ${items.length}`}{" "}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      )}
    </section>
  );
}

export function MemberProfile({
  entry,
  isSelf,
  request,
  onBack,
  track,
  initialPeriod,
  onSaveHonorTitle,
}: {
  entry: LeaderboardEntry;
  isSelf: boolean;
  request: ApiRequest;
  onBack: () => void;
  track?: NowPlaying;
  initialPeriod: "today" | "week";
  onSaveHonorTitle: (title: string) => Promise<void>;
}) {
  const [period, setPeriod] = useState(initialPeriod);
  const [details, setDetails] = useState<ActivityDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [boostState, setBoostState] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [boostOpen, setBoostOpen] = useState(false);
  const [title, setTitle] = useState(entry.honorTitle ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const back = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    back.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setDetails(null);
    setError(null);
    request<ActivityDetails>(
      `/users/${encodeURIComponent(entry.username)}/activity?period=${period}`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (!controller.signal.aborted) setDetails(data);
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(
            err instanceof Error ? err.message : "Could not load activity",
          );
      });
    return () => controller.abort();
  }, [entry.username, period, reload, request]);
  const sendBoost = async (kind: BoostKind) => {
    if (sending || sent) return;
    setSending(true);
    setBoostState(null);
    try {
      await request(`/users/${encodeURIComponent(entry.username)}/boost`, {
        method: "POST",
        body: JSON.stringify({ kind }),
      });
      setSent(true);
      setBoostState("A little encouragement, delivered.");
      setBoostOpen(false);
    } catch (err) {
      setBoostState(
        err instanceof Error ? err.message : "Could not send. Try again.",
      );
    } finally {
      setSending(false);
    }
  };
  const saveTitle = async () => {
    setSaving(true);
    try {
      await onSaveHonorTitle(title);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save title");
    } finally {
      setSaving(false);
    }
  };
  const reveal = {
    arrive: { opacity: 0, y: reduce ? 0 : 18 },
    open: { opacity: 1, y: 0, transition: { ...spring, delay: reduce ? 0 : 0.12 } },
    leave: { opacity: 0, y: reduce ? 0 : 8, transition: { duration: reduce ? 0.08 : 0.15 } },
  };
  const maxSeconds = Math.max(
    1,
    ...(details?.days.map((day) => day.totalSeconds) ?? []),
  );
  return (
    <motion.section
      className="member-profile"
      initial="arrive"
      animate="open"
      exit="leave"
      variants={{ arrive: {}, open: { transition: { staggerChildren: reduce ? 0 : 0.045 } }, leave: {} }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (boostOpen) {
            setBoostOpen(false);
            event.stopPropagation();
          } else if (editing) {
            setEditing(false);
            setTitle(entry.honorTitle ?? "");
          } else onBack();
        }
      }}
    >
      <motion.div className="profile-toolbar" variants={reveal}>
        <button className="back-button" ref={back} onClick={onBack}>
          <ArrowLeft size={15} /> Friends
        </button>
        <select
          className="period-select"
          aria-label="Profile period"
          value={period}
          onChange={(event) =>
            setPeriod(event.target.value as "today" | "week")
          }
        >
          <option value="today">Today</option>
          <option value="week">Week</option>
        </select>
      </motion.div>
      <div className="profile-identity">
        <TravelingAvatar><Avatar
          username={entry.username}
          large
          photoUrl={details?.profile?.photoUrl}
        /></TravelingAvatar>
        <motion.h2 variants={reveal}>
          {details?.profile?.displayName || entry.username}
          {isSelf && <span className="you-pill">You</span>}
        </motion.h2>
        <motion.div className="profile-caption" variants={reveal}>
        {editing ? (
          <form
            className="title-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveTitle();
            }}
          >
            <label className="sr-only" htmlFor="profile-title">
              Your title
            </label>
            <input
              id="profile-title"
              autoFocus
              maxLength={80}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setTitle(entry.honorTitle ?? "");
              }}
            >
              Cancel
            </button>
          </form>
        ) : isSelf ? (
          <button
            className="profile-honor editable"
            onClick={() => setEditing(true)}
            title="Edit your title"
          >
            {title || "Add a little about yourself"}
          </button>
        ) : (
          <p className="profile-honor">
            {details?.profile?.bio ||
              entry.honorTitle ||
              "Building, one day at a time."}
          </p>
        )}
        <span className="profile-period">
          {period === "week" ? "Last 7 days" : "Today"} · WakaTime activity
        </span>
        </motion.div>
      </div>
      <motion.div className="profile-details" variants={reveal}>
      {track && <Song track={track} />}
      {error ? (
        <div className="inline-notice" role="alert">
          <p>{error}</p>
          <button
            className="text-button"
            onClick={() => setReload((n) => n + 1)}
          >
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      ) : !details ? (
        <ActivitySkeleton />
      ) : details.status !== "ok" ? (
        <EmptyActivity
          title={
            details.status === "private"
              ? "Activity is private"
              : "Activity is unavailable"
          }
        >
          WakaTime hasn’t shared details for this account. The leaderboard
          remains available.
          <button
            className="text-button"
            onClick={() => setReload((n) => n + 1)}
          >
            Try again
          </button>
        </EmptyActivity>
      ) : (
        <>
          {details.stale && (
            <p className="inline-notice" role="status">
              Showing the last successful sync. WakaTime is temporarily
              unavailable.
            </p>
          )}
          <section className="detail-card chart-card">
            <div className="stat-pair">
              <div>
                <span className="stat-label">
                  <Code2 size={14} /> Active time
                </span>
                <strong>
                  <AnimatedTime seconds={details.totalSeconds} />
                </strong>
              </div>
              <div>
                <span className="stat-label">
                  <Cpu size={14} /> AI coding
                </span>
                <strong>
                  {details.ai.totalSeconds === null ? (
                    <span className="not-reported">Not reported</span>
                  ) : (
                    <AnimatedTime seconds={details.ai.totalSeconds} />
                  )}
                </strong>
              </div>
            </div>
            {details.days.length > 0 ? (
              <div
                className="activity-chart"
                role="img"
                aria-label={details.days
                  .map(
                    (day) =>
                      `${day.date}: ${formatDuration(day.totalSeconds)}${day.aiSeconds === null ? "" : `; AI coding ${formatDuration(day.aiSeconds)}`}`,
                  )
                  .join(". ")}
              >
                {details.days.map((day, index) => (
                  <div
                    className="chart-column"
                    key={day.date}
                    title={`${day.date}: ${formatDuration(day.totalSeconds)}`}
                  >
                    <div className="chart-bar-space">
                      <motion.div
                        className={`chart-bar ${index === details.days.length - 1 ? "current" : ""}`}
                        style={{
                          height: `${Math.max(2, (day.totalSeconds / maxSeconds) * 100)}%`,
                        }}
                        initial={{ scaleY: reduce ? 1 : 0 }}
                        animate={{ scaleY: 1 }}
                        transition={{
                          ...spring,
                          delay: reduce ? 0 : index * 0.045,
                        }}
                      >
                        {day.aiSeconds !== null && day.totalSeconds > 0 && (
                          <span
                            className="chart-bar-ai"
                            style={{
                              height: `${Math.min(100, (day.aiSeconds / day.totalSeconds) * 100)}%`,
                            }}
                          />
                        )}
                      </motion.div>
                    </div>
                    <span>
                      {new Date(`${day.date}T12:00:00Z`).toLocaleDateString(
                        "en",
                        { weekday: "narrow", timeZone: "UTC" },
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No activity recorded yet.</p>
            )}
            <div className="chart-legend">
              <span>
                <i />
                Other activity
              </span>
              <span>
                <i />
                AI coding, when reported
              </span>
            </div>
            <div className="chart-caption">
              <span>
                {period === "week" ? "Daily activity" : "Today’s activity"}
              </span>
              <span>
                {formatDuration(details.dailyAverageSeconds)} / reported day
              </span>
            </div>
          </section>
          <Breakdown title="Editors & tools" items={details.editors} />
          <section className="detail-card ai-card">
            <div className="section-heading">
              <h3>
                <Cpu size={15} /> AI activity
              </h3>
              <span>Reported by plugins</span>
            </div>
            {details.ai.models.length ||
            details.ai.inputTokens !== null ||
            details.ai.outputTokens !== null ||
            details.ai.additions !== null ||
            details.ai.deletions !== null ||
            details.ai.sessions !== null ? (
              <>
                <div className="ai-metrics">
                  {(
                    [
                      ["Lines added", details.ai.additions],
                      ["Lines removed", details.ai.deletions],
                      ["Input tokens", details.ai.inputTokens],
                      ["Output tokens", details.ai.outputTokens],
                      ["Sessions", details.ai.sessions],
                    ] as const
                  )
                    .filter(([, value]) => value !== null)
                    .map(([label, value]) => (
                      <div key={label}>
                        <strong>{formatCount(value!)}</strong>
                        <span>{label}</span>
                      </div>
                    ))}
                </div>
                {details.ai.models.map((model) => (
                  <div className="model-row" key={model.name}>
                    <span>
                      <Cpu size={14} />
                      {model.name}
                    </span>
                    <span>{formatCount(model.linesChanged)} line changes</span>
                  </div>
                ))}
              </>
            ) : (
              <p className="muted">
                No AI metrics reported. A compatible WakaTime plugin must record
                model activity. Editor time alone doesn’t measure agent work.
              </p>
            )}
          </section>
          <Breakdown title="Languages" items={details.languages} />
          <Breakdown title="Activities" items={details.categories} />
          <p className="sync-footnote">
            Synced{" "}
            {new Date(details.updatedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            · Details cached for 5 minutes
          </p>
        </>
      )}
      </motion.div>
      {!isSelf && entry.status !== "private" && (
        <motion.div className="boost-dock" variants={reveal} style={{ x: "-50%" }}>
          <div className="boost-dock-bar">
            <button
              className="boost-toggle"
              aria-label={
                boostOpen ? "Close encouragement" : "Send encouragement"
              }
              aria-expanded={boostOpen}
              aria-controls="encouragement-menu"
              onClick={() => setBoostOpen(!boostOpen)}
            >
              {sent ? (
                <Check size={20} />
              ) : boostOpen ? (
                <X size={20} />
              ) : (
                <MoreHorizontal size={22} />
              )}
            </button>
            <span role="status">
              {boostState || "A little boost, once every 30 minutes."}
            </span>
          </div>
          <AnimatePresence>
            {boostOpen && (
              <motion.div
                id="encouragement-menu"
                className="boost-flyout"
                initial={{
                  opacity: 0,
                  y: reduce ? 0 : 12,
                  scale: reduce ? 1 : 0.95,
                }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: reduce ? 0 : 8 }}
                transition={spring}
              >
                {boosts.map(({ kind, label, emoji }, index) => (
                  <motion.button
                    key={kind}
                    onClick={() => void sendBoost(kind)}
                    disabled={sending || sent}
                    initial={{ opacity: 0, x: reduce ? 0 : 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ ...spring, delay: reduce ? 0 : index * 0.04 }}
                    whileHover={reduce ? {} : { x: -3 }}
                    whileTap={reduce ? {} : { scale: 0.96 }}
                    aria-label={`Send ${label} to ${entry.username}`}
                  >
                    <span>{label}</span>
                    <span className={`boost-bubble boost-${kind}`}>
                      <span aria-hidden="true">{emoji}</span>
                    </span>
                  </motion.button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </motion.section>
  );
}
