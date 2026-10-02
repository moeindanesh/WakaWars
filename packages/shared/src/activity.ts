export type ActivityBreakdown = {
  name: string;
  totalSeconds: number;
  percent: number;
};
export type AIModelActivity = { name: string; linesChanged: number };
export type ActivityDay = {
  date: string;
  totalSeconds: number;
  aiSeconds: number | null;
};
export type ActivityDetails = {
  profile?: {
    displayName: string | null;
    photoUrl: string | null;
    bio: string | null;
  };
  username: string;
  period: "today" | "week";
  status: "ok" | "private" | "unavailable";
  updatedAt: string;
  stale: boolean;
  totalSeconds: number;
  dailyAverageSeconds: number;
  days: ActivityDay[];
  languages: ActivityBreakdown[];
  editors: ActivityBreakdown[];
  categories: ActivityBreakdown[];
  ai: {
    totalSeconds: number | null;
    additions: number | null;
    deletions: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    sessions: number | null;
    models: AIModelActivity[];
  };
};

export type NowPlaying = {
  title: string;
  artist: string;
  album: string;
  trackId: string;
};
export type BoostKind = "applause" | "fire" | "keep_going" | "break";
export type SocialSnapshot = {
  listening: Array<{ username: string; track: NowPlaying; expiresAt: string }>;
  boosts: Array<{
    id: string;
    from: string;
    kind: BoostKind;
    createdAt: string;
  }>;
};
