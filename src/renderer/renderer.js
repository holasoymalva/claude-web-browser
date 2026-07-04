const tabsEl = document.querySelector("#tabs");
const address = document.querySelector("#address");
const navForm = document.querySelector("#navForm");
const browserSlot = document.querySelector("#browserSlot");
const conversation = document.querySelector("#conversation");
const assistantForm = document.querySelector("#assistantForm");
const assistantInput = document.querySelector("#assistantInput");

let state = { activeTabId: null, tabs: [] };
let messages = [];

function activeTab() {
  return state.tabs.find((tab) => tab.id === state.activeTabId);
}

function setBusy(isBusy) {
  document.querySelector(".assistant").classList.toggle("busy", isBusy);
}

function updateBrowserBounds() {
  const rect = browserSlot.getBoundingClientRect();
  window.claudeBrowser.setBounds({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
  });
}

function renderTabs() {
  tabsEl.innerHTML = "";

  for (const tab of state.tabs) {
    const item = document.createElement("button");
    item.className = `tab${tab.id === state.activeTabId ? " active" : ""}`;
    item.type = "button";
    item.innerHTML = `<span class="tab-title"></span><span class="tab-close" title="Close">×</span>`;
    item.querySelector(".tab-title").textContent = tab.title || "New tab";
    item.addEventListener("click", async (event) => {
      if (event.target.classList.contains("tab-close")) {
        event.stopPropagation();
        await window.claudeBrowser.closeTab(tab.id);
        return;
      }
      await window.claudeBrowser.switchTab(tab.id);
      updateBrowserBounds();
    });
    tabsEl.append(item);
  }
}

function renderChrome() {
  const tab = activeTab();
  address.value = tab?.url || "";
  renderTabs();
  updateBrowserBounds();
}

function addMessage(role, text) {
  const message = document.createElement("div");
  message.className = `message ${role === "user" ? "user-message" : "assistant-message"}`;
  message.innerHTML = `<strong></strong><p></p>`;
  message.querySelector("strong").textContent = role === "user" ? "You" : "Claude";
  message.querySelector("p").textContent = text;
  conversation.append(message);
  conversation.scrollTop = conversation.scrollHeight;
}

async function askClaude(prompt) {
  const userMessage = { role: "user", content: prompt };
  messages.push(userMessage);
  addMessage("user", prompt);
  setBusy(true);

  try {
    const response = await window.claudeBrowser.askClaude({ prompt, messages: messages.slice(0, -1) });
    messages.push({ role: "assistant", content: response.text });
    addMessage("assistant", response.text);
  } catch (error) {
    addMessage("assistant", error.message);
  } finally {
    setBusy(false);
  }
}

window.claudeBrowser.onTabsUpdated((payload) => {
  state = payload;
  renderChrome();
});

window.claudeBrowser.onBrowserError(({ description, url }) => {
  addMessage("assistant", `Could not load ${url}: ${description}`);
});

window.claudeBrowser.getTabs().then((payload) => {
  state = payload;
  renderChrome();
});

navForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await window.claudeBrowser.navigate(address.value);
});

document.querySelector("#newTab").addEventListener("click", async () => {
  await window.claudeBrowser.createTab();
  updateBrowserBounds();
});

document.querySelector("#back").addEventListener("click", () => window.claudeBrowser.back());
document.querySelector("#forward").addEventListener("click", () => window.claudeBrowser.forward());
document.querySelector("#reload").addEventListener("click", () => window.claudeBrowser.reload());
document.querySelector("#focusClaude").addEventListener("click", () => assistantInput.focus());

document.querySelector("#readPage").addEventListener("click", async () => {
  setBusy(true);
  try {
    const text = await window.claudeBrowser.getReadableText();
    addMessage("assistant", text ? text.slice(0, 1600) : "I could not extract readable text from this page.");
  } catch (error) {
    addMessage("assistant", error.message);
  } finally {
    setBusy(false);
  }
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => askClaude(button.dataset.prompt));
});

assistantForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const prompt = assistantInput.value.trim();
  if (!prompt) return;
  assistantInput.value = "";
  askClaude(prompt);
});

new ResizeObserver(updateBrowserBounds).observe(browserSlot);
window.addEventListener("resize", updateBrowserBounds);
setTimeout(updateBrowserBounds, 250);
