import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronRight, Crown, Headphones, History, Users } from "lucide-react";
import {
  formatDuration,
  type LeaderboardEntry,
  type WeeklyLeaderboardEntry,
  type SocialSnapshot,
} from "@molty/shared";
import type { ApiRequest } from "../hooks/useSocial";
import {
  AnimatedTime,
  Avatar,
  EmptyActivity,
  Meter,
  spring,
} from "./ActivityUI";
import { MemberProfile } from "./MemberProfile";
import { ProfileTransition, type ProfileOrigin } from "./ProfileTransition";

type Entry = LeaderboardEntry | WeeklyLeaderboardEntry;
type Props = {
  entries: Entry[];
  self: Entry | null;
  username: string;
  period: "today" | "weekly";
  onPeriod: (period: "today" | "weekly") => void;
  updatedAt?: string;
  yesterday: LeaderboardEntry[];
  onHistory: () => void;
  request: ApiRequest;
  onSaveHonorTitle: (value: string) => Promise<void>;
  social: SocialSnapshot;
  footer: ReactNode;
  loading: boolean;
  onProfileChange: (open: boolean) => void;
};

export function League({
  entries,
  self,
  username,
  period,
  onPeriod,
  updatedAt,
  yesterday,
  onHistory,
  request,
  onSaveHonorTitle,
  social,
  footer,
  loading,
  onProfileChange,
}: Props) {
  const [selected, setSelected] = useState<Entry | null>(null);
  const [closing, setClosing] = useState(false);
  const [origin, setOrigin] = useState<ProfileOrigin | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const returnFocus = useRef<string | null>(null);
  const reduced = useReducedMotion();
  useEffect(() => () => onProfileChange(false), [onProfileChange]);
  useEffect(() => {
    if (!selected && returnFocus.current) {
      rowButtons.current.get(returnFocus.current)?.focus({ preventScroll: true });
      returnFocus.current = null;
    }
  }, [selected]);
  const select = (entry: Entry, trigger: HTMLElement) => {
    if (selected) return;
    const avatar = trigger.querySelector(".person-avatar")!;
    setOrigin({ row: trigger.getBoundingClientRect(), avatar: avatar.getBoundingClientRect() });
    setClosing(false);
    setSelected(entry);
    onProfileChange(true);
  };
  const close = () => {
    if (closing) return;
    setClosing(true);
  };
  const finishClose = () => {
    returnFocus.current = selected?.username ?? null;
    setSelected(null);
    setClosing(false);
    onProfileChange(false);
  };
  const top = Math.max(1, ...entries.map((entry) => entry.totalSeconds));
  const ranked = entries.filter((entry) => entry.status === "ok");
  const teamSeconds = ranked.reduce(
    (sum, entry) => sum + entry.totalSeconds,
    0,
  );
  const latestBoost = social.boosts.at(-1);
  const trackFor = (name: string) =>
    social.listening.find(
      (item) =>
        item.username === name && Date.parse(item.expiresAt) > Date.now(),
    )?.track;
  const boostLabels = {
    applause: "says good job",
    fire: "thinks you’re on fire",
    keep_going: "is cheering you on",
    break: "sent a gentle break reminder",
  };
  return (
    <>
        <motion.div
          className="friends-view"
          initial={false}
          animate={{
            opacity: selected && !closing ? 0 : 1,
            scale: !reduced && selected && !closing ? 0.96 : 1,
          }}
          transition={{ duration: reduced ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
          {latestBoost && latestBoost.id !== dismissed && (
            <div className="encouragement-toast" role="status">
              <span>
                <strong>{latestBoost.from}</strong>{" "}
                {boostLabels[latestBoost.kind]}.
              </span>
              <button
                onClick={() => setDismissed(latestBoost.id)}
                aria-label="Dismiss encouragement"
              >
                ×
              </button>
            </div>
          )}
          <div className="friends-heading">
            <h1>Friends</h1>
            <span className="member-count">
              <Users size={13} />
              {entries.length}
            </span>
          </div>
          <section className="leaderboard-section">
            <div className="section-heading board-heading">
              <h2>Leaderboard</h2>
              <div className="segmented" aria-label="Leaderboard period">
                {(["today", "weekly"] as const).map((value) => (
                  <button
                    key={value}
                    onClick={() => onPeriod(value)}
                    aria-pressed={period === value}
                    className={period === value ? "selected" : ""}
                  >
                    {value === "today" ? "Today" : "Week"}
                  </button>
                ))}
              </div>
            </div>
            {loading && !entries.length ? (
              <div className="activity-skeleton" role="status">
                <div />
                <div />
                <span className="sr-only">Loading leaderboard…</span>
              </div>
            ) : !entries.length ? (
              <EmptyActivity title="Better with a little company">
                Add your first friend below. Once WakaTime syncs, your circle
                comes to life here.
              </EmptyActivity>
            ) : (
              <motion.div className="people-list" layout={!reduced}>
                {entries.map((entry, index) => (
                  <motion.button
                    key={entry.username}
                    ref={(node) => {
                      if (node) rowButtons.current.set(entry.username, node);
                      else rowButtons.current.delete(entry.username);
                    }}
                    className={`person-row ${entry.username === username ? "is-you" : ""}`}
                    layout={reduced || selected ? false : "position"}
                    whileHover={reduced ? {} : { y: -2 }}
                    whileTap={reduced ? {} : { scale: 0.975 }}
                    initial={reduced ? false : { opacity: 0, y: 7 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      ...spring,
                      opacity: {
                        duration: 0.18,
                        delay: Math.min(index * 0.025, 0.2),
                      },
                    }}
                    onClick={(event) => select(entry, event.currentTarget)}
                    aria-label={`${entry.username}, ${entry.rank ? `rank ${entry.rank}, ` : ""}${entry.status === "ok" ? formatDuration(entry.totalSeconds) : entry.status}. View activity`}
                  >
                    <span
                      className={`position ${entry.rank === 1 ? "first" : ""}`}
                    >
                      {entry.rank === 1 ? (
                        <Crown size={15} />
                      ) : (
                        (entry.rank ?? "—")
                      )}
                    </span>
                    <Avatar username={entry.username} />
                    <span className="person-copy">
                      <span className="person-name">
                        {entry.username}
                        {entry.username === username && (
                          <span className="you-pill">you</span>
                        )}
                      </span>
                      <span className="person-subtitle">
                        {trackFor(entry.username) ? (
                          <>
                            <Headphones size={11} />{" "}
                            {trackFor(entry.username)!.title}
                          </>
                        ) : (
                          entry.honorTitle ||
                          (entry.status === "private"
                            ? "Activity is private"
                            : "One day at a time")
                        )}
                      </span>
                      {entry.status === "ok" && (
                        <Meter percent={(entry.totalSeconds / top) * 100} />
                      )}
                    </span>
                    <span className="person-time">
                      {entry.status === "ok" ? (
                        <AnimatedTime seconds={entry.totalSeconds} />
                      ) : entry.status === "pending" ? (
                        "Syncing"
                      ) : entry.status === "private" ? (
                        "Private"
                      ) : (
                        "Unavailable"
                      )}
                      {period === "weekly" &&
                        "dailyAverageSeconds" in entry &&
                        entry.status === "ok" && (
                          <small>
                            {formatDuration(entry.dailyAverageSeconds)} / day
                          </small>
                        )}
                    </span>
                    <ChevronRight
                      className="row-chevron"
                      size={13}
                      aria-hidden="true"
                    />
                  </motion.button>
                ))}
              </motion.div>
            )}
            <div className="board-footer">
              <span>{formatDuration(teamSeconds)} together</span>
              <span>
                {updatedAt
                  ? `Updated ${new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : "Waiting for sync"}
              </span>
            </div>
          </section>
          {yesterday.length > 0 && (
            <button className="yesterday-card" onClick={onHistory}>
              <span className="yesterday-icon">
                <History size={17} />
              </span>
              <span>
                <strong>Yesterday’s frontrunners</strong>
                <span>
                  {yesterday
                    .slice(0, 3)
                    .map((entry) => entry.username)
                    .join(" · ")}
                </span>
              </span>
              <ChevronRight size={15} />
            </button>
          )}
          {footer}
        </motion.div>
      {selected && origin && (
        <ProfileTransition
          open={!closing}
          origin={origin}
          username={selected.username}
          onClose={close}
          onClosed={finishClose}
        >
          <MemberProfile
            entry={selected}
            isSelf={selected.username === username}
            request={request}
            onBack={close}
            track={trackFor(selected.username)}
            initialPeriod={period === "weekly" ? "week" : "today"}
            onSaveHonorTitle={onSaveHonorTitle}
          />
        </ProfileTransition>
      )}
    </>
  );
}
