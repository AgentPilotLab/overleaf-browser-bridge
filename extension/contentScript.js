"use strict";

(() => {
  const DEFAULT_SERVER_URL = "http://127.0.0.1:38475";
  const BRIDGE_VERSION = "0.5.34";
  const FILE_OPERATION_UI_SCHEMA_VERSION = 12;
  const POLL_DELAY_MS = 1000;
  const REGISTER_DELAY_MS = 5000;
  const CLIENT_ID_KEY = "overleafCodexBridgeClientId";

  let config = { serverUrl: DEFAULT_SERVER_URL, token: "" };
  let clientId = getOrCreateClientId();
  let stopped = false;

  document.documentElement.dataset.overleafCodexBridge = "loaded";
  document.documentElement.dataset.overleafCodexBridgeVersion = BRIDGE_VERSION;

  chrome.storage.sync.get({
    serverUrl: DEFAULT_SERVER_URL,
    token: ""
  }, (items) => {
    config = normalizeConfig(items);
    loop();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;
    if (changes.serverUrl || changes.token) {
      chrome.storage.sync.get({ serverUrl: DEFAULT_SERVER_URL, token: "" }, (items) => {
        config = normalizeConfig(items);
      });
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "overleaf_bridge_popup_status") {
      sendResponse(healthCheck());
    }
    return false;
  });

  window.addEventListener("beforeunload", () => {
    stopped = true;
  });

  async function loop() {
    while (!stopped) {
      try {
        await register();
        await pollOnce();
      } catch (error) {
        console.debug("[Overleaf Codex Bridge]", error.message);
        await sleep(POLL_DELAY_MS);
      }
    }
  }

  async function register() {
    const meta = getProjectMeta();
    await bridgeFetch("/bridge/register", {
      method: "POST",
      body: JSON.stringify({
        clientId,
        pageUrl: location.href,
        projectTitle: meta.projectTitle,
        fileName: meta.fileName,
        editorMode: meta.editorMode,
        contentScriptVersion: BRIDGE_VERSION
      })
    });
  }

  async function pollOnce() {
    const response = await bridgeFetch(`/bridge/next?clientId=${encodeURIComponent(clientId)}`, {
      method: "POST",
      body: "{}"
    });
    const json = await response.json();
    if (!json.command) return;
    const command = json.command;
    try {
      const payload = await executeCommand(command.type, command.payload || {});
      await bridgeFetch("/bridge/result", {
        method: "POST",
        body: JSON.stringify({ id: command.id, ok: true, payload })
      });
    } catch (error) {
      await bridgeFetch("/bridge/result", {
        method: "POST",
        body: JSON.stringify({ id: command.id, ok: false, error: error.message })
      });
    }
  }

  async function executeCommand(type, payload) {
    assertOverleafEditor();
    if (payload.expectedProjectTitle) {
      const title = getProjectMeta().projectTitle.toLowerCase();
      if (!title.includes(String(payload.expectedProjectTitle).toLowerCase())) {
        throw new Error(`project title mismatch: ${getProjectMeta().projectTitle}`);
      }
    }
    if (payload.expectedFileName && !["open_file", "list_open_project_files", "health_check", "get_current_project"].includes(type)) {
      const fileName = getProjectMeta().fileName;
      if (fileName && !fileNameMatches(fileName, payload.expectedFileName)) {
        throw new Error(`file mismatch: expected ${payload.expectedFileName}, got ${fileName}`);
      }
    }

    if (type === "health_check") return healthCheck();
    if (type === "get_current_project") return getProjectMeta();
    if (type === "list_open_project_files") return listOpenProjectFiles();
    if (type === "open_file") return openFile(String(payload.fileName || payload.expectedFileName || ""));
    if (type === "read_current_file") return readCurrentFile();
    if (type === "get_selection") return getSelectionPayload();
    if (type === "get_editor_diagnostics") return getEditorDiagnostics();
    if (type === "list_visible_artifacts") return listVisibleArtifacts();
    if (type === "export_visible_artifact") return exportVisibleArtifact(payload);
    if (type === "inspect_file_operation_ui") return inspectFileOperationUi();
    if (type === "inspect_upload_workflow") return inspectUploadWorkflow();
    if (type === "inspect_download_workflow") return inspectDownloadWorkflow();
    if (type === "inspect_visible_comments") return inspectVisibleComments();
    if (type === "execute_comment_action") return executeCommentAction(payload);
    if (type === "insert_text") return insertText(String(payload.text || ""));
    if (type === "replace_selection") return replaceSelection(String(payload.replacement || ""));
    if (type === "replace_file") return replaceFile(String(payload.text || ""));
    if (type === "execute_file_operation") return executeFileOperation(payload);
    if (type === "compile_project") return compileProject();
    throw new Error(`unknown command: ${type}`);
  }

  function healthCheck() {
    const meta = getProjectMeta();
    return {
      ...meta,
      isOverleafProject: location.hostname.endsWith("overleaf.com") && location.pathname.startsWith("/project/"),
      tokenConfigured: Boolean(config.token),
      editorReadable: Boolean(getEditorElement()),
      editorWritable: Boolean(getEditorElement()),
      connected: true
    };
  }

  function getProjectMeta() {
    const titleButton = document.querySelector('button[aria-label="Project title options"]');
    const selectedFile = document.querySelector('[role="treeitem"][aria-selected="true"]');
    const editor = getEditorElement();
    return {
      projectTitle: cleanText(titleButton ? titleButton.textContent : document.title.replace(/ - Online LaTeX Editor Overleaf$/, "")),
      fileName: extractFileName(selectedFile),
      editorMode: editor ? "source" : "unknown",
      pageUrl: redactProjectUrl(location.href)
    };
  }

  async function readCurrentFile() {
    const meta = getProjectMeta();
    const bridged = await callPageBridge("read");
    if (!bridged || typeof bridged.text !== "string") throw new Error("page bridge read failed");
    const text = bridged.text;
    return {
      ...meta,
      text,
      sha256UnavailableInContentScript: true
    };
  }

  function listOpenProjectFiles() {
    const meta = getProjectMeta();
    const files = collectFileTreeEntries().filter((entry) => entry.kind === "file")
      .map((file) => ({
        fileName: file.fileName,
        path: file.path,
        selected: file.selected,
        depth: file.depth
      }));
    return { ...meta, files };
  }

  async function openFile(fileName) {
    if (!fileName) throw new Error("open_file received empty fileName");
    const target = await revealFileTreeItem(fileName);
    if (!target) throw new Error(`file not visible in Overleaf tree: ${fileName}`);
    target.scrollIntoView({ block: "center" });
    target.click();
    await sleep(800);
    const meta = getProjectMeta();
    if (meta.fileName && !fileNameMatches(meta.fileName, fileName)) {
      throw new Error(`file open mismatch: expected ${fileName}, got ${meta.fileName}`);
    }
    return { ...meta, openedFileName: meta.fileName || fileName };
  }

  function listVisibleArtifacts() {
    const artifacts = collectVisibleArtifacts(false);
    return {
      ...getProjectMeta(),
      artifactCount: artifacts.length,
      artifacts
    };
  }

  function collectVisibleArtifacts(includeRawUrl) {
    const artifacts = [];
    const seen = new Set();
    const linkSelectors = "a[href], iframe[src], embed[src], object[data]";
    for (const element of Array.from(document.querySelectorAll(linkSelectors))) {
      const rawUrl = element.getAttribute("href") || element.getAttribute("src") || element.getAttribute("data") || "";
      const label = cleanText([
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("download")
      ].filter(Boolean).join(" | "));
      const type = classifyArtifact(rawUrl, label);
      if (!type) continue;
      const key = `${type}:${rawUrl}:${label}`.slice(0, 500);
      if (seen.has(key)) continue;
      seen.add(key);
      const artifact = {
        type,
        source: element.tagName.toLowerCase(),
        label: label.slice(0, 160),
        url: redactArtifactUrl(rawUrl),
        visible: isElementVisible(element)
      };
      if (includeRawUrl) artifact.rawUrl = rawUrl;
      artifacts.push(artifact);
      if (artifacts.length >= 80) break;
    }

    for (const element of Array.from(document.querySelectorAll("button, [role='button']"))) {
      const label = cleanText([
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title")
      ].filter(Boolean).join(" | "));
      const type = classifyArtifact("", label);
      if (!type) continue;
      const key = `${type}:button:${label}`.slice(0, 500);
      if (seen.has(key)) continue;
      seen.add(key);
      artifacts.push({
        type,
        source: element.tagName.toLowerCase(),
        label: label.slice(0, 160),
        url: "",
        visible: isElementVisible(element),
        actionOnly: true
      });
      if (artifacts.length >= 80) break;
    }
    return artifacts;
  }

  async function exportVisibleArtifact(payload) {
    const maxBytes = clampMaxBytes(payload.maxBytes);
    const artifacts = collectVisibleArtifacts(true);
    const selected = selectArtifactCandidate(artifacts, payload);
    if (!selected || !selected.rawUrl || selected.actionOnly) {
      throw new Error("no downloadable visible artifact candidate matched the selector");
    }
    const absoluteUrl = new URL(selected.rawUrl, location.href);
    if (!isAllowedArtifactUrl(absoluteUrl)) {
      throw new Error("visible artifact URL is outside the allowed Overleaf page scope");
    }
    const response = await fetch(absoluteUrl.toString(), {
      credentials: "include",
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`artifact download failed with HTTP ${response.status}`);
    }
    const contentLength = Number(response.headers.get("content-length") || "0");
    if (contentLength > maxBytes) {
      throw new Error(`artifact exceeds maxBytes before download: ${contentLength} > ${maxBytes}`);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new Error(`artifact exceeds maxBytes after download: ${buffer.byteLength} > ${maxBytes}`);
    }
    const mimeType = response.headers.get("content-type") || "";
    const contentDisposition = response.headers.get("content-disposition") || "";
    return {
      ...getProjectMeta(),
      ok: true,
      type: selected.type,
      source: selected.source,
      label: selected.label,
      url: selected.url,
      selectedIndex: selected.index,
      fileName: artifactFileName(selected, absoluteUrl, contentDisposition),
      mimeType,
      byteLength: buffer.byteLength,
      base64: arrayBufferToBase64(buffer)
    };
  }

  function classifyArtifact(rawUrl, label) {
    const value = `${rawUrl || ""} ${label || ""}`.toLowerCase();
    if (!value.trim()) return "";
    if (/\.pdf(?:[?#]|$)|\bpdf\b|download pdf|view pdf/.test(value)) return "pdf";
    if (/\.bbl(?:[?#]|$)|\bbbl\b/.test(value)) return "bbl";
    if (/\.aux(?:[?#]|$)|\baux\b/.test(value)) return "aux";
    if (/\.blg(?:[?#]|$)|\bblg\b/.test(value)) return "blg";
    if (/\.log(?:[?#]|$)|compile log|logs and output files|output log|\blog\b/.test(value)) return "log";
    if (/download|output file|generated file|sync(?:tex)?/.test(value)) return "download";
    return "";
  }

  function selectArtifactCandidate(artifacts, payload) {
    const indexValue = payload.artifactIndex;
    if (Number.isInteger(indexValue) && indexValue >= 0 && indexValue < artifacts.length) {
      return { ...artifacts[indexValue], index: indexValue };
    }
    const wantedType = String(payload.artifactType || "").toLowerCase();
    const labelNeedle = String(payload.labelContains || "").toLowerCase();
    for (let index = 0; index < artifacts.length; index += 1) {
      const artifact = artifacts[index];
      if (!artifact.rawUrl || artifact.actionOnly) continue;
      if (wantedType && artifact.type !== wantedType) continue;
      if (labelNeedle && !String(artifact.label || "").toLowerCase().includes(labelNeedle)) continue;
      return { ...artifact, index };
    }
    return null;
  }

  function isAllowedArtifactUrl(url) {
    if (url.protocol === "blob:") return true;
    if (!["https:", "http:"].includes(url.protocol)) return false;
    return url.hostname === location.hostname && url.hostname.endsWith("overleaf.com");
  }

  function artifactFileName(artifact, url, contentDisposition) {
    const dispositionMatch = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(contentDisposition || "");
    const dispositionName = dispositionMatch ? safeDecodeURIComponent(dispositionMatch[1].replace(/"/g, "")) : "";
    const urlName = url.pathname.split("/").filter(Boolean).pop() || "";
    const labelName = String(artifact.label || "").split("|")[0].trim();
    const base = dispositionName || urlName || labelName || artifact.type || "artifact";
    const cleaned = cleanText(base).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 120) || "artifact";
    if (/\.[A-Za-z0-9]{1,8}$/.test(cleaned)) return cleaned;
    const extension = artifactExtension(artifact.type);
    return `${cleaned}.${extension}`;
  }

  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(value);
    } catch (_) {
      return String(value || "");
    }
  }

  function artifactExtension(type) {
    return {
      pdf: "pdf",
      bbl: "bbl",
      aux: "aux",
      blg: "blg",
      log: "log"
    }[String(type || "").toLowerCase()] || "bin";
  }

  function clampMaxBytes(value) {
    const requested = Number(value || 10 * 1024 * 1024);
    if (!Number.isFinite(requested) || requested <= 0) return 10 * 1024 * 1024;
    return Math.min(Math.floor(requested), 25 * 1024 * 1024);
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  function inspectFileOperationUi() {
    const controls = [];
    const seen = new Set();
    for (const { element, label, operation, score } of getVisibleOperationControlCandidates()) {
      const key = `${operation}:${element.tagName}:${label}`.slice(0, 500);
      if (seen.has(key)) continue;
      seen.add(key);
      controls.push({
        operation,
        source: element.tagName.toLowerCase(),
        role: element.getAttribute("role") || "",
        label: label.slice(0, 160),
        visible: isElementVisible(element),
        disabled: isDisabledControl(element),
        score,
        actionOnly: true
      });
      if (controls.length >= 80) break;
    }
    const visibleFolders = collectFileTreeEntries().filter((entry) => entry.kind === "folder")
      .map((folder) => ({
        folderName: folder.fileName,
        path: folder.path,
        selected: folder.selected,
        depth: folder.depth,
        expanded: folder.expanded
      }));
    return {
      ...getProjectMeta(),
      fileOperationUiSchemaVersion: FILE_OPERATION_UI_SCHEMA_VERSION,
      capabilities: {
        rankedOperationControls: true,
        visibleFolders: true,
        scopedFileDialogInputs: true
      },
      selectedFile: getProjectMeta().fileName || "",
      controlCount: controls.length,
      visibleFolderCount: visibleFolders.length,
      visibleFolders,
      controls
    };
  }

  function inspectUploadWorkflow() {
    const uploadControls = [];
    const seenControls = new Set();
    const controls = Array.from(document.querySelectorAll([
      "input[type='file']",
      "button",
      "[role='button']",
      "[role='menuitem']",
      "a[href]",
      "[aria-label]",
      "[title]",
      "[data-testid]"
    ].join(",")));
    for (const element of controls) {
      const label = cleanText([
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-testid"),
        element.getAttribute("name"),
        labelForInput(element)
      ].filter(Boolean).join(" | "));
      const operation = classifyFileOperationControl(label, element);
      if (operation !== "upload") continue;
      const key = `${element.tagName}:${label}:${element.getAttribute("accept") || ""}`.slice(0, 500);
      if (seenControls.has(key)) continue;
      seenControls.add(key);
      uploadControls.push({
        source: element.tagName.toLowerCase(),
        role: element.getAttribute("role") || "",
        label: label.slice(0, 160),
        visible: isElementVisible(element),
        disabled: isDisabledControl(element),
        accept: element.getAttribute("accept") || "",
        multiple: Boolean(element.multiple),
        directory: Boolean(element.webkitdirectory || element.getAttribute("webkitdirectory") !== null),
        actionOnly: true
      });
      if (uploadControls.length >= 80) break;
    }

    const dropzones = collectUploadDropzones();
    const imageCandidates = collectVisibleImageCandidates();
    const acceptValues = Array.from(new Set(uploadControls.map((control) => control.accept).filter(Boolean))).sort();
    const blockers = [
      "Browser security prevents content scripts from assigning local files to input[type=file].",
      "Automated upload requires explicit user file-picker interaction, a drag-and-drop user gesture, or a future approved extension/native helper."
    ];
    if (uploadControls.length === 0 && dropzones.length === 0) {
      blockers.push("No visible upload control or drop zone was detected in the current Overleaf page state.");
    }
    return {
      ...getProjectMeta(),
      uploadControlCount: uploadControls.length,
      uploadControls,
      dropzoneCount: dropzones.length,
      dropzones,
      acceptValues,
      imageCandidateCount: imageCandidates.length,
      imageCandidates,
      supportedLocalSelection: false,
      requiresUserFilePicker: true,
      nonMutating: true,
      blockers,
      recommendations: [
        "Use this tool to decide whether upload should remain manual for the current page.",
        "For images, prefer adding files through Overleaf's visible upload dialog, then use bridge read/write tools to reference the uploaded file in LaTeX.",
        "Do not attempt to paste local filesystem paths into the page or expose local file paths to agents."
      ]
    };
  }

  function inspectDownloadWorkflow() {
    const downloadControls = collectDownloadControls();
    const artifacts = collectVisibleArtifacts(false)
      .map((artifact, index) => ({
        kind: "visible-artifact",
        downloadType: artifact.type === "download" ? "output" : artifact.type,
        index,
        source: artifact.source,
        label: artifact.label,
        url: artifact.url || "",
        visible: artifact.visible,
        actionOnly: Boolean(artifact.actionOnly)
      }));
    const fileCandidates = listOpenProjectFiles().files
      .slice(0, 80)
      .map((file, index) => ({
        kind: file.selected ? "selected-source-file" : "source-file",
        downloadType: "source-file",
        index,
        fileName: file.fileName,
        path: file.path,
        selected: Boolean(file.selected),
        depth: file.depth,
        actionOnly: true
      }));
    const seen = new Set();
    const downloadCandidates = [];
    for (const candidate of artifacts.concat(fileCandidates)) {
      const key = `${candidate.kind}:${candidate.downloadType}:${candidate.url || candidate.path || candidate.label || candidate.fileName}`.slice(0, 500);
      if (seen.has(key)) continue;
      seen.add(key);
      downloadCandidates.push(candidate);
      if (downloadCandidates.length >= 120) break;
    }
    const blockers = [
      "This tool is read-only; it does not click Overleaf download controls or fetch files.",
      "Project ZIP and source-file downloads should remain user-confirmed browser actions unless a future guarded download tool is added."
    ];
    if (downloadControls.length === 0 && downloadCandidates.length === 0) {
      blockers.push("No visible download/export control or downloadable candidate was detected in the current Overleaf page state.");
    }
    return {
      ...getProjectMeta(),
      downloadControlCount: downloadControls.length,
      downloadControls,
      downloadCandidateCount: downloadCandidates.length,
      downloadCandidates,
      supportedDirectDownload: false,
      requiresUserConfirmation: true,
      nonMutating: true,
      blockers,
      recommendations: [
        "Use list_visible_artifacts or export_visible_artifact for one visible output artifact when a redacted downloadable URL is available.",
        "Use this inspection before asking a human to download a project ZIP or selected source file from Overleaf.",
        "Do not request cookies, session tokens, Git tokens, or raw private download URLs."
      ]
    };
  }

  function collectDownloadControls() {
    const controls = [];
    const seen = new Set();
    const selectors = [
      "a[href]",
      "button",
      "[role='button']",
      "[role='menuitem']",
      "[aria-label]",
      "[title]",
      "[data-testid]"
    ].join(",");
    for (const element of Array.from(document.querySelectorAll(selectors))) {
      const label = cleanText([
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-testid"),
        element.getAttribute("download")
      ].filter(Boolean).join(" | "));
      const downloadType = classifyDownloadControl(label, element);
      if (!downloadType) continue;
      const rawUrl = element.getAttribute("href") || "";
      const key = `${downloadType}:${element.tagName}:${label}:${rawUrl}`.slice(0, 500);
      if (seen.has(key)) continue;
      seen.add(key);
      controls.push({
        downloadType,
        source: element.tagName.toLowerCase(),
        role: element.getAttribute("role") || "",
        label: label.slice(0, 160),
        url: redactArtifactUrl(rawUrl),
        visible: isElementVisible(element),
        disabled: isDisabledControl(element),
        actionOnly: !rawUrl
      });
      if (controls.length >= 100) break;
    }
    return controls;
  }

  function classifyDownloadControl(label, element) {
    const value = `${label || ""} ${element.getAttribute("href") || ""} ${element.getAttribute("class") || ""}`.toLowerCase();
    if (!value.trim()) return "";
    if (/download project|project zip|zip file|\/download\/project|download source|source zip|download as zip/.test(value)) return "project-zip";
    if (/download pdf|pdf download|view pdf|\.pdf(?:[?#]|$)|\bpdf\b/.test(value)) return "pdf";
    if (/logs and output|download log|compile log|\.log(?:[?#]|$)|\blog\b/.test(value)) return "log";
    if (/download selected|download file|download source file|source file/.test(value)) return "source-file";
    if (/download output|output file|generated file|sync(?:tex)?|\.bbl(?:[?#]|$)|\.aux(?:[?#]|$)|\.blg(?:[?#]|$)/.test(value)) return "output";
    if (/\bdownload\b|export/.test(value)) return "download";
    return "";
  }

  function inspectVisibleComments() {
    const threads = collectVisibleCommentThreads();
    const actionControls = collectVisibleCommentActionControls();
    const blockers = [
      "This tool is read-only; replying, resolving, reopening, or deleting comments is intentionally not automated.",
      "Any future comment write action must require an explicit user confirmation step and a fresh visible-thread check."
    ];
    if (threads.length === 0 && actionControls.length === 0) {
      blockers.push("No visible comment or review-thread UI was detected in the current Overleaf page state.");
    }
    return {
      ...getProjectMeta(),
      threadCount: threads.length,
      threads,
      actionControlCount: actionControls.length,
      actionControls,
      nonMutating: true,
      supportsWriteActions: false,
      requiresUserConfirmation: true,
      blockers,
      recommendations: [
        "Use this tool before asking an agent to reason about visible Overleaf comments or review threads.",
        "Open the comments/review panel in Overleaf first if no threads are reported.",
        "Use execute_comment_action only after prepare_comment_action and explicit user approval for the exact action."
      ]
    };
  }

  function collectVisibleCommentThreads() {
    return collectVisibleCommentThreadEntries().map((entry) => entry.thread);
  }

  function collectVisibleCommentThreadEntries() {
    const threads = [];
    const seen = new Set();
    const selectors = [
      "[role='comment']",
      "[role='article']",
      "[role='listitem']",
      "[aria-label]",
      "[title]",
      "[data-testid]",
      ".comment",
      ".comments",
      ".review",
      ".review-panel",
      "[class*='comment']",
      "[class*='review']",
      "[class*='annotation']",
      "[class*='thread']"
    ].join(",");
    for (const element of Array.from(document.querySelectorAll(selectors))) {
      const label = cleanText([
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-testid"),
        element.getAttribute("class")
      ].filter(Boolean).join(" | "));
      const text = cleanText(element.textContent || "");
      const haystack = `${label} ${text}`.toLowerCase();
      if (!/\b(comment|review|reply|resolve|reopen|thread|annotation|suggestion)\b/.test(haystack)) continue;
      if (text.length > 1200 && !/\b(comment|review|thread|annotation)\b/.test(label.toLowerCase())) continue;
      const preview = text.slice(0, 220);
      const key = `${element.tagName}:${label}:${preview}`.slice(0, 500);
      if (seen.has(key)) continue;
      seen.add(key);
      const actions = commentActionsInside(element);
      threads.push({
        element,
        thread: {
          source: element.tagName.toLowerCase(),
          role: element.getAttribute("role") || "",
          label: label.slice(0, 160),
          preview,
          visible: isElementVisible(element),
          resolved: /\b(resolved|closed)\b/i.test(haystack),
          lineNumber: findNearestLineNumber(element),
          actionCount: actions.length,
          actions
        }
      });
      if (threads.length >= 40) break;
    }
    return threads;
  }

  async function executeCommentAction(payload) {
    const action = String(payload.action || "").toLowerCase();
    const threadIndex = Number(payload.threadIndex);
    const replyText = String(payload.replyText || "");
    if (!["reply", "resolve", "reopen", "delete-comment"].includes(action)) throw new Error("unsupported comment action");
    if (!Number.isInteger(threadIndex) || threadIndex < 0) throw new Error("execute_comment_action requires threadIndex");
    if (action === "reply" && !replyText.trim()) throw new Error("execute_comment_action reply requires replyText");

    const entries = collectVisibleCommentThreadEntries();
    const entry = entries.find((candidate, index) => index === threadIndex || candidate.thread.threadIndex === threadIndex);
    if (!entry) throw new Error("selected comment thread not found");
    const button = findCommentActionControl(entry.element, action);
    if (!button) throw new Error(`visible ${action} comment control not found`);
    button.click();
    await sleep(500);
    if (action === "reply") {
      await fillCommentReplyAndSubmit(replyText);
    } else if (action === "delete-comment") {
      await clickConfirmationButton(["Delete", "Remove", "OK"]);
    }
    await sleep(900);
    return {
      ...getProjectMeta(),
      action,
      threadIndex,
      executed: true,
      replyTextLength: action === "reply" ? replyText.length : 0
    };
  }

  function collectVisibleCommentActionControls() {
    const controls = [];
    const seen = new Set();
    const selectors = [
      "button",
      "[role='button']",
      "[role='menuitem']",
      "a[href]",
      "[aria-label]",
      "[title]",
      "[data-testid]"
    ].join(",");
    for (const element of Array.from(document.querySelectorAll(selectors))) {
      const label = cleanText([
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-testid")
      ].filter(Boolean).join(" | "));
      const action = classifyCommentAction(label);
      if (!action) continue;
      const key = `${action}:${element.tagName}:${label}`.slice(0, 500);
      if (seen.has(key)) continue;
      seen.add(key);
      controls.push({
        action,
        source: element.tagName.toLowerCase(),
        role: element.getAttribute("role") || "",
        label: label.slice(0, 160),
        visible: isElementVisible(element),
        disabled: isDisabledControl(element),
        actionOnly: true
      });
      if (controls.length >= 80) break;
    }
    return controls;
  }

  function commentActionsInside(root) {
    const actions = [];
    const seen = new Set();
    for (const element of Array.from(root.querySelectorAll("button, [role='button'], [role='menuitem'], a[href], [aria-label], [title], [data-testid]"))) {
      const label = cleanText([
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-testid")
      ].filter(Boolean).join(" | "));
      const action = classifyCommentAction(label);
      if (!action) continue;
      const key = `${action}:${label}`.slice(0, 300);
      if (seen.has(key)) continue;
      seen.add(key);
      actions.push({
        action,
        label: label.slice(0, 120),
        visible: isElementVisible(element),
        disabled: isDisabledControl(element),
        actionOnly: true
      });
      if (actions.length >= 10) break;
    }
    return actions;
  }

  function findCommentActionControl(root, action) {
    return Array.from(root.querySelectorAll("button, [role='button'], [role='menuitem'], a[href], [aria-label], [title], [data-testid]"))
      .find((element) => {
        if (!isElementVisible(element) || isDisabledControl(element)) return false;
        const label = cleanText([
          element.textContent,
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("data-testid")
        ].filter(Boolean).join(" | "));
        return classifyCommentAction(label) === action;
      });
  }

  async function fillCommentReplyAndSubmit(text) {
    const input = findVisibleCommentInput();
    if (!input) throw new Error("comment reply input not found");
    input.focus();
    if (input.isContentEditable) {
      input.textContent = text;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    } else {
      input.value = "";
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: "" }));
      input.value = text;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await sleep(300);
    await clickConfirmationButton(["Reply", "Send", "Comment", "Post"]);
  }

  function findVisibleCommentInput() {
    return Array.from(document.querySelectorAll("textarea, [contenteditable='true'], input[type='text'], input:not([type])"))
      .find((input) => {
        if (!isElementVisible(input) || isDisabledControl(input)) return false;
        if (input.closest(".cm-editor")) return false;
        const label = cleanText([
          input.getAttribute("aria-label"),
          input.getAttribute("placeholder"),
          input.getAttribute("title"),
          input.getAttribute("class")
        ].filter(Boolean).join(" | ")).toLowerCase();
        return !label || /\b(reply|comment|message|write|respond)\b/.test(label);
      });
  }

  function classifyCommentAction(label) {
    const value = String(label || "").toLowerCase();
    if (/\breply\b|add reply|respond/.test(value)) return "reply";
    if (/\bresolve\b|mark resolved/.test(value)) return "resolve";
    if (/\breopen\b|unresolve/.test(value)) return "reopen";
    if (/\bdelete\b.*\bcomment\b|remove comment/.test(value)) return "delete-comment";
    if (/\bcomment\b|review comment|add comment/.test(value)) return "comment";
    return "";
  }

  function collectUploadDropzones() {
    const zones = [];
    const seen = new Set();
    for (const element of Array.from(document.querySelectorAll("[aria-label], [title], [data-testid], .dropzone, [class*='drop'], [class*='upload']"))) {
      const label = cleanText([
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-testid"),
        element.getAttribute("class")
      ].filter(Boolean).join(" | "));
      if (!/\b(drop|drag|upload|import)\b/i.test(label)) continue;
      const key = `${element.tagName}:${label}`.slice(0, 500);
      if (seen.has(key)) continue;
      seen.add(key);
      zones.push({
        source: element.tagName.toLowerCase(),
        role: element.getAttribute("role") || "",
        label: label.slice(0, 160),
        visible: isElementVisible(element),
        disabled: isDisabledControl(element),
        actionOnly: true
      });
      if (zones.length >= 40) break;
    }
    return zones;
  }

  function collectVisibleImageCandidates() {
    return listOpenProjectFiles().files
      .filter((file) => /\.(png|jpe?g|pdf|eps|svg)$/i.test(file.fileName || file.path || ""))
      .slice(0, 80)
      .map((file) => ({
        fileName: file.fileName,
        path: file.path,
        selected: Boolean(file.selected),
        depth: file.depth
      }));
  }

  function labelForInput(element) {
    if (!element || element.tagName.toLowerCase() !== "input") return "";
    const id = element.getAttribute("id");
    if (!id) return "";
    const label = document.querySelector(`label[for="${cssEscape(id)}"]`);
    return label ? label.textContent : "";
  }

  const FILE_OPERATION_CONTROL_SELECTOR = [
    "button",
    "[role='button']",
    "[role='menuitem']",
    "a[href]",
    "input[type='file']",
    "[aria-label]",
    "[title]",
    "[data-testid]"
  ].join(",");

  function getControlLabel(element) {
    return cleanText([
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid"),
      element.getAttribute("name"),
      labelForInput(element)
    ].filter(Boolean).join(" | "));
  }

  function isActionableFileOperationElement(element) {
    if (!element) return false;
    const tagName = String(element.tagName || "").toLowerCase();
    const role = String(element.getAttribute("role") || "").toLowerCase();
    const inputType = String(element.getAttribute("type") || "").toLowerCase();
    if (tagName === "input" && inputType === "file") return true;
    if (tagName === "button") return true;
    if (tagName === "a" && element.getAttribute("href")) return true;
    if (tagName === "input" && ["button", "submit", "reset"].includes(inputType)) return true;
    return role === "button" || role === "menuitem";
  }

  function looksLikeMixedOperationContainer(label) {
    const value = String(label || "").toLowerCase();
    if (value.length < 100) return false;
    const hits = [
      /new file/.test(value),
      /new folder/.test(value),
      /upload/.test(value),
      /delete|remove|trash/.test(value),
      /rename|move/.test(value),
      /file tree/.test(value)
    ].filter(Boolean).length;
    return hits >= 2;
  }

  function classifyFileOperationControl(label, element) {
    const labelValue = String(label || "").toLowerCase();
    const classValue = String(element.getAttribute("class") || "").toLowerCase();
    const value = `${labelValue} ${classValue}`;
    const inputType = String(element.getAttribute("type") || "").toLowerCase();
    if (inputType === "file") return "upload";
    if (!isActionableFileOperationElement(element)) return "";
    if (looksLikeMixedOperationContainer(label)) return "";
    if (/\b(new|add|create)\b.*\b(file|folder|project file)\b|new file|new folder|add file|add folder|create file|新建文件|新建目录|新建文件夹/.test(value)) return "create";
    if (/\b(rename|move)\b|rename file|move file|重命名|移动文件/.test(value)) return "rename";
    if (!/\bzoom out\b|缩小/.test(labelValue) && (/\b(delete|remove|trash)\b|delete file|remove file|删除/.test(value))) return "delete";
    if (/\b(upload|import)\b.*\b(file|image|figure|project)\b|upload file|upload image|上传/.test(value)) return "upload";
    if (/more_vert|more actions|file actions|file menu|操作菜单/.test(labelValue) || /more_vert/.test(classValue)) return "file-menu";
    return "";
  }

  function scoreFileOperationControl(operation, element, label) {
    const tagName = String(element.tagName || "").toLowerCase();
    const role = String(element.getAttribute("role") || "").toLowerCase();
    const inputType = String(element.getAttribute("type") || "").toLowerCase();
    const value = String(label || "").toLowerCase().replace(/\s+/g, " ").trim();
    let score = 0;
    if (tagName === "button") score += 60;
    else if (role === "button") score += 50;
    else if (role === "menuitem") score += 42;
    else if (tagName === "input" && inputType === "file") score += 45;
    else if (tagName === "a") score += 25;
    else score -= 100;

    if (operation === "create") {
      if (value === "new file" || value === "note_addnew file" || value === "note_add new file") score += 100;
      if (/^note_add\s*new file$/.test(value)) score += 90;
      if (/\bnew file\b/.test(value)) score += 70;
      if (/description\s*new file/.test(value)) score += 35;
      if (/\bnew folder\b|create_new_folder/.test(value)) score -= 60;
      if (/\bupload\b/.test(value)) score -= 40;
    } else if (operation === "rename") {
      if (/\brename\b/.test(value)) score += 80;
      if (/\bmove\b/.test(value)) score += 30;
    } else if (operation === "delete") {
      if (/\bdelete\b|\bremove\b|\btrash\b/.test(value)) score += 80;
    } else if (operation === "upload") {
      if (inputType === "file") score += 80;
      if (/\bupload\b|\bimport\b/.test(value)) score += 60;
    }

    if (looksLikeMixedOperationContainer(label)) score -= 160;
    if (value.length > 180) score -= 80;
    if (isDisabledControl(element)) score -= 200;
    return score;
  }

  function rankFileOperationControlElements(elements, operationFilter = "") {
    return Array.from(elements || [])
      .map((element, index) => {
        const label = getControlLabel(element);
        const operation = classifyFileOperationControl(label, element);
        if (!operation || (operationFilter && operation !== operationFilter)) return null;
        if (!isElementVisible(element) || isDisabledControl(element)) return null;
        return {
          element,
          label,
          operation,
          score: scoreFileOperationControl(operation, element, label),
          index
        };
      })
      .filter((candidate) => candidate && candidate.score > 0)
      .sort((a, b) => (b.score - a.score) || (a.index - b.index));
  }

  function getVisibleOperationControlCandidates(operation = "") {
    return rankFileOperationControlElements(document.querySelectorAll(FILE_OPERATION_CONTROL_SELECTOR), operation);
  }

  function isDisabledControl(element) {
    return Boolean(element.disabled) ||
      element.getAttribute("aria-disabled") === "true" ||
      element.classList.contains("disabled");
  }

  async function executeFileOperation(payload) {
    const operation = String(payload.operation || "").toLowerCase();
    const fileName = String(payload.fileName || "");
    const newFileName = String(payload.newFileName || "");
    if (!["create", "rename", "delete"].includes(operation)) throw new Error("unsupported file operation");
    if (!fileName) throw new Error("execute_file_operation requires fileName");
    if (operation === "rename" && !newFileName) throw new Error("execute_file_operation rename requires newFileName");

    if (operation === "create") {
      const createName = await selectParentFolderForCreate(fileName);
      assertNoBlockingDialog();
      await clickOperationControl("create", "");
      await fillDialogTextAndConfirm(createName, ["Create", "Add", "OK", "创建", "新建", "确定"], "create");
      const created = await revealFileTreeItem(fileName, 6000);
      if (!created) {
        throw new Error(`created file is not visible in the Overleaf file tree: ${fileName}`);
      }
      created.click();
    } else if (operation === "rename") {
      await openFile(fileName);
      await clickOperationControl("rename", fileName);
      await fillDialogTextAndConfirm(newFileName, ["Rename", "Save", "OK", "重命名", "保存", "确定"], "rename");
    } else if (operation === "delete") {
      await openFile(fileName);
      await clickOperationControl("delete", fileName);
      await clickConfirmationButton(["Delete", "Remove", "OK", "删除", "移除", "确定"]);
    }
    await sleep(1200);
    return {
      ...getProjectMeta(),
      operation,
      fileName,
      newFileName,
      executed: true
    };
  }

  async function clickOperationControl(operation, fileName) {
    const direct = findVisibleOperationControl(operation);
    if (direct) {
      direct.click();
      await sleep(500);
      return;
    }
    if (operation === "create") {
      const launcher = findVisibleCreateMenuLauncher();
      if (launcher) {
        launcher.click();
        await sleep(500);
        const afterMenu = findVisibleOperationControl("create");
        if (afterMenu) {
          afterMenu.click();
          await sleep(500);
          return;
        }
      }
    }
    if (fileName) {
      const item = findFileTreeItem(fileName);
      if (item) {
        item.scrollIntoView({ block: "center" });
        const menu = Array.from(item.querySelectorAll("button, [role='button']"))
          .find((button) => /more_vert|menu|actions/i.test(cleanText([button.textContent, button.getAttribute("aria-label"), button.getAttribute("title")].filter(Boolean).join(" "))));
        if (menu) {
          menu.click();
          await sleep(500);
          const afterMenu = findVisibleOperationControl(operation);
          if (afterMenu) {
            afterMenu.click();
            await sleep(500);
            return;
          }
        }
      }
    }
    throw new Error(`visible ${operation} file control not found`);
  }

  function findVisibleCreateMenuLauncher() {
    const candidates = getVisibleOperationControlCandidates("file-menu")
      .filter(({ element }) => !element.closest("[role='treeitem']") && !element.closest("li"))
      .map((candidate) => {
        const label = candidate.label.toLowerCase();
        const fileTreeContext = candidate.element.closest("[data-testid*='file'], [class*='file-tree'], [aria-label*='file']");
        return {
          ...candidate,
          launcherScore: candidate.score
            + (fileTreeContext ? 80 : 0)
            + (/\b(file|project|add|new)\b|note_add/.test(label) ? 60 : 0)
        };
      })
      .sort((a, b) => (b.launcherScore - a.launcherScore) || (a.index - b.index));
    return candidates.length ? candidates[0].element : null;
  }

  function findVisibleOperationControl(operation) {
    const candidates = getVisibleOperationControlCandidates(operation);
    return candidates.length ? candidates[0].element : null;
  }

  async function fillDialogTextAndConfirm(text, buttonLabels, operation = "") {
    const input = findVisibleDialogTextInput(operation);
    if (!input) throw new Error("file operation dialog text input not found");
    const dialog = input.closest("[role='dialog'], [aria-modal='true'], .modal, [class*='dialog'], [class*='popover']");
    input.focus();
    setNativeTextInputValue(input, text);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(300);
    await clickConfirmationButton(buttonLabels, dialog || document);
    if (dialog) {
      const closed = await waitForElementToHide(dialog, 2500);
      if (!closed) throw new Error("file operation dialog remained open after confirmation");
    }
  }

  function setNativeTextInputValue(input, value) {
    const tagName = String(input && input.tagName || "").toLowerCase();
    const constructor = tagName === "textarea" ? window.HTMLTextAreaElement : window.HTMLInputElement;
    const descriptor = constructor && Object.getOwnPropertyDescriptor(constructor.prototype, "value");
    if (descriptor && typeof descriptor.set === "function") descriptor.set.call(input, value);
    else input.value = value;
  }

  async function waitForElementToHide(element, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (!element.isConnected || !isElementVisible(element)) return true;
      await sleep(50);
    }
    return false;
  }

  function assertNoBlockingDialog() {
    const dialog = Array.from(document.querySelectorAll("[role='dialog'], [aria-modal='true'], .modal, [class*='dialog']"))
      .find((candidate) => isElementVisible(candidate));
    if (!dialog) return;
    const label = cleanText([
      dialog.textContent,
      dialog.getAttribute("aria-label"),
      dialog.getAttribute("title")
    ].filter(Boolean).join(" ")).slice(0, 120);
    throw new Error(`close the visible Overleaf dialog before creating a file${label ? `: ${label}` : ""}`);
  }

  function findVisibleDialogTextInput(operation = "") {
    const scopedInputs = Array.from(document.querySelectorAll([
      "[role='dialog'] input",
      "[role='dialog'] textarea",
      "[aria-modal='true'] input",
      "[aria-modal='true'] textarea",
      ".modal input",
      ".modal textarea",
      "[class*='dialog'] input",
      "[class*='dialog'] textarea",
      "[class*='popover'] input",
      "[class*='popover'] textarea"
    ].join(",")));
    const rankedScoped = rankDialogTextInputElements(scopedInputs, operation);
    if (rankedScoped.length) return rankedScoped[0].input;
    const rankedGlobal = rankDialogTextInputElements(document.querySelectorAll("input, textarea"), operation);
    return rankedGlobal.length ? rankedGlobal[0].input : null;
  }

  function getInputLabel(input) {
    return cleanText([
      input.getAttribute("aria-label"),
      input.getAttribute("title"),
      input.getAttribute("placeholder"),
      input.getAttribute("name"),
      input.getAttribute("id"),
      labelForInput(input)
    ].filter(Boolean).join(" | "));
  }

  function isFileOperationTextInput(input) {
    if (!input || !isElementVisible(input) || isDisabledControl(input) || input.closest(".cm-editor")) return false;
    const tagName = String(input.tagName || "").toLowerCase();
    const type = String(input.getAttribute("type") || "").toLowerCase();
    if (tagName === "textarea") return true;
    if (tagName !== "input") return false;
    if (["email", "password", "search", "url", "tel", "number", "file", "checkbox", "radio", "hidden", "submit", "button"].includes(type)) return false;
    const label = getInputLabel(input).toLowerCase();
    if (/\b(email|e-mail|share|collaborator|invite|message|comment|search|filter)\b|邮件|邮箱|共享|协作者|邀请|评论|搜索|筛选/.test(label)) return false;
    return !type || type === "text";
  }

  function scoreDialogTextInput(input, operation = "") {
    const label = getInputLabel(input).toLowerCase();
    const tagName = String(input.tagName || "").toLowerCase();
    let score = 0;
    if (tagName === "input") score += 30;
    if (tagName === "textarea") score += 10;
    if (input.closest("[role='dialog'], [aria-modal='true'], .modal, [class*='dialog'], [class*='popover']")) score += 45;
    if (/\b(file|filename|file name|name|path|new|rename)\b|文件名|文件|名称|路径|新建|重命名/.test(label)) score += 70;
    if (operation === "create" && (/\b(new|create|file|filename|name)\b|文件名|新建|创建/.test(label))) score += 30;
    if (operation === "rename" && (/\b(rename|file|filename|name)\b|文件名|重命名/.test(label))) score += 30;
    if (/\b(email|e-mail|share|collaborator|invite|message|comment|search|filter)\b|邮件|邮箱|共享|协作者|邀请|评论|搜索|筛选/.test(label)) score -= 120;
    return score;
  }

  function rankDialogTextInputElements(inputs, operation = "") {
    return Array.from(inputs || [])
      .map((input, index) => {
        if (!isFileOperationTextInput(input)) return null;
        return { input, score: scoreDialogTextInput(input, operation), index };
      })
      .filter((candidate) => candidate && candidate.score > 0)
      .sort((a, b) => (b.score - a.score) || (a.index - b.index));
  }

  async function clickConfirmationButton(labels, scope = document) {
    const normalized = labels.map((label) => label.toLowerCase());
    const candidates = Array.from(scope.querySelectorAll("button, [role='button']"))
      .map((candidate, index) => {
        if (!isElementVisible(candidate) || isDisabledControl(candidate)) return false;
        const label = cleanText([candidate.textContent, candidate.getAttribute("aria-label"), candidate.getAttribute("title")].filter(Boolean).join(" ")).toLowerCase();
        const exact = normalized.some((needle) => label === needle);
        const partial = normalized.some((needle) => label.includes(needle));
        if (!partial) return null;
        return { candidate, score: exact ? 100 : 10, index };
      })
      .filter(Boolean)
      .sort((a, b) => (b.score - a.score) || (a.index - b.index));
    const button = candidates.length ? candidates[0].candidate : null;
    if (!button) throw new Error(`confirmation button not found: ${labels.join("/")}`);
    button.click();
    await sleep(500);
  }

  function getSelectionPayload() {
    const selection = window.getSelection();
    const text = selection ? String(selection.toString()) : "";
    const fullText = readEditorText();
    const index = text ? fullText.indexOf(text) : -1;
    return {
      ...getProjectMeta(),
      selectedText: text,
      hasSelection: Boolean(text),
      startOffsetApprox: index,
      endOffsetApprox: index >= 0 ? index + text.length : -1,
      contextBefore: index >= 0 ? fullText.slice(Math.max(0, index - 300), index) : "",
      contextAfter: index >= 0 ? fullText.slice(index + text.length, index + text.length + 300) : ""
    };
  }
  function getEditorDiagnostics() {
    const meta = getProjectMeta();
    const selectors = [
      ".cm-diagnostic",
      ".cm-tooltip",
      ".cm-tooltip-lint",
      ".cm-panel",
      ".cm-lintRange",
      ".cm-lintRange-error",
      ".cm-lintRange-warning",
      "[role='tooltip']",
      "[data-diagnostic]",
      "[data-lint]"
    ];
    const pattern = /invalid|error|warning|documentclass|undefined|missing|emergency|fatal|latex/i;
    const seen = new Set();
    const diagnostics = [];
    for (const element of Array.from(document.querySelectorAll(selectors.join(",")))) {
      const text = cleanText(element.textContent || "");
      const title = cleanText(element.getAttribute("title") || "");
      const ariaLabel = cleanText(element.getAttribute("aria-label") || "");
      const className = String(element.className || "");
      const combined = cleanText([text, title, ariaLabel].filter(Boolean).join(" | "));
      const looksLikeDiagnosticDom = /cm-diagnostic|cm-tooltip|cm-panel|cm-lint|diagnostic|lint/i.test(className) || element.getAttribute("role") === "tooltip";
      if (!looksLikeDiagnosticDom || !combined || !pattern.test(combined)) continue;
      const key = combined.slice(0, 500);
      if (seen.has(key)) continue;
      seen.add(key);
      diagnostics.push({
        text: text.slice(0, 500),
        title: title.slice(0, 500),
        ariaLabel: ariaLabel.slice(0, 500),
        className,
        role: element.getAttribute("role") || "",
        lineNumber: findNearestLineNumber(element),
        visible: isElementVisible(element)
      });
      if (diagnostics.length >= 50) break;
    }
    return {
      ...meta,
      diagnostics,
      diagnosticCount: diagnostics.length,
      visibleDiagnostics: diagnostics.filter((item) => item.visible)
    };
  }

  function findNearestLineNumber(element) {
    let node = element;
    while (node && node !== document.documentElement) {
      if (node.classList && node.classList.contains("cm-line")) {
        const lineNumber = node.getAttribute("data-line-number") || node.getAttribute("aria-lineindex");
        if (lineNumber) return Number(lineNumber);
      }
      const line = node.querySelector && node.querySelector(".cm-lineNumbers .cm-gutterElement, .cm-lineNumber, [data-line-number]");
      if (line) {
        const value = line.getAttribute("data-line-number") || line.textContent;
        const number = Number(cleanText(value));
        if (Number.isFinite(number)) return number;
      }
      node = node.parentElement;
    }
    return null;
  }

  function isElementVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return Boolean(rect.width || rect.height) && style.visibility !== "hidden" && style.display !== "none";
  }

  function insertText(text) {
    if (!text) throw new Error("insert_text received empty text");
    focusEditor();
    insertViaInput(text);
    return { ...getProjectMeta(), insertedLength: text.length };
  }

  function replaceSelection(replacement) {
    const selection = window.getSelection();
    if (!selection || !String(selection.toString())) {
      throw new Error("no editor selection to replace");
    }
    focusEditor();
    insertViaInput(replacement);
    return { ...getProjectMeta(), replacementLength: replacement.length };
  }

  async function replaceFile(text) {
    const bridged = await callPageBridge("replace", { text });
    if (bridged && bridged.ok) {
      return { ...getProjectMeta(), replacementLength: text.length };
    }
    throw new Error("page bridge replace failed");
  }
  async function ensurePageBridge() {
    const deadline = Date.now() + 5000;
    while (document.documentElement.dataset.overleafCodexPageBridge !== "loaded") {
      if (Date.now() > deadline) throw new Error("page bridge main-world content script not loaded");
      await sleep(50);
    }
  }

  async function callPageBridge(action, payload = {}) {
    await ensurePageBridge();
    const id = `codex-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener("overleaf-codex-page-bridge-result", onResult);
        reject(new Error("page bridge timeout"));
      }, 3000);
      function onResult(event) {
        if (!event.detail || event.detail.id !== id) return;
        clearTimeout(timeout);
        window.removeEventListener("overleaf-codex-page-bridge-result", onResult);
        if (event.detail.ok) resolve(event.detail.payload || {});
        else reject(new Error(event.detail.error || "page bridge failed"));
      }
      window.addEventListener("overleaf-codex-page-bridge-result", onResult);
      window.dispatchEvent(new CustomEvent("overleaf-codex-page-bridge-command", {
        detail: { id, action, payload }
      }));
    });
  }

  async function compileProject() {
    const button = findCompileButton();
    if (!button) throw new Error("Recompile button not found");
    const previousLogSnippet = getCompileStatus();
    const previousActivitySignature = getCompileActivitySignature(button);
    const previousOutputSignature = getCompileOutputSignature();
    button.click();
    const compile = await waitForCompileCompletion(previousLogSnippet, button, {
      previousActivitySignature,
      previousOutputSignature
    });
    if (!compile.completed) {
      return {
        ...getProjectMeta(),
        compileCompleted: false,
        compileTimedOut: true,
        visibleStatus: "Compile incomplete: timed out waiting for fresh Overleaf compile results",
        logSnippet: ""
      };
    }
    const logSnippet = compile.logSnippet;
    const visibleStatus = logSnippet
      ? summarizeVisibleCompileStatus(logSnippet)
      : "Compile completed: PDF output refreshed; log counts unavailable";
    return {
      ...getProjectMeta(),
      compileCompleted: true,
      compileTimedOut: false,
      compileEvidence: compile.evidence || "visible-log",
      visibleStatus,
      logSnippet
    };
  }

  async function waitForCompileCompletion(previousLogSnippet, button, options = {}) {
    const timeoutMs = Number(options.timeoutMs || 25000);
    const pollMs = Number(options.pollMs || 250);
    const settleMs = Number(options.settleMs || 1000);
    const started = Date.now();
    let sawInProgress = false;
    let sawActivity = false;
    let finishedAt = 0;
    let changedAt = started;
    let lastLogSnippet = previousLogSnippet;
    const previousActivitySignature = String(options.previousActivitySignature || "");
    const previousOutputSignature = String(options.previousOutputSignature || "");
    let outputChangedAt = 0;
    while (Date.now() - started < timeoutMs) {
      const currentButton = findCompileButton() || button;
      const inProgress = isCompileInProgress(currentButton);
      const activitySignature = getCompileActivitySignature(currentButton);
      const outputSignature = getCompileOutputSignature();
      const logSnippet = getCompileStatus();
      if (outputSignature && previousOutputSignature && outputSignature !== previousOutputSignature && !outputChangedAt) {
        outputChangedAt = Date.now();
      }
      if (activitySignature && previousActivitySignature && activitySignature !== previousActivitySignature) {
        sawActivity = true;
      }
      if (logSnippet !== lastLogSnippet || (sawActivity && activitySignature !== previousActivitySignature)) {
        lastLogSnippet = logSnippet;
        changedAt = Date.now();
      }
      if (inProgress) {
        sawInProgress = true;
        finishedAt = 0;
      } else if (sawInProgress && !finishedAt) {
        finishedAt = Date.now();
      }
      const settledAfterFinish = finishedAt && Date.now() - Math.max(finishedAt, changedAt) >= settleMs;
      const changedAndSettled = !sawInProgress
        && logSnippet !== previousLogSnippet
        && Date.now() - changedAt >= settleMs;
      const activitySettled = sawActivity
        && !inProgress
        && activitySignature === previousActivitySignature
        && Date.now() - changedAt >= settleMs;
      if (outputChangedAt && Date.now() - outputChangedAt >= settleMs) {
        return {
          completed: true,
          timedOut: false,
          evidence: "pdf-output-refreshed",
          logSnippet: hasCompileResultEvidence(logSnippet) ? logSnippet : ""
        };
      }
      if (hasCompileResultEvidence(logSnippet) && (settledAfterFinish || changedAndSettled || activitySettled)) {
        return { completed: true, timedOut: false, evidence: "visible-log", logSnippet };
      }
      await sleep(pollMs);
    }
    return { completed: false, timedOut: true, logSnippet: "" };
  }

  function isCompileInProgress(button) {
    const candidates = [
      button,
      ...Array.from(document.querySelectorAll('button, [role="status"], [aria-live="polite"], [aria-live="assertive"]'))
    ].filter(Boolean);
    return candidates.some((element) => {
      if (element.disabled || element.getAttribute("aria-busy") === "true") return true;
      const label = cleanText([
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title")
      ].filter(Boolean).join(" "));
      return /\b(compiling|processing compile|stop compile|cancel compile)\b|\u6b63\u5728\u7f16\u8bd1|\u7f16\u8bd1\u4e2d/i.test(label);
    });
  }

  function getCompileActivitySignature(button) {
    if (!button) return "";
    return cleanText([
      button.textContent,
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
      button.getAttribute("aria-busy"),
      button.getAttribute("data-state"),
      button.getAttribute("class"),
      button.disabled ? "disabled" : "enabled"
    ].filter(Boolean).join(" | "));
  }

  function hasCompileResultEvidence(value) {
    return /\b(?:errors?|warnings?)\s*:?\s*\d+\b|\boutput written on\b|\b\d+\s+pages?\b|\ball logs?\s*\d+\b/i.test(String(value || ""));
  }

  function getCompileOutputSignature() {
    const link = Array.from(document.querySelectorAll("a[href]"))
      .find((element) => /\/download\/project\/[^/]+\/build\/[^/]+\/output\/output\.pdf/i.test(element.getAttribute("href") || ""));
    return link ? String(link.getAttribute("href") || "") : "";
  }

  function getCompileStatus() {
    const candidates = Array.from(document.querySelectorAll('[role="status"], .log-entry, .pdf-viewer, button, a'))
      .map((element) => cleanText(element.textContent))
      .filter((text) => /recompile|error|warning|log|output|pdf|page \d+/i.test(text))
      .slice(0, 20);
    return candidates.join(" | ");
  }

  function readEditorText() {
    const editor = getEditorElement();
    if (!editor) throw new Error("Overleaf source editor not found");
    const view = getCodeMirrorView();
    if (view && view.state && view.state.doc) return view.state.doc.toString();
    const textarea = document.querySelector("textarea");
    if (textarea && typeof textarea.value === "string" && textarea.value.length > 0) return textarea.value;
    const cmContent = document.querySelector(".cm-content");
    if (cmContent) {
      const cmLines = Array.from(cmContent.querySelectorAll(".cm-line"));
      if (cmLines.length > 0) return cmLines.map((line) => line.textContent || "").join("\n");
    }
    const lines = Array.from(document.querySelectorAll(".cm-line"));
    if (lines.length > 0) return lines.map((line) => line.textContent || "").join("\n");
    return editor.textContent || "";
  }

  function getEditorElement() {
    return document.querySelector('[aria-label="Source Editor editing"]');
  }

  function getCodeMirrorView() {
    const candidates = [
      document.querySelector(".cm-content"),
      document.querySelector(".cm-editor"),
      getEditorElement()
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

  function focusEditor() {
    const editor = getEditorElement();
    if (!editor) throw new Error("Overleaf source editor not found");
    editor.focus();
  }

  function insertViaInput(text) {
    const editor = getEditorElement();
    if (!editor) throw new Error("Overleaf source editor not found");
    const inputEvent = new InputEvent("beforeinput", {
      inputType: "insertText",
      data: text,
      bubbles: true,
      cancelable: true
    });
    const accepted = editor.dispatchEvent(inputEvent);
    if (accepted) {
      document.execCommand("insertText", false, text);
    }
    editor.dispatchEvent(new InputEvent("input", {
      inputType: "insertText",
      data: text,
      bubbles: true
    }));
  }

  function selectEditorAll() {
    const editor = getEditorElement();
    if (!editor) throw new Error("Overleaf source editor not found");
    editor.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    document.execCommand("selectAll", false, null);
  }

  function collectFileTreeEntries() {
    const root = findFileTreeRoot();
    const items = root ? root.querySelectorAll('[role="treeitem"]') : document.querySelectorAll('[role="treeitem"]');
    return collectFileTreeEntriesFromItems(items, { root, trustFileTreeRoot: Boolean(root) });
  }

  function collectFileTreeEntriesFromItems(items, options = {}) {
    const entries = [];
    const folderStack = [];
    for (const item of Array.from(items || [])) {
      if (isOutlineTreeItem(item)) continue;
      const fileName = extractFileName(item);
      if (!fileName) continue;
      const depth = getFileTreeItemDepth(item, options.root);
      while (folderStack.length >= depth) folderStack.pop();
      const selected = item.getAttribute("aria-selected") === "true";
      const isFile = isFileLikeName(fileName);
      const isFolder = !isFile && (looksLikeFileTreeFolderItem(item) || options.trustFileTreeRoot);
      if (isFile) {
        entries.push({
          kind: "file",
          fileName,
          path: [...folderStack, fileName].join("/"),
          selected,
          depth,
          element: item
        });
      } else if (isFolder) {
        const path = [...folderStack, fileName].join("/");
        entries.push({
          kind: "folder",
          fileName,
          path,
          selected,
          depth,
          expanded: item.getAttribute("aria-expanded") === "true",
          element: item
        });
        folderStack[depth - 1] = fileName;
        folderStack.length = depth;
      }
    }
    return entries;
  }

  function findFileTreeRoot() {
    const explicit = rankFileTreeRootCandidates(document.querySelectorAll([
      "[role='tree']",
      "[aria-label*='File tree' i]",
      "[data-testid*='file-tree' i]",
      "[class*='file-tree' i]",
      "[class*='fileTree']",
      "[class*='project-entities' i]"
    ].join(",")));
    if (explicit.length) return explicit[0].element;

    const newFile = getVisibleOperationControlCandidates("create")
      .find((candidate) => /\bnew file\b/i.test(candidate.label));
    if (!newFile) return null;
    const ancestors = [];
    let node = newFile.element.parentElement;
    while (node && node !== document.body && node !== document.documentElement && ancestors.length < 12) {
      ancestors.push(node);
      node = node.parentElement;
    }
    const ranked = rankFileTreeRootCandidates(ancestors);
    return ranked.length ? ranked[0].element : null;
  }

  function rankFileTreeRootCandidates(elements) {
    return Array.from(elements || [])
      .map((element, index) => {
        if (!element || !isElementVisible(element)) return null;
        const treeItems = Array.from(element.querySelectorAll ? element.querySelectorAll('[role="treeitem"]') : []);
        if (treeItems.length === 0) return null;
        const names = treeItems.map(extractFileName).filter(Boolean);
        const fileCount = names.filter(isFileLikeName).length;
        const fileTreeItems = treeItems.filter((item) => !isOutlineTreeItem(item));
        const folderSignals = fileTreeItems.filter((item) => looksLikeFileTreeFolderItem(item) || !isFileLikeName(extractFileName(item))).length;
        const text = cleanText([
          element.getAttribute("aria-label"),
          element.getAttribute("data-testid"),
          element.getAttribute("class"),
          element.textContent
        ].filter(Boolean).join(" "));
        let score = 0;
        if (/file tree|file-tree|filetree|project-entities/i.test(text)) score += 80;
        if (/\bnew file\b/i.test(text)) score += 25;
        score += Math.min(fileCount, 20) * 6;
        score += Math.min(folderSignals, 8) * 4;
        if (/file-tree-list-root|file-tree/i.test(text)) score += 40;
        if (/\\(?:section|subsection|textit)\b|related work|method|conclusion/i.test(text) && fileCount === 0) score -= 80;
        if (treeItems.length > 120) score -= 30;
        return { element, score, index };
      })
      .filter((candidate) => candidate && candidate.score > 0)
      .sort((a, b) => (b.score - a.score) || (a.index - b.index));
  }

  function looksLikeFileTreeFolderItem(item) {
    const label = cleanText([
      item.getAttribute("aria-label"),
      item.textContent,
      item.getAttribute("class")
    ].filter(Boolean).join(" "));
    return /(^|\s)(folder|folder_open|create_new_folder)(\s|$)|open .* action menu|file tree/i.test(label);
  }

  function getFileTreeItemDepth(item, root) {
    const ariaDepth = Number(item && item.getAttribute && item.getAttribute("aria-level") || "0") || 0;
    let domDepth = 0;
    let node = item && item.parentElement;
    for (let guard = 0; node && node !== document.body && guard < 20; guard += 1, node = node.parentElement) {
      if (node.getAttribute && node.getAttribute("role") === "tree" && !isOutlineTreeItem(node)) domDepth += 1;
      if (root && node === root) break;
    }
    return Math.max(1, ariaDepth, domDepth);
  }

  function isOutlineTreeItem(item) {
    let node = item;
    for (let depth = 0; node && node !== document.body && depth < 8; depth += 1, node = node.parentElement) {
      const text = cleanText([
        node.getAttribute && node.getAttribute("class"),
        node.getAttribute && node.getAttribute("data-testid"),
        node.getAttribute && node.getAttribute("aria-label")
      ].filter(Boolean).join(" "));
      if (/\boutline(?:-|_|$)|file-outline-panel|outline-pane|outline-container|outline-item/i.test(text)) return true;
      if (/\bfile-tree(?:-|_|$)|file-tree-list-root|project-entities/i.test(text)) return false;
    }
    return false;
  }

  function isFileLikeName(value) {
    const name = cleanText(value);
    return /^readme(?:\.[a-z0-9]+)?$/i.test(name) || /\.[a-z0-9]{1,8}$/i.test(name);
  }

  async function selectParentFolderForCreate(fileName) {
    const parts = splitCreatePath(fileName);
    if (!parts.parentPath) {
      const rootContext = selectRootCreateContextEntry(collectFileTreeEntries());
      if (!rootContext) throw new Error("no root-level file is visible for root file creation");
      rootContext.element.scrollIntoView({ block: "center" });
      rootContext.element.click();
      await sleep(300);
      return parts.baseName;
    }
    const folder = findVisibleFolderTreeItem(parts.parentPath);
    if (!folder) {
      throw new Error(`parent folder is not visible in the Overleaf file tree: ${parts.parentPath}`);
    }
    folder.scrollIntoView({ block: "center" });
    folder.click();
    await expandFolderTreeItem(folder);
    return parts.baseName;
  }

  async function expandFolderTreeItem(folder) {
    await sleep(250);
    if (folder.getAttribute("aria-expanded") === "true") return true;
    const toggles = Array.from(folder.querySelectorAll ? folder.querySelectorAll("button, [role='button'], [aria-label], [title]") : [])
      .filter((element) => {
        const label = getControlLabel(element);
        return /keyboard_arrow_right|chevron_right|expand|toggle|folder/i.test(label) && !/menu|more_vert|action/i.test(label);
      });
    if (toggles.length) {
      toggles[0].click();
      await sleep(700);
      if (folder.getAttribute("aria-expanded") === "true") return true;
    }
    folder.focus();
    folder.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", bubbles: true }));
    await sleep(700);
    if (folder.getAttribute("aria-expanded") === "true") return true;
    folder.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", code: "ArrowRight", bubbles: true }));
    await sleep(300);
    return folder.getAttribute("aria-expanded") === "true";
  }

  async function revealFileTreeItem(fileName, timeoutMs = 5000) {
    const started = Date.now();
    const parts = splitCreatePath(fileName);
    while (Date.now() - started < timeoutMs) {
      if (parts.parentPath) {
        const segments = parts.parentPath.split("/").filter(Boolean);
        for (let index = 0; index < segments.length; index += 1) {
          const folder = findVisibleFolderTreeItem(segments.slice(0, index + 1).join("/"));
          if (!folder) break;
          await expandFolderTreeItem(folder);
        }
      }
      const item = findExactFileTreeEntry(fileName, collectFileTreeEntries());
      if (item) {
        item.element.scrollIntoView({ block: "center" });
        return item.element;
      }
      await sleep(500);
    }
    return null;
  }

  function splitCreatePath(fileName) {
    const normalized = String(fileName || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const index = normalized.lastIndexOf("/");
    if (index < 0) return { parentPath: "", baseName: normalized };
    return {
      parentPath: normalized.slice(0, index),
      baseName: normalized.slice(index + 1)
    };
  }

  function selectRootCreateContextEntry(entries) {
    const rootFiles = Array.from(entries || []).filter((entry) => {
      if (!entry || entry.kind !== "file") return false;
      const path = normalizeFileName(entry.path || entry.fileName || "");
      return path && !path.includes("/");
    });
    return rootFiles.find((entry) => entry.selected) || rootFiles[0] || null;
  }

  function findExactFileTreeEntry(fileName, entries) {
    const needle = normalizeFileName(fileName);
    return Array.from(entries || []).find((entry) =>
      entry && entry.kind === "file" && normalizeFileName(entry.path) === needle
    ) || null;
  }

  function findVisibleFolderTreeItem(folderPath) {
    const needle = normalizeFileName(folderPath);
    const entry = collectFileTreeEntries().find((candidate) => candidate.kind === "folder" && normalizeFileName(candidate.path) === needle);
    return entry ? entry.element : null;
  }

  function findFileTreeItem(fileName) {
    const needle = normalizeFileName(fileName);
    const entry = collectFileTreeEntries().find((candidate) => {
      if (candidate.kind !== "file") return false;
      const currentPath = normalizeFileName(candidate.path);
      const currentName = normalizeFileName(candidate.fileName);
      return currentPath === needle || currentName === needle || currentPath.endsWith(`/${needle}`) || needle.endsWith(`/${currentPath}`);
    });
    return entry ? entry.element : null;
  }

  function extractFileName(item) {
    const text = cleanText(item ? (item.getAttribute("aria-label") || item.textContent || "") : "");
    const withoutLeadingIcon = text.replace(/^(description|article|insert_drive_file|draft|folder)\s*/i, "");
    const withoutTrailingMenu = withoutLeadingIcon.replace(/\s*(more_vert|Menu)+\s*$/i, "");
    return cleanText(withoutTrailingMenu);
  }

  function fileNameMatches(current, expected) {
    const a = normalizeFileName(current);
    const b = normalizeFileName(expected);
    return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
  }

  function normalizeFileName(value) {
    return cleanText(value)
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "")
      .toLowerCase();
  }

  function summarizeVisibleCompileStatus(logSnippet) {
    const summary = parseCompileStatusText(logSnippet);
    const errors = summary.errors === null ? 0 : summary.errors;
    const warnings = summary.warnings === null ? 0 : summary.warnings;
    const pages = summary.pages === null ? "" : ` | Pages ${summary.pages}`;
    return `Errors ${errors} | Warnings ${warnings}${pages}`;
  }

  function parseCompileStatusText(value) {
    const text = String(value || "");
    const explicitErrors = matchLastNumber(text, /\bErrors?\s*:?\s*(\d+)\b/gi);
    const explicitWarnings = matchLastNumber(text, /\bWarnings?\s*:?\s*(\d+)\b/gi);
    const explicitPages = matchLastNumber(text, /\b(?:Pages?|pages)\s*:?\s*(\d+)\b/gi);
    const outputPages = matchLastNumber(text, /\bOutput written on\b[\s\S]*?\((\d+)\s+pages?\b/gi);
    return {
      errors: explicitErrors === null ? countImplicitCompileIssues(text, /\b(fatal|undefined control sequence|missing \$|emergency stop)\b/gi) : explicitErrors,
      warnings: explicitWarnings === null ? countImplicitCompileIssues(text, /\bwarning\b/gi) : explicitWarnings,
      pages: outputPages === null ? explicitPages : outputPages
    };
  }

  function matchLastNumber(text, pattern) {
    let value = null;
    for (const match of String(text || "").matchAll(pattern)) value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  function countImplicitCompileIssues(text, pattern) {
    return (String(text || "").match(pattern) || []).length;
  }

  function findButtonByText(text) {
    return Array.from(document.querySelectorAll("button"))
      .find((button) => cleanText(button.textContent).toLowerCase().includes(text.toLowerCase()));
  }

  function findCompileButton(buttons = Array.from(document.querySelectorAll("button"))) {
    return buttons.find((button) => {
      if (button.disabled || !isElementVisible(button)) return false;
      const labels = [button.textContent, button.getAttribute("aria-label"), button.getAttribute("title")]
        .map(cleanText)
        .filter(Boolean);
      return labels.some((label) => /\brecompile\b/i.test(label) || label.includes("重新编译"));
    });
  }

  function assertOverleafEditor() {
    if (!location.hostname.endsWith("overleaf.com") || !location.pathname.startsWith("/project/")) {
      throw new Error("current page is not an Overleaf project");
    }
    if (!getEditorElement()) {
      throw new Error("Overleaf source editor is not visible");
    }
  }

  async function bridgeFetch(path, options) {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: "overleaf_bridge_fetch",
        serverUrl: config.serverUrl,
        path,
        method: options && options.method ? options.method : "GET",
        body: options && options.body ? options.body : "",
        token: config.token
      }, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!result) {
          reject(new Error("bridge service worker returned no response"));
          return;
        }
        resolve(result);
      });
    });
    if (!response.ok) {
      throw new Error(response.error || `bridge ${path} failed with ${response.status}`);
    }
    return {
      ok: true,
      status: response.status,
      json: async () => JSON.parse(response.body || "{}"),
      text: async () => response.body || ""
    };
  }

  function normalizeConfig(items) {
    return {
      serverUrl: String(items.serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, ""),
      token: String(items.token || "").trim()
    };
  }

  function getOrCreateClientId() {
    const existing = sessionStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const id = `ol_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
    sessionStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  }

  function redactProjectUrl(value) {
    try {
      const url = new URL(value);
      if (url.pathname.startsWith("/project/")) return `${url.origin}/project/<redacted>`;
    } catch (_) {}
    return "";
  }

  function redactArtifactUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(value, location.href);
      url.pathname = url.pathname
        .replace(/\/project\/[^/?#]+/g, "/project/<redacted>")
        .replace(/\/download\/project\/[^/?#]+/g, "/download/project/<redacted>")
        .replace(/\/compile\/[^/?#]+/g, "/compile/<redacted>");
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch (_) {
      return "";
    }
  }

  if (window.__OVERLEAF_BRIDGE_ENABLE_TEST_HOOKS__) {
    window.__overleafBridgeTestHooks = {
      classifyFileOperationControl,
      rankFileOperationControlElements,
      rankDialogTextInputElements,
      collectFileTreeEntriesFromItems,
      rankFileTreeRootCandidates,
      getFileTreeItemDepth,
      isOutlineTreeItem,
      fileNameMatches,
      isFileLikeName,
      splitCreatePath,
      selectRootCreateContextEntry,
      findExactFileTreeEntry,
      assertNoBlockingDialog,
      fillDialogTextAndConfirm,
      setNativeTextInputValue,
      clickOperationControl,
      findVisibleCreateMenuLauncher,
      openFile,
      waitForCompileCompletion,
      getCompileActivitySignature,
      getCompileOutputSignature,
      findCompileButton
    };
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value || "").replace(/["\\]/g, "\\$&");
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
