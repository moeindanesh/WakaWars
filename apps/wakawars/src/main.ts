import electron, {
  type BrowserWindow as BrowserWindowType,
  type Tray as TrayType,
} from "electron";
import electronUpdater from "electron-updater";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSpotifySharing } from "./spotify.js";

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  screen,
  nativeTheme,
  shell,
  powerMonitor,
} = electron;
const { autoUpdater } = electronUpdater;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let tray: TrayType | null = null;
let mainWindow: BrowserWindowType | null = null;
let trayTitle = "";
const apiBase = app.isPackaged
  ? "https://core.molty.cool/wakawars/v0"
  : "http://localhost:3000/wakawars/v0";
let resolveApiBase: ((value: string) => void) | null = null;

const apiBaseReady = new Promise<string>((resolve) => {
  resolveApiBase = resolve;
});

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const rendererURL =
  isDev && process.env.VITE_DEV_SERVER_URL
    ? process.env.VITE_DEV_SERVER_URL
    : "https://wakawars.molty.cool";
let spotify: ReturnType<typeof createSpotifySharing> | null = null;
const trustedRenderer = (event: Electron.IpcMainInvokeEvent) => {
  if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow?.webContents.mainFrame ||
      new URL(event.senderFrame.url).origin !== new URL(rendererURL).origin) throw new Error("Untrusted renderer");
};
const isMacOS13OrNewer =
  process.platform === "darwin"
    ? (() => {
        const major = Number.parseInt(os.release().split(".")[0] ?? "0", 10);
        return Number.isNaN(major) ? false : major >= 22;
      })()
    : false;

const getTrayIconPath = () => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "trayTemplate.png");
  }
  return path.join(__dirname, "..", "assets", "trayTemplate.png");
};

const createTrayIcon = () => {
  const icon = nativeImage.createFromPath(getTrayIconPath());
  if (!icon.isEmpty()) {
    icon.setTemplateImage(true);
    return icon;
  }

  const fallbackPath = path.join(__dirname, "..", "assets", "trayTemplate.png");
  const fallback = nativeImage.createFromPath(fallbackPath);
  if (!fallback.isEmpty()) {
    fallback.setTemplateImage(true);
    return fallback;
  }

  return nativeImage.createEmpty();
};

const updateTrayIcon = () => {
  if (!tray) return;
  const icon = createTrayIcon();
  tray.setImage(icon);
  tray.setPressedImage(icon);
};

const applyTrayTitle = () => {
  if (!tray) return;
  if (process.platform !== "darwin") return;
  if (typeof tray.setTitle === "function") {
    tray.setTitle(trayTitle);
  }
};

const createWindow = () => {
  const preloadPath = app.isPackaged
    ? path.join(__dirname, "preload.cjs")
    : path.join(__dirname, "..", "src", "preload.cjs");

  mainWindow = new BrowserWindow({
    width: 420,
    height: 640,
    show: false,
    frame: false,
    resizable: false,
    transparent: process.platform === "darwin",
    backgroundColor: process.platform === "darwin" ? "#00000000" : "#242426",
    ...(process.platform === "darwin" ? { vibrancy: "popover" as const, visualEffectState: "active" as const } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(rendererURL);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Spotify links open in the system browser, never a Node-capable window.
    if (/^https:\/\/open\.spotify\.com\/track\/[a-zA-Z0-9]{22}$/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== new URL(rendererURL).origin) event.preventDefault();
  });
  mainWindow.on("hide", () => mainWindow?.webContents.send("wakawars:visibility", false));

  mainWindow.on("blur", () => {
    if (!mainWindow?.webContents.isDevToolsOpened()) {
      mainWindow?.hide();
    }
  });
  mainWindow.on("show", () => {
    if (!mainWindow) return;
    const sendOpened = () => {
      mainWindow?.webContents.send("wakawars:visibility", true);
      mainWindow?.webContents.send("wakawars:window-opened");
    };

    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once("did-finish-load", sendOpened);
    } else {
      sendOpened();
    }
  });

  return mainWindow;
};

