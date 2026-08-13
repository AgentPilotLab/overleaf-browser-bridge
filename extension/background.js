"use strict";

const ALLOWED_BRIDGE_PATHS = new Set([
  "/bridge/register",
  "/bridge/next",
  "/bridge/result"
]);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "overleaf_bridge_fetch") return false;
  proxyBridgeRequest(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, status: 0, body: "", error: error.message }));
  return true;
});

async function proxyBridgeRequest(message) {
  const target = parseBridgeTarget(message.serverUrl, message.path);
  const method = String(message.method || "GET").toUpperCase();
  if (!target || !["GET", "POST"].includes(method)) {
    return { ok: false, status: 0, body: "", error: "unsupported bridge request" };
  }

  const token = String(message.token || "").trim();
  const response = await fetch(target.toString(), {
    method,
    headers: {
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
      "Content-Type": "application/json"
    },
    body: method === "POST" ? String(message.body || "") : undefined
  });
  return {
    ok: response.ok,
    status: response.status,
    body: await response.text(),
    error: ""
  };
}

function parseBridgeTarget(serverUrl, requestPath) {
  try {
    const origin = new URL(String(serverUrl || ""));
    if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) return null;
    if (origin.pathname !== "/" || origin.search || origin.hash) return null;
    const target = new URL(String(requestPath || ""), origin);
    if (target.origin !== origin.origin || !ALLOWED_BRIDGE_PATHS.has(target.pathname)) return null;
    return target;
  } catch (_) {
    return null;
  }
}

globalThis.__overleafBridgeBackgroundTestHooks = {
  parseBridgeTarget,
  proxyBridgeRequest
};
