import { useEffect, useState } from "react";
import type { SocialSnapshot } from "@molty/shared";
import { useWindowActivity } from "./useWindowActivity";

export type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;
export function useSocial(request: ApiRequest, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<SocialSnapshot>({
    listening: [],
    boosts: [],
  });
  const visible = useWindowActivity();
  useEffect(() => {
    setSnapshot({ listening: [], boosts: [] });
    if (!enabled || !visible) return;
    const controller = new AbortController();
    let busy = false;
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        const data = await request<SocialSnapshot>("/social", {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setSnapshot(data);
      } catch {
        if (!controller.signal.aborted)
          setSnapshot((current) => ({
            ...current,
            listening: current.listening.filter(
              (item) => Date.parse(item.expiresAt) > Date.now(),
            ),
          }));
      } finally {
        busy = false;
      }
    };
    void load();
    const timer = window.setInterval(load, 20_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [request, enabled, visible]);
  return snapshot;
}