const positionWindow = () => {
  if (!tray || !mainWindow) return;

  const trayBounds = tray.getBounds();
  const windowBounds = mainWindow.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x,
    y: trayBounds.y,
  });

  const x = Math.round(
    trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2
  );
  const y = Math.round(trayBounds.y + trayBounds.height + 6);

  const minX = display.bounds.x + 8;
  const maxX = display.bounds.x + display.bounds.width - windowBounds.width - 8;
  const maxY =
    display.bounds.y + display.bounds.height - windowBounds.height - 8;

  const clampedX = Math.min(Math.max(x, minX), maxX);
  const clampedY = Math.min(y, maxY);

  mainWindow.setPosition(clampedX, clampedY, false);
};

const toggleWindow = () => {
  if (!mainWindow) return;

  if (mainWindow.isVisible()) {
    mainWindow.hide();
    return;
  }

  positionWindow();
  mainWindow.show();
  mainWindow.focus();
};

const createTray = () => {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip("WakaWars");
  tray.setPressedImage(icon);
  applyTrayTitle();

  tray.on("click", toggleWindow);
  tray.on("right-click", () => {
    const menu = Menu.buildFromTemplate([
      { label: "Open", click: () => toggleWindow() },
      { type: "separator" },
      { role: "quit" },
    ]);
    tray?.popUpContextMenu(menu);
  });
  nativeTheme.on("updated", updateTrayIcon);
};

const setupAutoUpdates = () => {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.on("error", (error: unknown) => {
    // eslint-disable-next-line no-console
    console.error("Auto update error:", error);
  });
  autoUpdater.checkForUpdatesAndNotify();
};

const resolveApiBaseReady = () => {
  resolveApiBase?.(apiBase);
};

ipcMain.handle("get-api-base", () => apiBaseReady);
ipcMain.handle("spotify:configure", (event, token: unknown) => {
  trustedRenderer(event);
  if (token !== null && (typeof token !== "string" || token.length > 1024)) throw new Error("Invalid session");
  return spotify?.configure(token as string | null);
});
ipcMain.handle("spotify:state", (event) => { trustedRenderer(event); return spotify?.getState(); });
ipcMain.handle("spotify:enable", (event, enabled: unknown) => {
  trustedRenderer(event);
  if (typeof enabled !== "boolean") throw new Error("Invalid preference");
  return spotify?.setEnabled(enabled);
});
const getLoginItemSettings = () => {
  if (process.platform === "darwin" && isMacOS13OrNewer) {
    return app.getLoginItemSettings({ type: "mainAppService" });
  }
  return app.getLoginItemSettings();
};

const setLoginItemSettings = (openAtLogin: boolean) => {
  const settings: Electron.Settings = { openAtLogin };
  if (process.platform === "darwin") {
    if (isMacOS13OrNewer) {
      settings.type = "mainAppService";
    } else {
      settings.openAsHidden = true;
    }
  }
  app.setLoginItemSettings(settings);
  return getLoginItemSettings();
};

ipcMain.handle("get-login-item-settings", () => getLoginItemSettings());
ipcMain.handle("set-login-item-settings", (_event, openAtLogin: boolean) =>
  setLoginItemSettings(openAtLogin)
);
ipcMain.handle("set-tray-title", (_event, title?: string) => {
  trayTitle = typeof title === "string" ? title : "";
  applyTrayTitle();
  return { ok: true };
});
ipcMain.handle("check-for-updates", async () => {
  if (!app.isPackaged) {
    return { status: "disabled" };
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    return { status: result?.updateInfo?.version ? "checked" : "checked" };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Update failed",
    };
  }
});

app.whenReady().then(async () => {
  app.setName("WakaWars");
  spotify = createSpotifySharing(apiBase, path.join(app.getPath("userData"), "spotify-sharing.json"));
  powerMonitor.on("suspend", () => void spotify?.suspend());
  powerMonitor.on("resume", () => spotify?.resume());
  resolveApiBaseReady();
  createWindow();
  createTray();
  setupAutoUpdates();
  if (process.platform === "darwin") {
    app.dock?.hide();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
app.on("before-quit", () => spotify?.stop());

app.on("activate", () => {
  if (!mainWindow) {
    createWindow();
  }
});
