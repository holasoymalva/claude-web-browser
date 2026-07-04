const { app, BrowserView, BrowserWindow, ipcMain, shell } = require("electron");
const { randomUUID } = require("node:crypto");

const START_URL = "https://www.google.com";
const SEARCH_URL = "https://duckduckgo.com/?q=";
const anthropicModel = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

let mainWindow;
let activeTabId = null;
const tabs = new Map();
let lastBounds = { x: 72, y: 112, width: 900, height: 700 };

function normalizeTarget(input) {
  const value = String(input || "").trim();
  if (!value) return START_URL;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(value)) return `https://${value}`;
  return `${SEARCH_URL}${encodeURIComponent(value)}`;
}

function canGoBack(webContents) {
  return webContents.navigationHistory?.canGoBack?.() ?? webContents.canGoBack();
}

function canGoForward(webContents) {
  return webContents.navigationHistory?.canGoForward?.() ?? webContents.canGoForward();
}

function goBack(webContents) {
  if (webContents.navigationHistory?.goBack) webContents.navigationHistory.goBack();
  else webContents.goBack();
}

function goForward(webContents) {
  if (webContents.navigationHistory?.goForward) webContents.navigationHistory.goForward();
  else webContents.goForward();
}

function tabSnapshot(tab) {
  return {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    canGoBack: canGoBack(tab.view.webContents),
    canGoForward: canGoForward(tab.view.webContents),
    isLoading: tab.view.webContents.isLoading()
  };
}

function sendTabs() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("tabs:updated", {
    activeTabId,
    tabs: [...tabs.values()].map(tabSnapshot)
  });
}

function applyBounds(tab) {
  const [windowWidth, windowHeight] = mainWindow.getContentSize();
  const bounds = {
    x: Math.max(0, Math.round(lastBounds.x)),
    y: Math.max(0, Math.round(lastBounds.y)),
    width: Math.max(280, Math.min(Math.round(lastBounds.width), windowWidth)),
    height: Math.max(220, Math.min(Math.round(lastBounds.height), windowHeight))
  };
  tab.view.setBounds(bounds);
  tab.view.setAutoResize({ width: true, height: true });
}

function attachActiveView() {
  if (!mainWindow || !activeTabId) return;
  for (const tab of tabs.values()) {
    try {
      mainWindow.removeBrowserView(tab.view);
    } catch {}
  }

  const tab = tabs.get(activeTabId);
  if (!tab) return;
  mainWindow.addBrowserView(tab.view);
  applyBounds(tab);
  tab.view.webContents.focus();
  sendTabs();
}

function wireTab(tab) {
  const wc = tab.view.webContents;

  wc.setWindowOpenHandler(({ url }) => {
    createTab(url, true);
    return { action: "deny" };
  });

  wc.on("page-title-updated", (_event, title) => {
    tab.title = title || tab.title;
    sendTabs();
  });

  wc.on("did-start-loading", sendTabs);
  wc.on("did-stop-loading", sendTabs);
  wc.on("did-navigate", (_event, url) => {
    tab.url = url;
    sendTabs();
  });
  wc.on("did-navigate-in-page", (_event, url) => {
    tab.url = url;
    sendTabs();
  });
  wc.on("did-fail-load", (_event, _code, description, url, isMainFrame) => {
    if (!isMainFrame) return;
    tab.title = "Load failed";
    tab.url = url;
    mainWindow.webContents.send("browser:error", { tabId: tab.id, description, url });
    sendTabs();
  });
}

function createTab(target = START_URL, activate = true) {
  const id = randomUUID();
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  const tab = {
    id,
    view,
    title: "New tab",
    url: normalizeTarget(target)
  };

  wireTab(tab);
  tabs.set(id, tab);
  view.webContents.loadURL(tab.url);

  if (activate) {
    activeTabId = id;
    attachActiveView();
  } else {
    sendTabs();
  }

  return tabSnapshot(tab);
}

