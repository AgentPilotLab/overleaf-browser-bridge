"use strict";

const DEFAULT_SERVER_URL = "http://127.0.0.1:38475";

const serverUrl = document.getElementById("serverUrl");
const token = document.getElementById("token");
const statusBox = document.getElementById("status");
const tokenState = document.getElementById("tokenState");
const tabState = document.getElementById("tabState");
const projectState = document.getElementById("projectState");
const fileState = document.getElementById("fileState");

chrome.storage.sync.get({
  serverUrl: DEFAULT_SERVER_URL,
  token: ""
}, (items) => {
  serverUrl.value = items.serverUrl || DEFAULT_SERVER_URL;
  token.value = items.token || "";
  renderTokenState(items);
  refreshTabState();
});

document.getElementById("save").addEventListener("click", () => {
  chrome.storage.sync.set({
    serverUrl: normalizeUrl(serverUrl.value),
    token: token.value.trim()
  }, () => {
    renderTokenState({ token: token.value.trim() });
    statusBox.textContent = "Saved.";
  });
});

document.getElementById("test").addEventListener("click", async () => {
  statusBox.textContent = "Testing...";
  try {
    const response = await fetch(`${normalizeUrl(serverUrl.value)}/health`);
    const json = await response.json();
    statusBox.textContent = json.ok ? `Connected. Pages: ${json.connectedClients}. Token protected: ${json.tokenProtected ? "yes" : "no"}.` : "Bridge not ready.";
  } catch (error) {
    statusBox.textContent = `Failed: ${error.message}`;
  }
});

function normalizeUrl(value) {
  return String(value || DEFAULT_SERVER_URL).replace(/\/+$/, "");
}

function renderTokenState(items) {
  tokenState.textContent = items.token ? "Configured" : "Optional";
}

function refreshTabState() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.url) {
      tabState.textContent = "Unavailable";
      return;
    }
    const isProject = isOfficialOverleafProjectUrl(tab.url);
    tabState.textContent = isProject ? "Overleaf project" : "Not Overleaf";
    if (!isProject) return;
    chrome.tabs.sendMessage(tab.id, { type: "overleaf_bridge_popup_status" }, (response) => {
      if (chrome.runtime.lastError || !response) return;
      projectState.textContent = response.projectTitle || "Unknown";
      fileState.textContent = response.fileName || "Unknown";
    });
  });
}

function isOfficialOverleafProjectUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "overleaf.com" || url.hostname.endsWith(".overleaf.com")) &&
      url.pathname.startsWith("/project/");
  } catch (_) {
    return false;
  }
}
