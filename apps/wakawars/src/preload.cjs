const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("molty", {
  configureSpotify: (sessionId) => ipcRenderer.invoke("spotify:configure", sessionId),
  getSpotifyState: () => ipcRenderer.invoke("spotify:state"),
  setSpotifyEnabled: (enabled) => ipcRenderer.invoke("spotify:enable", enabled),
  onWindowVisibility: (callback) => {
    const listener = (_event, visible) => callback(visible);
    ipcRenderer.on("wakawars:visibility", listener);
    return () => ipcRenderer.removeListener("wakawars:visibility", listener);
  },
  getApiBase: () => ipcRenderer.invoke("get-api-base"),
  getLoginItemSettings: () => ipcRenderer.invoke("get-login-item-settings"),
  setLoginItemSettings: (openAtLogin) =>
    ipcRenderer.invoke("set-login-item-settings", openAtLogin),
  setTrayTitle: (title) => ipcRenderer.invoke("set-tray-title", title),
  onWindowOpen: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("wakawars:window-opened", listener);
    return () => {
      ipcRenderer.removeListener("wakawars:window-opened", listener);
    };
  },
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
});
