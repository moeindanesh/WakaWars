import type { UserRepository } from "./repository.js";

export const DEFAULT_PROVIDER_LOG_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ProviderLogCleanupOptions = {
  store: UserRepository;
  retentionDays: number;
  intervalMs?: number;
  onError?: (error: unknown) => void;
};

export type ProviderLogCleanup = {
  start: () => void;
  stop: () => void;
  runOnce: () => Promise<number>;
};

/**
 * Periodically deletes provider logs older than the retention window so the
 * (write-only, debugging-oriented) ww_provider_log table stays bounded.
 */
export const createProviderLogCleanup = ({
  store,
  retentionDays,
  intervalMs = DEFAULT_PROVIDER_LOG_CLEANUP_INTERVAL_MS,
  onError,
}: ProviderLogCleanupOptions): ProviderLogCleanup => {
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  const reportError = (error: unknown) => {
    if (onError) {
      onError(error);
      return;
    }
    // eslint-disable-next-line no-console
    console.error("[wakawars] Provider log cleanup failed", error);
  };

  const runOnce = async (): Promise<number> => {
    if (running) return 0;
    running = true;
    try {
      const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
      return await store.deleteProviderLogsOlderThan(cutoff);
    } catch (error) {
      reportError(error);
      return 0;
    } finally {
      running = false;
    }
  };

  const start = () => {
    if (timer) return;
    if (retentionDays <= 0) return;
    void runOnce();
    timer = setInterval(() => {
      void runOnce();
    }, intervalMs);
  };

  const stop = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  };

  return { start, stop, runOnce };
};