async function getActiveReadableText() {
  const tab = tabs.get(activeTabId);
  if (!tab) return "";

  return tab.view.webContents.executeJavaScript(`
    (() => {
      const clone = document.body ? document.body.cloneNode(true) : null;
      if (!clone) return document.title || location.href;
      clone.querySelectorAll('script, style, noscript, svg, canvas, iframe').forEach((node) => node.remove());
      const text = clone.innerText || clone.textContent || '';
      return [
        document.title ? 'Title: ' + document.title : '',
        'URL: ' + location.href,
        text.replace(/\\s+/g, ' ').trim()
      ].filter(Boolean).join('\\n\\n').slice(0, 60000);
    })()
  `, true).catch(() => "");
}

async function askClaude({ prompt, messages = [] }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Falta ANTHROPIC_API_KEY. Exporta la variable antes de abrir la app.");
  }

  const pageContext = await getActiveReadableText();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: anthropicModel,
      max_tokens: 1400,
      system: [
        "You are Claude inside a desktop AI browser.",
        "Be direct, practical, and grounded in the active webpage.",
        "Help with browsing tasks: summarize, compare, extract, plan, draft, verify, and propose next searches."
      ].join(" "),
      messages: [
        {
          role: "user",
          content: `Active page context:\n${pageContext || "No readable page context available."}`
        },
        ...messages.slice(-12),
        { role: "user", content: prompt }
      ]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "Claude request failed.");
  }

  return {
    text: data.content?.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim() || "",
    model: data.model
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    title: "Claude Browser",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#f7f5ef",
    webPreferences: {
      preload: `${__dirname}/preload.cjs`,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.setMaxListeners(30);
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  mainWindow.loadFile(`${__dirname}/renderer/index.html`);
  mainWindow.webContents.on("did-finish-load", sendTabs);
  mainWindow.on("resize", () => {
    const tab = tabs.get(activeTabId);
    if (tab) applyBounds(tab);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  createTab(START_URL, true);
}

ipcMain.handle("tabs:create", (_event, target) => createTab(target, true));
ipcMain.handle("tabs:get", () => ({
  activeTabId,
  tabs: [...tabs.values()].map(tabSnapshot)
}));
ipcMain.handle("tabs:switch", (_event, tabId) => {
  if (tabs.has(tabId)) {
    activeTabId = tabId;
    attachActiveView();
  }
  return { ok: true };
});
ipcMain.handle("tabs:close", (_event, tabId) => {
  const tab = tabs.get(tabId);
  if (!tab) return { ok: true };
  if (mainWindow) {
    try {
      mainWindow.removeBrowserView(tab.view);
    } catch {}
  }
  tab.view.webContents.destroy();
  tabs.delete(tabId);

  if (activeTabId === tabId) activeTabId = tabs.keys().next().value || null;
  if (!activeTabId) createTab(START_URL, true);
  else attachActiveView();
  sendTabs();
  return { ok: true };
});
ipcMain.handle("browser:navigate", (_event, target) => {
  const tab = tabs.get(activeTabId);
  if (!tab) return null;
  tab.url = normalizeTarget(target);
  tab.view.webContents.loadURL(tab.url);
  sendTabs();
  return tabSnapshot(tab);
});
ipcMain.handle("browser:back", () => {
  const tab = tabs.get(activeTabId);
  if (tab && canGoBack(tab.view.webContents)) goBack(tab.view.webContents);
});
ipcMain.handle("browser:forward", () => {
  const tab = tabs.get(activeTabId);
  if (tab && canGoForward(tab.view.webContents)) goForward(tab.view.webContents);
});
ipcMain.handle("browser:reload", () => {
  const tab = tabs.get(activeTabId);
  if (tab) tab.view.webContents.reload();
});
ipcMain.handle("browser:set-bounds", (_event, bounds) => {
  lastBounds = bounds;
  const tab = tabs.get(activeTabId);
  if (tab) applyBounds(tab);
});
ipcMain.handle("browser:open-external", (_event, url) => shell.openExternal(url));
ipcMain.handle("claude:ask", (_event, payload) => askClaude(payload));
ipcMain.handle("page:readable-text", () => getActiveReadableText());

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
