export {};
import type { NowPlaying } from "@molty/shared";

export type MusicState = {
  supported: boolean;
  enabled: boolean;
  status: "off" | "waiting" | "sharing" | "permission" | "error";
  track: NowPlaying | null;
  error: string | null;
};

declare global {
  interface Window {
    molty?: {
      configureSpotify?: (sessionId: string | null) => Promise<MusicState>;
      getSpotifyState?: () => Promise<MusicState>;
      setSpotifyEnabled?: (enabled: boolean) => Promise<MusicState>;
      onWindowVisibility?: (callback: (visible: boolean) => void) => () => void;
      getApiBase: () => Promise<string>;
      getLoginItemSettings?: () => Promise<{
        openAtLogin: boolean;
        status?: string;
      }>;
      setLoginItemSettings?: (
        openAtLogin: boolean,
      ) => Promise<{ openAtLogin: boolean; status?: string }>;
      setTrayTitle?: (title: string) => Promise<{ ok: boolean }>;
      onWindowOpen?: (callback: () => void) => () => void;
      checkForUpdates?: () => Promise<{ status: string; error?: string }>;
    };
  }
}
