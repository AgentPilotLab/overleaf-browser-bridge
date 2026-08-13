"use strict";

(() => {
  if (document.documentElement.dataset.overleafCodexPageBridge === "loaded") return;
  document.documentElement.dataset.overleafCodexPageBridge = "loaded";

  function findCodeMirrorView() {
    const candidates = [
      document.querySelector(".cm-content"),
      document.querySelector(".cm-editor"),
      document.querySelector('[aria-label="Source Editor editing"]')
    ].filter(Boolean);
    for (const start of candidates) {
      const seen = new Set();
      const stack = [start];
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node || seen.has(node)) continue;
        seen.add(node);
        if (node.cmView && node.cmView.view && node.cmView.view.state && node.cmView.view.dispatch) {
          return node.cmView.view;
        }
        if (node.cmView && node.cmView.rootView && node.cmView.rootView.view && node.cmView.rootView.view.state) {
          return node.cmView.rootView.view;
        }
        if (node.parentNode) stack.push(node.parentNode);
        if (node.firstChild) stack.push(node.firstChild);
        if (node.nextSibling) stack.push(node.nextSibling);
      }
    }
    return null;
  }

  function readDocument() {
    const view = findCodeMirrorView();
    if (!view || !view.state || !view.state.doc) throw new Error("CodeMirror view not found");
    return view.state.doc.toString();
  }
    function replaceDocument(text) {
      const view = findCodeMirrorView();
      if (!view || !view.state || !view.state.doc || !view.dispatch) throw new Error("CodeMirror view not found");
      const target = String(text || "");
      const current = view.state.doc.toString();
      if (current === target) return;
      view.focus();

      let prefix = 0;
      const minLength = Math.min(current.length, target.length);
      while (prefix < minLength && current[prefix] === target[prefix]) prefix += 1;

      let suffix = 0;
      while (
        suffix < current.length - prefix &&
        suffix < target.length - prefix &&
        current[current.length - 1 - suffix] === target[target.length - 1 - suffix]
      ) {
        suffix += 1;
      }

      const deleteFrom = prefix;
      const deleteTo = current.length - suffix;
      const insertText = target.slice(prefix, target.length - suffix);
      replaceRangeInChunks(view, deleteFrom, deleteTo, insertText);

      const after = view.state.doc.toString();
      if (after !== target) {
        throw new Error(`chunked replace verification failed: expected ${target.length} chars, got ${after.length}`);
      }
    }

    function replaceRangeInChunks(view, from, to, insertText) {
      const deleteChunkSize = 2000;
      let deleteEnd = to;
      while (deleteEnd > from) {
        const deleteStart = Math.max(from, deleteEnd - deleteChunkSize);
        view.dispatch({ changes: { from: deleteStart, to: deleteEnd, insert: "" } });
        deleteEnd = deleteStart;
      }

      const insertChunkSize = 2000;
      let insertAt = from;
      for (let index = 0; index < insertText.length; index += insertChunkSize) {
        const chunk = insertText.slice(index, index + insertChunkSize);
        view.dispatch({ changes: { from: insertAt, to: insertAt, insert: chunk } });
        insertAt += chunk.length;
      }
    }
    window.addEventListener("overleaf-codex-page-bridge-command", (event) => {
    const detail = event.detail || {};
    const id = detail.id;
    if (!id) return;
    try {
      let payload = {};
      if (detail.action === "read") {
        payload = { text: readDocument() };
      } else if (detail.action === "replace") {
        replaceDocument(String((detail.payload || {}).text || ""));
        payload = { ok: true };
      } else {
        throw new Error(`unknown page bridge action: ${detail.action}`);
      }
      window.dispatchEvent(new CustomEvent("overleaf-codex-page-bridge-result", {
        detail: { id, ok: true, payload }
      }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent("overleaf-codex-page-bridge-result", {
        detail: { id, ok: false, error: error.message }
      }));
    }
  });
})();
