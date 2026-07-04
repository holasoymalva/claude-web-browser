const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("claudeBrowser", {
  getTabs: () => ipcRenderer.invoke("tabs:get"),
  createTab: (target) => ipcRenderer.invoke("tabs:create", target),
  switchTab: (tabId) => ipcRenderer.invoke("tabs:switch", tabId),
  closeTab: (tabId) => ipcRenderer.invoke("tabs:close", tabId),
  navigate: (target) => ipcRenderer.invoke("browser:navigate", target),
  back: () => ipcRenderer.invoke("browser:back"),
  forward: () => ipcRenderer.invoke("browser:forward"),
  reload: () => ipcRenderer.invoke("browser:reload"),
  setBounds: (bounds) => ipcRenderer.invoke("browser:set-bounds", bounds),
  askClaude: (payload) => ipcRenderer.invoke("claude:ask", payload),
  getReadableText: () => ipcRenderer.invoke("page:readable-text"),
  onTabsUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("tabs:updated", listener);
    return () => ipcRenderer.removeListener("tabs:updated", listener);
  },
  onBrowserError: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("browser:error", listener);
    return () => ipcRenderer.removeListener("browser:error", listener);
  }
});
