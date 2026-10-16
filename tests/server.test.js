"use strict";

const assert = require("assert");
const { execFile, execFileSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const vm = require("vm");

const {
  createBridgeServer,
  createStdioMessageParser,
  handleMcpRequest,
  applyUnifiedPatch,
  parseLatexSections,
  isOfficialOverleafOrigin
} = require("../server/overleaf-bridge-mcp");

const execFileAsync = promisify(execFile);

const PUBLIC_TOOLS = [
  "health_check",
  "list_project_aliases",
  "set_project_alias",
  "clear_project_alias",
  "lock_target_project",
  "unlock_target_project",
  "list_target_locks",
  "get_current_project",
  "paper_context",
  "list_open_project_files",
  "open_file",
  "read_current_file",
  "read_file",
  "read_file_range",
  "read_file_since_hash",
  "get_sections",
  "get_section_content",
  "get_selection",
  "get_editor_diagnostics",
  "replace_section",
  "insert_text",
  "replace_selection",
  "replace_file",
  "apply_patch_to_file",
  "compile_and_read_log",
  "sync_project_snapshot",
  "preview_mirror_diff",
  "prepare_mirror_sync_plan",
  "execute_mirror_sync_plan",
  "find_in_project_mirror",
  "export_current_file",
  "export_compile_log",
  "list_visible_artifacts",
  "export_artifact_inventory",
  "export_visible_artifact",
  "inspect_file_operation_ui",
  "inspect_upload_workflow",
  "inspect_download_workflow",
  "inspect_visible_comments",
  "prepare_comment_action",
  "execute_comment_action",
  "prepare_file_operation",
  "execute_file_operation",
  "get_recent_patch_log",
  "restore_from_snapshot"
];

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "overleaf-bridge-test-"));
  const token = "test-token";
  const bridge = createBridgeServer({
    port: 0,
    token,
    snapshotDir: path.join(tmp, "projects"),
    aliasFile: path.join(tmp, "aliases.json"),
    commandTimeoutMs: 5000
  });
  const address = await bridge.start();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const client = new FakeOverleafClient(baseUrl, token);

  await client.register();

  const waitingPoll = client.request(`/bridge/next?clientId=${encodeURIComponent(client.clientId)}`, {
    method: "GET"
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const waitingTool = bridge.callTool("get_current_project", { projectTitle: client.projectTitle });
  const waitingCommand = await waitingPoll;
  assert.strictEqual(waitingCommand.command.type, "get_current_project");
  await client.request("/bridge/result", {
    method: "POST",
    body: {
      id: waitingCommand.command.id,
      ok: true,
      payload: client.meta()
    }
  });
  const waitingToolResult = await waitingTool;
  assert.strictEqual(waitingToolResult.projectTitle, client.projectTitle);

  const extensionRegister = await rawRequest(baseUrl, "/bridge/register", {
    method: "POST",
    headers: { "Origin": "chrome-extension://test-extension" },
    body: {
      clientId: "extensionclient1",
      pageUrl: "https://www.overleaf.com/project/xyz789",
      projectTitle: "Extension Origin Project",
      fileName: "main.tex",
      editorMode: "source",
      contentScriptVersion: "0.5.31"
    }
  });
  assert.strictEqual(extensionRegister.ok, true);

  const regionalOriginRegister = await rawRequest(baseUrl, "/bridge/register", {
    method: "POST",
    headers: { "Origin": "https://cn.overleaf.com" },
    body: {
      clientId: "regionalclient1",
      pageUrl: "https://cn.overleaf.com/project/regional123",
      projectTitle: "Regional Origin Project",
      fileName: "main.tex",
      editorMode: "source",
      contentScriptVersion: "0.5.31"
    }
  });
  assert.strictEqual(regionalOriginRegister.ok, true);
  const regionalTool = bridge.callTool("get_current_project", { projectTitle: "Regional Origin Project" });
  const regionalNext = await rawRequest(baseUrl, "/bridge/next?clientId=regionalclient1", {
    method: "POST",
    headers: { "Origin": "https://cn.overleaf.com" },
    body: {}
  });
  assert.strictEqual(regionalNext.command.type, "get_current_project");
  await rawRequest(baseUrl, "/bridge/result", {
    method: "POST",
    headers: { "Origin": "https://cn.overleaf.com" },
    body: {
      id: regionalNext.command.id,
      ok: true,
      payload: {
        projectTitle: "Regional Origin Project",
        fileName: "main.tex",
        editorMode: "source",
        pageUrl: "https://cn.overleaf.com/project/<redacted>"
      }
    }
  });
  assert.strictEqual((await regionalTool).projectTitle, "Regional Origin Project");
  bridge.state.clients.delete("regionalclient1");

  const lookalikeOriginRegister = await rawRequest(baseUrl, "/bridge/register", {
    method: "POST",
    headers: { "Origin": "https://eviloverleaf.com" },
    body: {
      clientId: "lookalikeclient1",
      pageUrl: "https://eviloverleaf.com/project/lookalike123",
      projectTitle: "Lookalike Origin Project",
      fileName: "main.tex",
      editorMode: "source",
      contentScriptVersion: "0.5.31"
    },
    expectOk: false
  });
  assert.strictEqual(lookalikeOriginRegister.status, 401);
  assert.strictEqual(isOfficialOverleafOrigin("https://overleaf.com"), true);
  assert.strictEqual(isOfficialOverleafOrigin("https://cn.overleaf.com"), true);
  assert.strictEqual(isOfficialOverleafOrigin("https://eviloverleaf.com"), false);
  assert.strictEqual(isOfficialOverleafOrigin("http://cn.overleaf.com"), false);

  const authenticatedExtensionRegister = await rawRequest(baseUrl, "/bridge/register", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Origin": "chrome-extension://test-extension"
    },
    body: {
      clientId: "extensionclient1",
      pageUrl: "https://www.overleaf.com/project/xyz789",
      projectTitle: "Extension Origin Project",
      fileName: "main.tex",
      editorMode: "source",
      contentScriptVersion: "0.5.31"
    }
  });
  assert.strictEqual(authenticatedExtensionRegister.ok, true);
  bridge.state.clients.delete("extensionclient1");

  const unauthTools = await rawRequest(baseUrl, "/tools/list", { method: "GET", expectOk: false });
  assert.strictEqual(unauthTools.status, 401);

  const listedTools = await client.request("/tools/list", { method: "GET" });
  const toolNames = listedTools.tools.map((tool) => tool.name);
  for (const toolName of PUBLIC_TOOLS) assert.ok(toolNames.includes(toolName), `missing tool: ${toolName}`);
  assert.ok(!toolNames.includes("list_connected_pages"));
  assert.ok(!toolNames.includes("snapshot_before_write"));

  const cliPath = path.resolve(__dirname, "../bin/overleaf-browser-bridge.js");
  const cliHelp = execFileSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
  assert.ok(cliHelp.includes("overleaf-browser-bridge"));
  assert.ok(cliHelp.includes("--snapshot-dir"));
  assert.ok(cliHelp.includes("Commands:"));
  assert.ok(cliHelp.includes("live:suite"));
  assert.ok(!/cookie|session|password/i.test(cliHelp.split("Safety:")[0]));
  const cliVersion = execFileSync(process.execPath, [cliPath, "--version"], { encoding: "utf8" }).trim();
  assert.strictEqual(cliVersion, JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")).version);
  const cliCommandList = JSON.parse(execFileSync(process.execPath, [cliPath, "--list-commands"], { encoding: "utf8" }));
  assert.strictEqual(cliCommandList.ok, true);
  assert.ok(cliCommandList.commands.includes("doctor"));
  assert.ok(cliCommandList.commands.includes("release:preflight"));
  assert.ok(cliCommandList.commands.includes("repo:metadata"));
  assert.ok(cliCommandList.commands.includes("release:candidate"));
  assert.ok(cliCommandList.commands.includes("release:decision"));
  assert.ok(cliCommandList.commands.includes("sync:mirror"));
  assert.strictEqual(cliCommandList.aliases["live-suite"], "live:suite");
  assert.strictEqual(cliCommandList.aliases["release-decision"], "release:decision");
  assert.strictEqual(cliCommandList.aliases["sync-mirror"], "sync:mirror");
  const cliLiveSuitePlan = JSON.parse(execFileSync(process.execPath, [cliPath, "live-suite", "--list"], { encoding: "utf8" }));
  assert.strictEqual(cliLiveSuitePlan.ok, true);
  assert.strictEqual(cliLiveSuitePlan.mutating, false);
  const cliMirrorSyncList = JSON.parse(execFileSync(process.execPath, [cliPath, "sync-mirror", "--list"], { encoding: "utf8" }));
  assert.strictEqual(cliMirrorSyncList.ok, true);
  assert.ok(cliMirrorSyncList.commands.includes("status"));
  assert.ok(cliMirrorSyncList.commands.includes("pull-plan"));
  assert.strictEqual(cliMirrorSyncList.safety.defaultIncludesDiffText, false);

  const liveSmokeSource = fs.readFileSync(path.resolve(__dirname, "../scripts/live-smoke-test.js"), "utf8");
  assert.ok(!liveSmokeSource.includes('"read_current_file"'));
  assert.ok(!liveSmokeSource.includes('"paper_context"'));
  assert.ok(!/preview\s*:|text\.slice/i.test(liveSmokeSource));

  const releasePreflightPath = path.resolve(__dirname, "../scripts/release-preflight.js");
  const releasePreflightPlan = JSON.parse(execFileSync(process.execPath, [
    releasePreflightPath,
    "--list"
  ], { encoding: "utf8" }));
  assert.strictEqual(releasePreflightPlan.ok, true);
  assert.deepStrictEqual(releasePreflightPlan.publishActionsPerformed, []);
  assert.ok(releasePreflightPlan.gates.some((gate) => gate.name === "release_assets"));
  assert.ok(releasePreflightPlan.gates.some((gate) => gate.name === "mirror_sync_workflow"));
  assert.ok(releasePreflightPlan.gates.some((gate) => gate.name === "repository_metadata"));
  assert.ok(releasePreflightPlan.gates.some((gate) => gate.name === "release_candidate"));
  assert.ok(releasePreflightPlan.gates.some((gate) => gate.name === "release_decision"));
  assert.ok(releasePreflightPlan.gates.some((gate) => gate.name === "tracked_privacy_scan"));
  assert.ok(releasePreflightPlan.gates.some((gate) => gate.name === "no_publish_boundary"));

  const metadataPath = path.resolve(__dirname, "../scripts/repository-metadata-check.js");
  const metadataPlan = JSON.parse(execFileSync(process.execPath, [
    metadataPath,
    "--list"
  ], { encoding: "utf8" }));
  const metadataSource = fs.readFileSync(metadataPath, "utf8");
  const releasePreflightSource = fs.readFileSync(releasePreflightPath, "utf8");
  assert.strictEqual(metadataPlan.ok, true);
  assert.deepStrictEqual(metadataPlan.publishActionsPerformed, []);
  assert.strictEqual(metadataPlan.published, false);
  assert.ok(!/[^\x00-\x7F]/.test(metadataSource));
  assert.ok(!/local username/i.test(releasePreflightSource));
  assert.ok(!/\[\s*["'][A-Za-z]{2}["']\s*,\s*["'][A-Za-z]{4}["']\s*\]\.join/.test(releasePreflightSource));
  assert.ok(metadataPlan.checks.some((check) => check.name === "readme_ai_discovery"));
  assert.ok(metadataPlan.checks.some((check) => check.name === "license_and_support"));
  assert.ok(metadataPlan.checks.some((check) => check.name === "no_publish_boundary"));
  assert.ok(metadataPlan.recommendedTopics.includes("overleaf"));

  const candidatePath = path.resolve(__dirname, "../scripts/release-candidate-check.js");
  const candidatePlan = JSON.parse(execFileSync(process.execPath, [
    candidatePath,
    "--list"
  ], { encoding: "utf8" }));
  assert.strictEqual(candidatePlan.ok, true);
  assert.deepStrictEqual(candidatePlan.publishActionsPerformed, []);
  assert.strictEqual(candidatePlan.published, false);
  assert.ok(candidatePlan.checks.some((check) => check.name === "release_asset_manifest"));
  assert.ok(candidatePlan.checks.some((check) => check.name === "human_decision_boundary"));
  assert.ok(candidatePlan.checks.some((check) => check.name === "no_publish_boundary"));

  const decisionPath = path.resolve(__dirname, "../scripts/release-decision-report.js");
  const decisionPlan = JSON.parse(execFileSync(process.execPath, [
    decisionPath,
    "--list"
  ], { encoding: "utf8" }));
  assert.strictEqual(decisionPlan.ok, true);
  assert.deepStrictEqual(decisionPlan.publishActionsPerformed, []);
  assert.strictEqual(decisionPlan.published, false);
  assert.ok(decisionPlan.checks.some((check) => check.name === "release_candidate"));
  assert.ok(decisionPlan.checks.some((check) => check.name === "human_decision_packet"));
  assert.ok(decisionPlan.checks.some((check) => check.name === "no_publish_boundary"));

  const mirrorSyncPath = path.resolve(__dirname, "../scripts/mirror-sync-workflow.js");
  const fakeMirrorServer = await startFakeMirrorWorkflowServer(tmp, token);
  try {
    const mirrorStatus = JSON.parse((await execFileAsync(process.execPath, [
      mirrorSyncPath,
      "status",
      "--project-title",
      "Fake Project",
      "--mirror-root",
      "<MIRROR_ROOT>",
      "--server-info",
      fakeMirrorServer.infoPath
    ], { encoding: "utf8" })).stdout);
    assert.strictEqual(mirrorStatus.ok, true);
    assert.strictEqual(mirrorStatus.toolName, "preview_mirror_diff");
    assert.strictEqual(mirrorStatus.defaultIncludesDiffText, false);
    assert.strictEqual(mirrorStatus.changedFileCount, 1);
    assert.strictEqual(mirrorStatus.files[0].path, "main.tex");
    assert.ok(!JSON.stringify(mirrorStatus).includes("PRIVATE DIFF TEXT"));

    const mirrorPullPlan = JSON.parse((await execFileAsync(process.execPath, [
      mirrorSyncPath,
      "pull-plan",
      "--project-title",
      "Fake Project",
      "--mirror-root",
      "<MIRROR_ROOT>",
      "--reason",
      "prepare local refresh",
      "--server-info",
      fakeMirrorServer.infoPath
    ], { encoding: "utf8" })).stdout);
    assert.strictEqual(mirrorPullPlan.ok, true);
    assert.strictEqual(mirrorPullPlan.toolName, "prepare_mirror_sync_plan");
    assert.strictEqual(mirrorPullPlan.direction, "overleaf_to_mirror");
    assert.strictEqual(mirrorPullPlan.readyToExecute, true);

    await assert.rejects(
      () => execFileAsync(process.execPath, [
        mirrorSyncPath,
        "execute",
        "--project-title",
        "Fake Project",
        "--server-info",
        fakeMirrorServer.infoPath
      ], { encoding: "utf8" }),
      /execute requires --confirmation-token/
    );

    const mirrorExecute = JSON.parse((await execFileAsync(process.execPath, [
      mirrorSyncPath,
      "execute",
      "--project-title",
      "Fake Project",
      "--confirmation-token",
      "token-1",
      "--confirmation-phrase",
      "CONFIRM MIRROR SYNC OVERLEAF_TO_MIRROR",
      "--sync-plan-hash",
      "a".repeat(64),
      "--server-info",
      fakeMirrorServer.infoPath
    ], { encoding: "utf8" })).stdout);
    assert.strictEqual(mirrorExecute.ok, true);
    assert.strictEqual(mirrorExecute.toolName, "execute_mirror_sync_plan");
    assert.strictEqual(mirrorExecute.action, "overleaf_to_mirror");
    assert.match(mirrorExecute.oldMirrorRoot, /^<TEMP_DIR>[\\/]/);
    assert.match(mirrorExecute.newMirrorRoot, /^<TEMP_DIR>[\\/]/);
    assert.ok(!JSON.stringify(mirrorExecute).includes(tmp));
  } finally {
    await fakeMirrorServer.close();
  }

  const liveSuitePath = path.resolve(__dirname, "../scripts/live-safe-suite.js");
  const liveSuitePlan = JSON.parse(execFileSync(process.execPath, [
    liveSuitePath,
    "--list"
  ], { encoding: "utf8" }));
  assert.strictEqual(liveSuitePlan.ok, true);
  assert.strictEqual(liveSuitePlan.mutating, false);
  const liveSuiteGateNames = liveSuitePlan.gates.map((gate) => gate.name);
  assert.ok(liveSuiteGateNames.includes("live_smoke"));
  assert.ok(liveSuiteGateNames.includes("download_workflow"));
  assert.ok(liveSuiteGateNames.includes("prepare_file_operation"));
  assert.ok(liveSuiteGateNames.includes("prepare_comment_action"));
  assert.ok(!JSON.stringify(liveSuitePlan).includes("execute_file_operation"));
  assert.ok(!JSON.stringify(liveSuitePlan).includes("execute_comment_action"));

  const extensionBuildScriptPath = path.resolve(__dirname, "../scripts/prepare-extension-build.js");
  const customExtensionOut = path.join(tmp, "custom-extension");
  const customExtensionSummary = JSON.parse(execFileSync(process.execPath, [
    extensionBuildScriptPath,
    "--overleaf-origin",
    "https://overleaf.example.com",
    "--bridge-origin",
    "http://127.0.0.1:38476",
    "--out-dir",
    customExtensionOut
  ], { encoding: "utf8" }));
  assert.strictEqual(customExtensionSummary.ok, true);
  assert.strictEqual(customExtensionSummary.safeToCommit, false);
  assert.strictEqual(customExtensionSummary.permissionsBroadened, false);
  assert.deepStrictEqual(customExtensionSummary.publishActionsPerformed, []);
  const customManifest = JSON.parse(fs.readFileSync(path.join(customExtensionOut, "manifest.json"), "utf8"));
  assert.ok(customManifest.host_permissions.includes("https://overleaf.example.com/project/*"));
  assert.ok(customManifest.host_permissions.includes("http://127.0.0.1:38476/*"));
  assert.ok(customManifest.content_scripts.every((entry) => (entry.matches || []).includes("https://overleaf.example.com/project/*")));
  for (const forbidden of ["cookies", "history", "tabs", "webRequest"]) {
    assert.ok(!customManifest.permissions.includes(forbidden));
  }
  const customContentScript = fs.readFileSync(path.join(customExtensionOut, "contentScript.js"), "utf8");
  const customPopup = fs.readFileSync(path.join(customExtensionOut, "popup.js"), "utf8");
  assert.ok(customContentScript.includes('const DEFAULT_SERVER_URL = "http://127.0.0.1:38476";'));
  assert.ok(customPopup.includes('const DEFAULT_SERVER_URL = "http://127.0.0.1:38476";'));
  assert.throws(() => execFileSync(process.execPath, [
    extensionBuildScriptPath,
    "--overleaf-origin",
    "https://overleaf.example.com/path",
    "--out-dir",
    path.join(tmp, "invalid-extension")
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), /Command failed/);

  const configScriptPath = path.resolve(__dirname, "../scripts/generate-mcp-config.js");
  const sourceConfigOut = path.join(tmp, "generated-source-configs");
  const fakeRepoPath = path.resolve("C:/AgentPilotLab/overleaf-browser-bridge");
  const sourceConfigSummary = JSON.parse(execFileSync(process.execPath, [
    configScriptPath,
    "--repo-path",
    fakeRepoPath,
    "--out-dir",
    sourceConfigOut
  ], { encoding: "utf8" }));
  assert.strictEqual(sourceConfigSummary.ok, true);
  assert.strictEqual(sourceConfigSummary.safeToCommit, false);
  const generatedCodexToml = fs.readFileSync(path.join(sourceConfigOut, "codex-mcp.toml"), "utf8");
  assert.ok(generatedCodexToml.includes("[mcp_servers.overleaf_browser_bridge]"));
  const expectedCodexServerPath = path.join(fakeRepoPath, "server", "overleaf-bridge-mcp.js").replace(/\\/g, "\\\\");
  assert.ok(generatedCodexToml.includes(expectedCodexServerPath));
  const generatedClaudeJson = JSON.parse(fs.readFileSync(path.join(sourceConfigOut, "mcp-launch.json"), "utf8"));
  assert.strictEqual(generatedClaudeJson.mcpServers.overleaf_browser_bridge.command, "node");
  assert.ok(generatedClaudeJson.mcpServers.overleaf_browser_bridge.args[0].endsWith(path.join("server", "overleaf-bridge-mcp.js")));

  const packageConfigOut = path.join(tmp, "generated-package-configs");
  const packageConfigSummary = JSON.parse(execFileSync(process.execPath, [
    configScriptPath,
    "--mode",
    "package",
    "--out-dir",
    packageConfigOut
  ], { encoding: "utf8" }));
  assert.strictEqual(packageConfigSummary.ok, true);
  const generatedPackageJson = JSON.parse(fs.readFileSync(path.join(packageConfigOut, "mcp-launch.json"), "utf8"));
  assert.strictEqual(generatedPackageJson.mcpServers.overleaf_browser_bridge.command, "npx");
  assert.deepStrictEqual(generatedPackageJson.mcpServers.overleaf_browser_bridge.args, ["overleaf-browser-bridge"]);

  const firstRunPath = path.resolve(__dirname, "../scripts/first-run-check.js");
  const firstRunOut = path.join(tmp, "first-run");
  const firstRunSummary = JSON.parse(execFileSync(process.execPath, [
    firstRunPath,
    "--out-dir",
    firstRunOut
  ], { encoding: "utf8" }));
  assert.strictEqual(firstRunSummary.ok, true);
  assert.strictEqual(firstRunSummary.safeToCommitGeneratedFiles, false);
  assert.ok(firstRunSummary.checks.some((check) => check.name === "node_version" && check.status === "pass"));
  assert.ok(firstRunSummary.checks.some((check) => check.name === "config_generation" && check.status === "pass"));
  assert.ok(firstRunSummary.checks.some((check) => check.name === "live_bridge" && ["pass", "warn"].includes(check.status)));
  assert.ok(fs.existsSync(path.join(firstRunOut, "generated-configs", "codex-mcp.toml")));
  assert.ok(fs.existsSync(path.join(firstRunOut, "generated-configs", "mcp-launch.json")));

  const postInstallPath = path.resolve(__dirname, "../scripts/post-install-live-check.js");
  const liveInfoPath = path.join(tmp, "server-info.json");
  fs.writeFileSync(liveInfoPath, JSON.stringify({ serverUrl: baseUrl, token }, null, 2), "utf8");
  const postInstallPromise = execFileAsync(process.execPath, [
    postInstallPath,
    "--server-info",
    liveInfoPath
  ], { encoding: "utf8" });
  await client.pollAndHandle();
  const postInstallRun = await postInstallPromise;
  const postInstallSummary = JSON.parse(postInstallRun.stdout);
  assert.strictEqual(postInstallSummary.ok, true);
  assert.strictEqual(postInstallSummary.safeToCommitGeneratedFiles, false);
  assert.strictEqual(postInstallSummary.expectedContentScriptVersion, JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")).version);
  assert.ok(postInstallSummary.checks.some((check) => check.name === "content_script_version" && check.status === "pass"));
  assert.ok(postInstallSummary.checks.some((check) => check.name === "file_operation_ui_schema" && check.status === "pass"));
  assert.ok(postInstallSummary.pages.every((page) => page.fileOperationUiSchemaVersion === 9));
  assert.ok(postInstallSummary.pages.every((page) => !/project\/[A-Za-z0-9]+/.test(page.pageUrl)));

  const health = await bridge.callTool("health_check", {});
  assert.strictEqual(health.connectedClients, 1);
  assert.strictEqual(health.tokenProtected, true);
  assert.ok(!health.pages[0].pageUrl.includes("abc123"), "project id should be redacted");
  assert.deepStrictEqual(health.projectAliases, []);
  assert.deepStrictEqual(health.targetLocks, []);

  const readPromise = bridge.callTool("read_current_file", { clientId: client.clientId });
  await client.pollAndHandle();
  const read = await readPromise;
  assert.ok(read.text.includes("\\documentclass"));
  assert.strictEqual(read.projectTitle, "Codex Free Sync Test");
  assert.strictEqual(read.fileName, "main.tex");
  assert.strictEqual(read.beforeHash.length, 64);

  bridge.state.clients.set("staleclient1", {
    id: "staleclient1",
    queue: [],
    waiters: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    pageUrl: "https://www.overleaf.com/project/stale123",
    projectTitle: "Codex Free Sync Test",
    fileName: "main.tex",
    editorMode: "source",
    contentScriptVersion: "0.2.0"
  });
  const currentWithStaleDuplicatePromise = bridge.callTool("get_current_project", { projectTitle: "Codex Free" });
  await client.pollAndHandle();
  const currentWithStaleDuplicate = await currentWithStaleDuplicatePromise;
  assert.strictEqual(currentWithStaleDuplicate.projectTitle, "Codex Free Sync Test");
  assert.ok(!bridge.state.clients.has("staleclient1"));

  const secondClient = new FakeOverleafClient(baseUrl, token, {
    clientId: "testclient2",
    projectTitle: "Second Overleaf Paper",
    pageUrl: "https://www.overleaf.com/project/second456",
    files: {
      "main.tex": "\\documentclass{article}\n\\begin{document}\nSecond project\n\\end{document}\n"
    }
  });
  await secondClient.register();
  const multiHealth = await bridge.callTool("health_check", {});
  assert.strictEqual(multiHealth.connectedClients, 2);
  assert.ok(multiHealth.pages.some((page) => page.projectTitle === "Second Overleaf Paper"));

  const setAlias = await bridge.callTool("set_project_alias", {
    alias: "paper-two",
    projectTitle: "Second Overleaf"
  });
  assert.strictEqual(setAlias.alias.alias, "paper-two");
  assert.strictEqual(setAlias.alias.projectTitle, "Second Overleaf");
  const aliases = await bridge.callTool("list_project_aliases", {});
  assert.strictEqual(aliases.aliases.length, 1);
  assert.strictEqual(aliases.aliases[0].alias, "paper-two");
  assert.ok(fs.existsSync(path.join(tmp, "aliases.json")));

  const aliasReadPromise = bridge.callTool("read_current_file", { projectAlias: "paper-two" });
  await secondClient.pollAndHandle();
  const aliasRead = await aliasReadPromise;
  assert.strictEqual(aliasRead.projectTitle, "Second Overleaf Paper");
  assert.ok(aliasRead.text.includes("Second project"));

  const lock = await bridge.callTool("lock_target_project", { projectAlias: "paper-two" });
  assert.strictEqual(lock.lock.projectTitle, "Second Overleaf Paper");
  assert.strictEqual(lock.lock.clientId, "testclient2");
  const locks = await bridge.callTool("list_target_locks", {});
  assert.strictEqual(locks.locks.length, 1);
  const lockedReadPromise = bridge.callTool("read_current_file", { targetLockId: lock.lock.targetLockId });
  await secondClient.pollAndHandle();
  const lockedRead = await lockedReadPromise;
  assert.strictEqual(lockedRead.projectTitle, "Second Overleaf Paper");
  secondClient.projectTitle = "Different Overleaf Paper";
  await secondClient.register();
  await assert.rejects(
    () => bridge.callTool("read_current_file", { targetLockId: lock.lock.targetLockId }),
    /target lock project changed/
  );
  secondClient.projectTitle = "Second Overleaf Paper";
  await secondClient.register();
  const unlock = await bridge.callTool("unlock_target_project", { targetLockId: lock.lock.targetLockId });
  assert.strictEqual(unlock.removed, true);
  const clearAlias = await bridge.callTool("clear_project_alias", { alias: "paper-two" });
  assert.strictEqual(clearAlias.removed, true);

  const diagnosticsPromise = bridge.callTool("get_editor_diagnostics", { clientId: client.clientId });
  await client.pollAndHandle();
  const diagnostics = await diagnosticsPromise;
  assert.strictEqual(diagnostics.diagnosticCount, 1);
  assert.ok(diagnostics.diagnostics[0].text.includes("Undefined control sequence"));

  const contextPromise = bridge.callTool("paper_context", { projectTitle: "Codex Free" });
  await client.pollAndHandle();
  await client.pollAndHandle();
  await client.pollAndHandle();
  const context = await contextPromise;
  assert.ok(context.mainFileCandidates.includes("main.tex"));
  assert.ok(context.bibFileCandidates.includes("refs.bib"));

  const readIntroPromise = bridge.callTool("read_file", {
    projectTitle: "Codex Free",
    fileName: "sections/01_introduction.tex",
    expectedFileName: "01_introduction.tex"
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  const intro = await readIntroPromise;
  assert.strictEqual(intro.fileName, "01_introduction.tex");
  assert.ok(intro.text.includes("Introduction"));

  const readIntroByPathPromise = bridge.callTool("read_file", {
    projectTitle: "Codex Free",
    fileName: "sections/01_introduction.tex"
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  const introByPath = await readIntroByPathPromise;
  assert.strictEqual(introByPath.fileName, "01_introduction.tex");
  assert.ok(introByPath.text.includes("Introduction"));

  const introContextPromise = bridge.callTool("paper_context", { projectTitle: "Codex Free" });
  await client.pollAndHandle();
  await client.pollAndHandle();
  await client.pollAndHandle();
  const introContext = await introContextPromise;
  assert.strictEqual(introContext.currentFile, "01_introduction.tex");
  assert.ok(introContext.currentFileHash);
  assert.ok(introContext.currentSectionCandidates.some((section) => section.title === "Motivation"));

  const rangePromise = bridge.callTool("read_file_range", {
    projectTitle: "Codex Free",
    fileName: "sections/01_introduction.tex",
    expectedFileName: "01_introduction.tex",
    startLine: 3,
    endLine: 4
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  const range = await rangePromise;
  assert.strictEqual(range.returnedLineCount, 2);
  assert.ok(range.text.includes("\\subsection{Motivation}"));
  assert.ok(!range.text.includes("\\section{Related Work}"));

  const summaryPromise = bridge.callTool("read_file", {
    projectTitle: "Codex Free",
    fileName: "sections/01_introduction.tex",
    expectedFileName: "01_introduction.tex",
    contextBudget: "summary",
    maxChars: 40
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  const summary = await summaryPromise;
  assert.strictEqual(summary.contextBudget, "summary");
  assert.strictEqual(summary.text, undefined);
  assert.strictEqual(summary.preview.length, 40);

  const parsedFixtureSections = parseLatexSections([
    "% \\section{Ignored}",
    "\\section{Visible Title}",
    "Body",
    "\\subsection*{Nested \\emph{Idea}}",
    "Nested body"
  ].join("\n"));
  assert.strictEqual(parsedFixtureSections.length, 2);
  assert.strictEqual(parsedFixtureSections[0].title, "Visible Title");
  assert.deepStrictEqual(parsedFixtureSections[1].path, ["Visible Title", "Nested \\emph{Idea}"]);

  const sectionsPromise = bridge.callTool("get_sections", {
    projectTitle: "Codex Free",
    fileName: "sections/01_introduction.tex",
    expectedFileName: "01_introduction.tex"
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  const sections = await sectionsPromise;
  assert.strictEqual(sections.sectionCount, 3);
  assert.deepStrictEqual(sections.sections.map((section) => section.command), ["section", "subsection", "section"]);

  const motivationPromise = bridge.callTool("get_section_content", {
    projectTitle: "Codex Free",
    fileName: "sections/01_introduction.tex",
    expectedFileName: "01_introduction.tex",
    title: "Motivation"
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  const motivation = await motivationPromise;
  assert.strictEqual(motivation.section.command, "subsection");
  assert.ok(motivation.text.includes("Why this bridge exists."));
  assert.ok(!motivation.text.includes("\\section{Related Work}"));

  const sectionBudgetPromise = bridge.callTool("read_file", {
    projectTitle: "Codex Free",
    fileName: "sections/01_introduction.tex",
    expectedFileName: "01_introduction.tex",
    contextBudget: "section",
    title: "Motivation"
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  const sectionBudget = await sectionBudgetPromise;
  assert.strictEqual(sectionBudget.contextBudget, "section");
  assert.strictEqual(sectionBudget.section.title, "Motivation");
  assert.ok(sectionBudget.text.includes("Why this bridge exists."));

  const replaceSectionPromise = bridge.callTool("replace_section", {
    projectTitle: "Codex Free",
    fileName: "sections/01_introduction.tex",
    expectedFileName: "01_introduction.tex",
    beforeHash: sections.beforeHash,
    reason: "replace motivation body",
    title: "Motivation",
    text: "A safer browser bridge keeps agent edits scoped.\n"
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  await client.pollAndHandle();
  await client.pollAndHandle();
  const sectionReplace = await replaceSectionPromise;
  assert.strictEqual(sectionReplace.section.title, "Motivation");
  assert.ok(client.files["sections/01_introduction.tex"].includes("\\subsection{Motivation}\nA safer browser bridge keeps agent edits scoped."));
  assert.ok(client.files["sections/01_introduction.tex"].includes("\\section{Related Work}\nPrior systems use Git tokens."));

  const sincePromise = bridge.callTool("read_file_since_hash", {
    projectTitle: "Codex Free",
    fileName: "sections/01_introduction.tex",
    expectedFileName: "01_introduction.tex",
    sinceHash: sections.beforeHash,
    maxDiffLines: 40
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  const since = await sincePromise;
  assert.strictEqual(since.changed, true);
  assert.strictEqual(since.diffAvailable, true);
  assert.ok(since.diff.includes("-Why this bridge exists."));
  assert.ok(since.diff.includes("+A safer browser bridge keeps agent edits scoped."));
  assert.strictEqual(since.text, undefined);

  const unchangedPromise = bridge.callTool("read_file_since_hash", {
    projectTitle: "Codex Free",
    fileName: "sections/01_introduction.tex",
    expectedFileName: "01_introduction.tex",
    sinceHash: sectionReplace.afterHash
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  const unchanged = await unchangedPromise;
  assert.strictEqual(unchanged.changed, false);
  assert.strictEqual(unchanged.diff, "");

  client.selection = "Hello";
  const mismatchPromise = bridge.callTool("replace_selection", {
    projectTitle: "Codex Free",
    expectedFileName: "01_introduction.tex",
    beforeHash: "bad-hash",
    reason: "test mismatch",
    text: "Hi Codex"
  });
  const mismatchAssertion = assert.rejects(mismatchPromise, /hash mismatch/);
  await client.pollAndHandle();
  await mismatchAssertion;

  const replacePromise = bridge.callTool("replace_selection", {
    projectTitle: "Codex Free",
    expectedFileName: "01_introduction.tex",
    beforeHash: sectionReplace.afterHash,
    reason: "replace greeting in intro",
    text: "Hi Codex"
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  await client.pollAndHandle();
  const replace = await replacePromise;
  assert.strictEqual(replace.ok, true);
  assert.ok(fs.existsSync(replace.snapshotPath));
  assert.ok(fs.existsSync(replace.afterPath));
  assert.ok(fs.existsSync(replace.diffPath));
  assert.ok(client.files["sections/01_introduction.tex"].includes("Hi Codex"));

  const patchRead = await queueReadFile(bridge, client, "sections/01_introduction.tex", "01_introduction.tex");
  const patch = [
    "--- a/01_introduction.tex",
    "+++ b/01_introduction.tex",
    "@@ -1,2 +1,2 @@",
    " \\section{Introduction}",
    "-Hi Codex from Overleaf.",
    "+Hi Codex from the bridge."
  ].join("\n") + "\n";
  assert.ok(applyUnifiedPatch(patchRead.text, patch).includes("the bridge"));
  const patchPromise = bridge.callTool("apply_patch_to_file", {
    projectTitle: "Codex Free",
    fileName: "sections/01_introduction.tex",
    expectedFileName: "01_introduction.tex",
    beforeHash: patchRead.beforeHash,
    reason: "patch intro wording",
    patch
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  await client.pollAndHandle();
  await client.pollAndHandle();
  const patched = await patchPromise;
  assert.strictEqual(patched.fileName, "01_introduction.tex");
  assert.ok(client.files["sections/01_introduction.tex"].includes("the bridge"));

  const replaceFileRead = await queueReadFile(bridge, client, "main.tex", "main.tex");
  const replaceFilePromise = bridge.callTool("replace_file", {
    projectTitle: "Codex Free",
    expectedFileName: "main.tex",
    beforeHash: replaceFileRead.beforeHash,
    reason: "replace main body",
    text: "\\documentclass{article}\n\\begin{document}\nUpdated main\n\\end{document}\n"
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  await client.pollAndHandle();
  const replacedFile = await replaceFilePromise;
  assert.strictEqual(replacedFile.afterHash.length, 64);
  assert.ok(client.files["main.tex"].includes("Updated main"));

  const syncPromise = bridge.callTool("sync_project_snapshot", { projectTitle: "Codex Free" });
  await client.pollAndHandle();
  await client.pollAndHandle();
  await client.pollAndHandle();
  await client.pollAndHandle();
  await client.pollAndHandle();
  await client.pollAndHandle();
  await client.pollAndHandle();
  const sync = await syncPromise;
  assert.strictEqual(sync.ok, true);
  assert.ok(sync.files.length >= 3);
  assert.ok(fs.existsSync(sync.root));
  assert.ok(fs.existsSync(sync.manifestPath));
  assert.ok(fs.existsSync(sync.latestManifestPath));
  const mirrorManifest = JSON.parse(fs.readFileSync(sync.manifestPath, "utf8"));
  assert.strictEqual(mirrorManifest.projectTitle, "Codex Free Sync Test");
  assert.ok(mirrorManifest.files.some((file) => file.sectionCount >= 1));

  const mirrorFind = await bridge.callTool("find_in_project_mirror", {
    projectTitle: "Codex Free",
    fileName: "01_introduction.tex",
    title: "Motivation",
    maxChars: 80
  });
  assert.strictEqual(mirrorFind.matchCount, 1);
  assert.strictEqual(mirrorFind.matches[0].type, "section");
  assert.strictEqual(mirrorFind.matches[0].section.title, "Motivation");

  const mirrorSearch = await bridge.callTool("find_in_project_mirror", {
    mirrorRoot: sync.root,
    query: "bridge",
    maxMatches: 5,
    maxChars: 80
  });
  assert.ok(mirrorSearch.matches.some((match) => match.type === "text" && match.path.endsWith("01_introduction.tex")));

  client.files["main.tex"] = client.files["main.tex"].replace("Updated main", "Updated main with mirror diff");
  const mirrorDiffPromise = bridge.callTool("preview_mirror_diff", {
    projectTitle: "Codex Free",
    mirrorRoot: sync.root,
    maxDiffLines: 20
  });
  for (let i = 0; i < 7; i += 1) await client.pollAndHandle();
  const mirrorDiff = await mirrorDiffPromise;
  assert.strictEqual(mirrorDiff.ok, true);
  assert.ok(mirrorDiff.changedFileCount >= 1);
  assert.ok(mirrorDiff.files.some((file) => file.path === "main.tex" && file.status === "changed" && file.diff.includes("mirror diff")));

  const mirrorSyncPlanPromise = bridge.callTool("prepare_mirror_sync_plan", {
    projectTitle: "Codex Free",
    mirrorRoot: sync.root,
    direction: "mirror_to_overleaf",
    maxDiffLines: 20,
    reason: "review mirror sync before any execution"
  });
  for (let i = 0; i < 7; i += 1) await client.pollAndHandle();
  const mirrorSyncPlan = await mirrorSyncPlanPromise;
  assert.strictEqual(mirrorSyncPlan.ok, true);
  assert.strictEqual(mirrorSyncPlan.direction, "mirror_to_overleaf");
  assert.strictEqual(mirrorSyncPlan.nonMutating, true);
  assert.strictEqual(mirrorSyncPlan.readyToExecute, true);
  assert.strictEqual(mirrorSyncPlan.supportsAutomaticSync, false);
  assert.strictEqual(mirrorSyncPlan.supportsOverleafWriteBack, true);
  assert.strictEqual(mirrorSyncPlan.mirrorToOverleafMode, "update_existing_files_only");
  assert.strictEqual(mirrorSyncPlan.syncPlanHash.length, 64);
  assert.ok(mirrorSyncPlan.confirmationPhrase.includes("CONFIRM MIRROR SYNC MIRROR_TO_OVERLEAF"));
  assert.strictEqual(mirrorSyncPlan.blockers.length, 0);
  assert.ok(mirrorSyncPlan.actions.some((action) => action.path === "main.tex" && action.operation === "update_overleaf_file_from_mirror" && action.requiresFreshHashCheck));

  await assert.rejects(
    () => bridge.callTool("execute_mirror_sync_plan", {
      projectTitle: "Codex Free",
      confirmationToken: mirrorSyncPlan.confirmationToken,
      confirmationPhrase: "wrong phrase",
      syncPlanHash: mirrorSyncPlan.syncPlanHash,
      reason: "reject wrong phrase"
    }),
    /confirmation phrase mismatch/
  );

  const mirrorPushExecutePromise = bridge.callTool("execute_mirror_sync_plan", {
    projectTitle: "Codex Free",
    confirmationToken: mirrorSyncPlan.confirmationToken,
    confirmationPhrase: mirrorSyncPlan.confirmationPhrase,
    syncPlanHash: mirrorSyncPlan.syncPlanHash,
    reason: "restore open Overleaf file from approved mirror"
  });
  for (let i = 0; i < 11; i += 1) await client.pollAndHandle();
  const mirrorPushExecute = await mirrorPushExecutePromise;
  assert.strictEqual(mirrorPushExecute.ok, true);
  assert.strictEqual(mirrorPushExecute.action, "mirror_to_overleaf");
  assert.strictEqual(mirrorPushExecute.nonMutatingOverleaf, false);
  assert.strictEqual(mirrorPushExecute.mutatingOverleaf, true);
  assert.strictEqual(mirrorPushExecute.mirrorWritten, false);
  assert.strictEqual(mirrorPushExecute.updatedFileCount, 1);
  assert.ok(mirrorPushExecute.writtenFiles.some((file) => file.path === "main.tex" && file.afterHash === mirrorSyncPlan.actions.find((action) => action.path === "main.tex").mirrorHash));
  assert.ok(!client.files["main.tex"].includes("mirror diff"));

  client.files["main.tex"] = client.files["main.tex"].replace("Updated main", "Updated main with mirror diff");
  const mirrorPullPlanPromise = bridge.callTool("prepare_mirror_sync_plan", {
    projectTitle: "Codex Free",
    mirrorRoot: sync.root,
    direction: "overleaf_to_mirror",
    maxDiffLines: 20,
    reason: "refresh local mirror from open Overleaf tab"
  });
  for (let i = 0; i < 7; i += 1) await client.pollAndHandle();
  const mirrorPullPlan = await mirrorPullPlanPromise;
  assert.strictEqual(mirrorPullPlan.ok, true);
  assert.strictEqual(mirrorPullPlan.direction, "overleaf_to_mirror");
  assert.strictEqual(mirrorPullPlan.nonMutating, true);
  assert.strictEqual(mirrorPullPlan.readyToExecute, true);
  assert.strictEqual(mirrorPullPlan.supportsLocalMirrorRefresh, true);
  assert.strictEqual(mirrorPullPlan.blockers.length, 0);
  assert.ok(mirrorPullPlan.actions.some((action) => action.path === "main.tex" && action.operation === "update_mirror_file_from_overleaf"));

  const mirrorPullExecutePromise = bridge.callTool("execute_mirror_sync_plan", {
    projectTitle: "Codex Free",
    confirmationToken: mirrorPullPlan.confirmationToken,
    confirmationPhrase: mirrorPullPlan.confirmationPhrase,
    syncPlanHash: mirrorPullPlan.syncPlanHash,
    reason: "execute approved local mirror refresh"
  });
  for (let i = 0; i < 14; i += 1) await client.pollAndHandle();
  const mirrorPullExecute = await mirrorPullExecutePromise;
  assert.strictEqual(mirrorPullExecute.ok, true);
  assert.strictEqual(mirrorPullExecute.action, "overleaf_to_mirror");
  assert.strictEqual(mirrorPullExecute.nonMutatingOverleaf, true);
  assert.strictEqual(mirrorPullExecute.mirrorWritten, true);
  assert.notStrictEqual(mirrorPullExecute.newMirrorRoot, sync.root);
  assert.ok(fs.existsSync(path.join(mirrorPullExecute.newMirrorRoot, "main.tex")));
  assert.ok(fs.readFileSync(path.join(mirrorPullExecute.newMirrorRoot, "main.tex"), "utf8").includes("mirror diff"));

  bridge.state.commandTimeoutMs = 10;
  bridge.state.compileCommandTimeoutMs = 100;
  client.compileDelayMs = 30;
  const compilePromise = bridge.callTool("compile_and_read_log", { projectTitle: "Codex Free" });
  await client.pollAndHandle();
  const compile = await compilePromise;
  client.compileDelayMs = 0;
  bridge.state.commandTimeoutMs = 5000;
  bridge.state.compileCommandTimeoutMs = 90000;
  assert.strictEqual(compile.compileSummary.errors, 0);
  assert.strictEqual(compile.compileSummary.warnings, 0);
  assert.strictEqual(compile.compileSummary.pages, 11);
  assert.strictEqual(compile.compileSummary.completed, true);
  assert.strictEqual(compile.compileSummary.statusText, "Errors 0 | Warnings 0 | Pages 11");
  assert.strictEqual(compile.visibleStatus, "Errors 0 | Warnings 0 | Pages 11");

  client.compileResult = {
    compileCompleted: false,
    compileTimedOut: true,
    visibleStatus: "Compile incomplete: timed out waiting for fresh Overleaf compile results",
    logSnippet: ""
  };
  const incompleteCompilePromise = bridge.callTool("compile_and_read_log", { projectTitle: "Codex Free" });
  await client.pollAndHandle();
  const incompleteCompile = await incompleteCompilePromise;
  assert.strictEqual(incompleteCompile.compileSummary.completed, false);
  assert.strictEqual(incompleteCompile.compileSummary.timedOut, true);
  assert.strictEqual(incompleteCompile.compileSummary.errors, null);
  assert.strictEqual(incompleteCompile.compileSummary.warnings, null);
  assert.strictEqual(incompleteCompile.compileSummary.pages, null);
  assert.match(incompleteCompile.visibleStatus, /Compile incomplete/);

  client.compileResult = {
    compileCompleted: true,
    compileTimedOut: false,
    compileEvidence: "pdf-output-refreshed",
    visibleStatus: "Compile completed: PDF output refreshed; log counts unavailable",
    logSnippet: ""
  };
  const refreshedPdfPromise = bridge.callTool("compile_and_read_log", { projectTitle: "Codex Free" });
  await client.pollAndHandle();
  const refreshedPdfCompile = await refreshedPdfPromise;
  assert.strictEqual(refreshedPdfCompile.compileSummary.completed, true);
  assert.strictEqual(refreshedPdfCompile.compileSummary.timedOut, false);
  assert.strictEqual(refreshedPdfCompile.compileSummary.errors, null);
  assert.strictEqual(refreshedPdfCompile.compileSummary.warnings, null);
  assert.strictEqual(refreshedPdfCompile.compileSummary.evidence, "pdf-output-refreshed");
  client.compileResult = null;

  const exportFilePromise = bridge.callTool("export_current_file", {
    projectTitle: "Codex Free",
    fileName: "main.tex",
    expectedFileName: "main.tex"
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  const exportedFile = await exportFilePromise;
  assert.strictEqual(exportedFile.ok, true);
  assert.ok(fs.existsSync(exportedFile.exportPath));
  assert.ok(fs.existsSync(exportedFile.manifestPath));
  assert.ok(fs.readFileSync(exportedFile.exportPath, "utf8").includes("mirror diff"));

  bridge.state.commandTimeoutMs = 10;
  bridge.state.compileCommandTimeoutMs = 100;
  client.compileDelayMs = 30;
  const exportLogPromise = bridge.callTool("export_compile_log", { projectTitle: "Codex Free" });
  await client.pollAndHandle();
  const exportedLog = await exportLogPromise;
  client.compileDelayMs = 0;
  bridge.state.commandTimeoutMs = 5000;
  bridge.state.compileCommandTimeoutMs = 90000;
  assert.strictEqual(exportedLog.ok, true);
  assert.ok(fs.existsSync(exportedLog.exportPath));
  assert.ok(fs.readFileSync(exportedLog.exportPath, "utf8").includes("Recompile complete"));

  const artifactsPromise = bridge.callTool("list_visible_artifacts", { projectTitle: "Codex Free" });
  await client.pollAndHandle();
  const artifacts = await artifactsPromise;
  assert.strictEqual(artifacts.artifactCount, 3);
  assert.ok(artifacts.artifacts.some((artifact) => artifact.type === "pdf" && artifact.url.includes("/project/<redacted>")));

  const artifactExportPromise = bridge.callTool("export_artifact_inventory", { projectTitle: "Codex Free" });
  await client.pollAndHandle();
  const artifactExport = await artifactExportPromise;
  assert.strictEqual(artifactExport.ok, true);
  assert.strictEqual(artifactExport.artifactCount, 3);
  assert.ok(fs.existsSync(artifactExport.exportPath));
  const artifactInventory = JSON.parse(fs.readFileSync(artifactExport.exportPath, "utf8"));
  assert.strictEqual(artifactInventory.kind, "artifact-inventory");
  assert.ok(!/abc123|test-token|overleaf_session/i.test(JSON.stringify(artifactInventory)));

  const visibleArtifactPromise = bridge.callTool("export_visible_artifact", {
    projectTitle: "Codex Free",
    artifactType: "pdf",
    maxBytes: 1024 * 1024
  });
  await client.pollAndHandle();
  const visibleArtifact = await visibleArtifactPromise;
  assert.strictEqual(visibleArtifact.ok, true);
  assert.strictEqual(visibleArtifact.artifactType, "pdf");
  assert.strictEqual(visibleArtifact.fileName, "output.pdf");
  assert.ok(fs.existsSync(visibleArtifact.exportPath));
  assert.ok(fs.readFileSync(visibleArtifact.exportPath).toString("utf8").startsWith("%PDF-1.7"));
  const visibleArtifactManifest = JSON.parse(fs.readFileSync(visibleArtifact.manifestPath, "utf8"));
  assert.strictEqual(visibleArtifactManifest.kind, "visible-artifact");
  assert.strictEqual(visibleArtifactManifest.byteLength, visibleArtifact.byteLength);
  assert.ok(!/abc123|test-token|overleaf_session/i.test(JSON.stringify(visibleArtifactManifest)));
  assert.ok(!JSON.stringify(visibleArtifact).includes("base64"));

  // A supported artifact whose base64 exceeds the old 5,000,000-character HTTP limit.
  const largeArtifactBytes = Buffer.alloc(4 * 1024 * 1024, 0x61);
  largeArtifactBytes.write("%PDF-1.7\n", 0, "utf8");
  assert.ok(largeArtifactBytes.toString("base64").length > 5_000_000);
  client.artifactBytes = largeArtifactBytes;
  const largeArtifactPromise = bridge.callTool("export_visible_artifact", {
    projectTitle: "Codex Free",
    artifactType: "pdf"
  });
  await client.pollAndHandle();
  const largeArtifact = await largeArtifactPromise;
  assert.strictEqual(largeArtifact.ok, true);
  assert.strictEqual(largeArtifact.byteLength, largeArtifactBytes.length);
  assert.deepStrictEqual(fs.readFileSync(largeArtifact.exportPath), largeArtifactBytes);
  const largeArtifactManifest = JSON.parse(fs.readFileSync(largeArtifact.manifestPath, "utf8"));
  assert.strictEqual(largeArtifactManifest.byteLength, largeArtifactBytes.length);
  assert.strictEqual(largeArtifactManifest.maxBytes, 10 * 1024 * 1024);
  client.artifactBytes = null;

  const fileUiPromise = bridge.callTool("inspect_file_operation_ui", { projectTitle: "Codex Free" });
  await client.pollAndHandle();
  const fileUi = await fileUiPromise;
  assert.strictEqual(fileUi.controlCount, 4);
  assert.ok(fileUi.controls.some((control) => control.operation === "create"));
  assert.ok(fileUi.controls.some((control) => control.operation === "delete"));
  assert.ok(!JSON.stringify(fileUi).includes("abc123"));

  const uploadWorkflowPromise = bridge.callTool("inspect_upload_workflow", { projectTitle: "Codex Free" });
  await client.pollAndHandle();
  const uploadWorkflow = await uploadWorkflowPromise;
  assert.strictEqual(uploadWorkflow.nonMutating, true);
  assert.strictEqual(uploadWorkflow.requiresUserFilePicker, true);
  assert.strictEqual(uploadWorkflow.supportedLocalSelection, false);
  assert.strictEqual(uploadWorkflow.uploadControlCount, 2);
  assert.ok(uploadWorkflow.acceptValues.includes(".png,.jpg,.jpeg,.pdf"));
  assert.ok(uploadWorkflow.imageCandidates.some((candidate) => candidate.fileName === "figures/overview.png"));
  assert.ok(uploadWorkflow.blockers.some((blocker) => blocker.includes("input[type=file]")));
  assert.ok(!JSON.stringify(uploadWorkflow).includes("abc123"));

  const downloadWorkflowPromise = bridge.callTool("inspect_download_workflow", { projectTitle: "Codex Free" });
  await client.pollAndHandle();
  const downloadWorkflow = await downloadWorkflowPromise;
  assert.strictEqual(downloadWorkflow.nonMutating, true);
  assert.strictEqual(downloadWorkflow.requiresUserConfirmation, true);
  assert.strictEqual(downloadWorkflow.supportedDirectDownload, false);
  assert.strictEqual(downloadWorkflow.downloadControlCount, 3);
  assert.ok(downloadWorkflow.downloadControls.some((control) => control.downloadType === "project-zip"));
  assert.ok(downloadWorkflow.downloadCandidates.some((candidate) => candidate.downloadType === "pdf"));
  assert.ok(downloadWorkflow.blockers.some((blocker) => blocker.includes("read-only")));
  assert.ok(!JSON.stringify(downloadWorkflow).includes("abc123"));

  const commentsPromise = bridge.callTool("inspect_visible_comments", { projectTitle: "Codex Free" });
  await client.pollAndHandle();
  const comments = await commentsPromise;
  assert.strictEqual(comments.nonMutating, true);
  assert.strictEqual(comments.supportsWriteActions, false);
  assert.strictEqual(comments.requiresUserConfirmation, true);
  assert.strictEqual(comments.threadCount, 2);
  assert.ok(comments.threads.some((thread) => thread.preview.includes("Please clarify the bridge boundary.")));
  assert.ok(comments.actionControls.some((control) => control.action === "reply"));
  assert.ok(comments.blockers.some((blocker) => blocker.includes("read-only")));
  assert.ok(!JSON.stringify(comments).includes("abc123"));

  const commentPlanPromise = bridge.callTool("prepare_comment_action", {
    projectTitle: "Codex Free",
    action: "resolve",
    threadIndex: 0,
    reason: "prepare visible comment resolve only"
  });
  await client.pollAndHandle();
  const commentPlan = await commentPlanPromise;
  assert.strictEqual(commentPlan.ok, true);
  assert.strictEqual(commentPlan.action, "resolve");
  assert.strictEqual(commentPlan.readyToExecute, true);
  assert.strictEqual(commentPlan.nonMutating, true);
  assert.strictEqual(commentPlan.supportsWriteActions, false);
  assert.strictEqual(commentPlan.visibleThreadCount, 2);
  assert.strictEqual(commentPlan.threadListHash.length, 64);
  assert.ok(commentPlan.confirmationToken);
  assert.ok(commentPlan.confirmationPhrase.startsWith("CONFIRM COMMENT RESOLVE thread 0 "));
  assert.strictEqual(commentPlan.selectedThread.threadIndex, 0);
  assert.strictEqual(commentPlan.selectedThread.resolved, false);
  assert.ok(commentPlan.selectedThread.actionTypes.includes("resolve"));
  assert.ok(!JSON.stringify(commentPlan).includes("abc123"));

  await assert.rejects(
    () => bridge.callTool("execute_comment_action", {
      projectTitle: "Codex Free",
      confirmationToken: commentPlan.confirmationToken,
      confirmationPhrase: "WRONG PHRASE",
      threadListHash: commentPlan.threadListHash,
      reason: "wrong comment phrase guard"
    }),
    /confirmation phrase mismatch/
  );

  const executeResolvePromise = bridge.callTool("execute_comment_action", {
    projectTitle: "Codex Free",
    confirmationToken: commentPlan.confirmationToken,
    confirmationPhrase: commentPlan.confirmationPhrase,
    threadListHash: commentPlan.threadListHash,
    reason: "execute fake comment resolve"
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  await client.pollAndHandle();
  const executedResolve = await executeResolvePromise;
  assert.strictEqual(executedResolve.ok, true);
  assert.strictEqual(executedResolve.verification.status, "resolved");
  assert.strictEqual(client.commentThreads[0].resolved, true);

  const reopenPlanPromise = bridge.callTool("prepare_comment_action", {
    projectTitle: "Codex Free",
    action: "reopen",
    previewContains: "Resolved: wording",
    reason: "prepare visible comment reopen only"
  });
  await client.pollAndHandle();
  const reopenPlan = await reopenPlanPromise;
  assert.strictEqual(reopenPlan.ok, true);
  assert.strictEqual(reopenPlan.readyToExecute, true);
  assert.strictEqual(reopenPlan.selectedThread.threadIndex, 1);
  assert.ok(reopenPlan.confirmationPhrase.startsWith("CONFIRM COMMENT REOPEN thread 1 "));

  const executeReopenPromise = bridge.callTool("execute_comment_action", {
    projectTitle: "Codex Free",
    confirmationToken: reopenPlan.confirmationToken,
    confirmationPhrase: reopenPlan.confirmationPhrase,
    threadListHash: reopenPlan.threadListHash,
    reason: "execute fake comment reopen"
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  await client.pollAndHandle();
  const executedReopen = await executeReopenPromise;
  assert.strictEqual(executedReopen.verification.status, "reopened");
  assert.strictEqual(client.commentThreads[1].resolved, false);

  const deleteCommentPlanPromise = bridge.callTool("prepare_comment_action", {
    projectTitle: "Codex Free",
    action: "delete-comment",
    threadIndex: 1,
    reason: "prepare fake comment delete"
  });
  await client.pollAndHandle();
  const deleteCommentPlan = await deleteCommentPlanPromise;
  assert.strictEqual(deleteCommentPlan.readyToExecute, true);
  const executeDeleteCommentPromise = bridge.callTool("execute_comment_action", {
    projectTitle: "Codex Free",
    confirmationToken: deleteCommentPlan.confirmationToken,
    confirmationPhrase: deleteCommentPlan.confirmationPhrase,
    threadListHash: deleteCommentPlan.threadListHash,
    reason: "execute fake comment delete"
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  await client.pollAndHandle();
  const executedDeleteComment = await executeDeleteCommentPromise;
  assert.strictEqual(executedDeleteComment.verification.status, "deleted");
  assert.strictEqual(client.commentThreads.length, 1);

  const badCommentPlanPromise = bridge.callTool("prepare_comment_action", {
    projectTitle: "Codex Free",
    action: "resolve",
    previewContains: "not present",
    reason: "prepare missing comment guard"
  });
  await client.pollAndHandle();
  const badCommentPlan = await badCommentPlanPromise;
  assert.strictEqual(badCommentPlan.readyToExecute, false);
  assert.ok(badCommentPlan.blockers.some((blocker) => blocker.includes("matched the selector")));

  const createPlanPromise = bridge.callTool("prepare_file_operation", {
    projectTitle: "Codex Free",
    operation: "create",
    fileName: "sections/new_section.tex",
    reason: "prepare a new section file"
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  const createPlan = await createPlanPromise;
  assert.strictEqual(createPlan.ok, true);
  assert.strictEqual(createPlan.operation, "create");
  assert.strictEqual(createPlan.readyToExecute, true);
  assert.ok(createPlan.confirmationToken);
  assert.strictEqual(createPlan.confirmationPhrase, "CONFIRM CREATE sections/new_section.tex");
  assert.strictEqual(createPlan.nonMutating, true);
  assert.strictEqual(createPlan.visibleFileCount, Object.keys(client.files).length);
  assert.strictEqual(createPlan.fileListHash.length, 64);

  await assert.rejects(
    () => bridge.callTool("execute_file_operation", {
      projectTitle: "Codex Free",
      confirmationToken: createPlan.confirmationToken,
      confirmationPhrase: "WRONG PHRASE",
      fileListHash: createPlan.fileListHash,
      reason: "wrong phrase guard"
    }),
    /confirmation phrase mismatch/
  );

  const executeCreatePromise = bridge.callTool("execute_file_operation", {
    projectTitle: "Codex Free",
    confirmationToken: createPlan.confirmationToken,
    confirmationPhrase: createPlan.confirmationPhrase,
    fileListHash: createPlan.fileListHash,
    reason: "execute fake create"
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  await client.pollAndHandle();
  const executedCreate = await executeCreatePromise;
  assert.strictEqual(executedCreate.ok, true);
  assert.strictEqual(executedCreate.verification.status, "created");
  assert.ok(client.files["sections/new_section.tex"] !== undefined);

  const renamePlanPromise = bridge.callTool("prepare_file_operation", {
    projectTitle: "Codex Free",
    operation: "rename",
    fileName: "refs.bib",
    newFileName: "refs-renamed.bib",
    reason: "prepare fake rename"
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  const renamePlan = await renamePlanPromise;
  assert.strictEqual(renamePlan.readyToExecute, true);
  const executeRenamePromise = bridge.callTool("execute_file_operation", {
    projectTitle: "Codex Free",
    confirmationToken: renamePlan.confirmationToken,
    confirmationPhrase: renamePlan.confirmationPhrase,
    fileListHash: renamePlan.fileListHash,
    reason: "execute fake rename"
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  await client.pollAndHandle();
  const executedRename = await executeRenamePromise;
  assert.strictEqual(executedRename.verification.status, "renamed");
  assert.ok(!client.files["refs.bib"]);
  assert.ok(client.files["refs-renamed.bib"]);

  const deletePlanPromise = bridge.callTool("prepare_file_operation", {
    projectTitle: "Codex Free",
    operation: "delete",
    fileName: "sections/new_section.tex",
    reason: "prepare fake delete"
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  const deletePlan = await deletePlanPromise;
  assert.strictEqual(deletePlan.readyToExecute, true);
  const executeDeletePromise = bridge.callTool("execute_file_operation", {
    projectTitle: "Codex Free",
    confirmationToken: deletePlan.confirmationToken,
    confirmationPhrase: deletePlan.confirmationPhrase,
    fileListHash: deletePlan.fileListHash,
    reason: "execute fake delete"
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  await client.pollAndHandle();
  const executedDelete = await executeDeletePromise;
  assert.strictEqual(executedDelete.verification.status, "deleted");
  assert.ok(!client.files["sections/new_section.tex"]);

  const deleteMissingPlanPromise = bridge.callTool("prepare_file_operation", {
    projectTitle: "Codex Free",
    operation: "delete",
    fileName: "missing.tex",
    reason: "prepare delete guard"
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  const deleteMissingPlan = await deleteMissingPlanPromise;
  assert.strictEqual(deleteMissingPlan.readyToExecute, false);
  assert.ok(deleteMissingPlan.blockers.some((blocker) => blocker.includes("not visible")));

  const oldClient = new FakeOverleafClient(baseUrl, token, {
    clientId: "oldartifactclient",
    projectTitle: "Old Extension Project",
    contentScriptVersion: "0.3.1",
    supportsArtifactInventory: false,
    supportsFileOperationInspector: false,
    supportsUploadWorkflowInspector: false,
    supportsDownloadWorkflowInspector: false,
    supportsVisibleCommentsInspector: false
  });
  await oldClient.register();
  const oldArtifactsPromise = bridge.callTool("list_visible_artifacts", { projectTitle: "Old Extension" });
  await oldClient.pollAndHandle();
  const oldArtifacts = await oldArtifactsPromise;
  assert.strictEqual(oldArtifacts.reloadRequired, true);
  assert.strictEqual(oldArtifacts.artifactCount, 0);
  assert.deepStrictEqual(oldArtifacts.artifacts, []);
  assert.ok(oldArtifacts.reason.includes("reload the unpacked Chrome extension"));

  const oldArtifactExportPromise = bridge.callTool("export_artifact_inventory", { projectTitle: "Old Extension" });
  await oldClient.pollAndHandle();
  const oldArtifactExport = await oldArtifactExportPromise;
  assert.strictEqual(oldArtifactExport.reloadRequired, true);
  assert.ok(fs.existsSync(oldArtifactExport.exportPath));
  const oldArtifactInventory = JSON.parse(fs.readFileSync(oldArtifactExport.exportPath, "utf8"));
  assert.strictEqual(oldArtifactInventory.reloadRequired, true);
  assert.ok(!/xyz789|abc123|test-token|overleaf_session/i.test(JSON.stringify(oldArtifactInventory)));

  const oldVisibleArtifactPromise = bridge.callTool("export_visible_artifact", {
    projectTitle: "Old Extension",
    artifactType: "pdf"
  });
  await oldClient.pollAndHandle();
  const oldVisibleArtifact = await oldVisibleArtifactPromise;
  assert.strictEqual(oldVisibleArtifact.ok, false);
  assert.strictEqual(oldVisibleArtifact.reloadRequired, true);
  assert.ok(oldVisibleArtifact.reason.includes("reload the unpacked Chrome extension"));

  const oldFileUiPromise = bridge.callTool("inspect_file_operation_ui", { projectTitle: "Old Extension" });
  await oldClient.pollAndHandle();
  const oldFileUi = await oldFileUiPromise;
  assert.strictEqual(oldFileUi.reloadRequired, true);
  assert.strictEqual(oldFileUi.controlCount, 0);
  assert.deepStrictEqual(oldFileUi.controls, []);
  assert.ok(oldFileUi.reason.includes("reload the unpacked Chrome extension"));

  const legacySchemaClient = new FakeOverleafClient(baseUrl, token, {
    clientId: "legacyfileuiclient",
    projectTitle: "Legacy File UI Project",
    contentScriptVersion: "0.5.18",
    legacyFileOperationUiSchema: true
  });
  await legacySchemaClient.register();
  const legacyFileUiPromise = bridge.callTool("inspect_file_operation_ui", { projectTitle: "Legacy File UI" });
  await legacySchemaClient.pollAndHandle();
  const legacyFileUi = await legacyFileUiPromise;
  assert.strictEqual(legacyFileUi.reloadRequired, true);
  assert.strictEqual(legacyFileUi.staleSchema, true);
  assert.strictEqual(legacyFileUi.fileOperationUiSchemaVersion, 0);
  assert.ok(legacyFileUi.reason.includes("stale file-operation UI schema"));

  const legacyCreatePlanPromise = bridge.callTool("prepare_file_operation", {
    projectTitle: "Legacy File UI",
    operation: "create",
    fileName: "sections/legacy_intro.tex",
    reason: "prepare against stale schema"
  });
  await legacySchemaClient.pollAndHandle();
  await legacySchemaClient.pollAndHandle();
  const legacyCreatePlan = await legacyCreatePlanPromise;
  assert.strictEqual(legacyCreatePlan.readyToExecute, false);
  assert.strictEqual(legacyCreatePlan.ui.reloadRequired, true);
  assert.strictEqual(legacyCreatePlan.ui.staleSchema, true);
  assert.ok(legacyCreatePlan.blockers.some((blocker) => blocker.includes("reload the unpacked Chrome extension")));
  assert.ok(!legacyCreatePlan.blockers.some((blocker) => blocker.includes("parent folder is not visible")));

  const schemaV2Client = new FakeOverleafClient(baseUrl, token, {
    clientId: "schemav2fileuiclient",
    projectTitle: "Schema V2 File UI Project",
    contentScriptVersion: "0.5.19",
    fileOperationUiSchemaVersion: 2
  });
  await schemaV2Client.register();
  const schemaV2FileUiPromise = bridge.callTool("inspect_file_operation_ui", { projectTitle: "Schema V2 File UI" });
  await schemaV2Client.pollAndHandle();
  const schemaV2FileUi = await schemaV2FileUiPromise;
  assert.strictEqual(schemaV2FileUi.reloadRequired, true);
  assert.strictEqual(schemaV2FileUi.staleSchema, true);
  assert.strictEqual(schemaV2FileUi.fileOperationUiSchemaVersion, 2);
  assert.ok(schemaV2FileUi.reason.includes("stale file-operation UI schema"));

  const oldUploadWorkflowPromise = bridge.callTool("inspect_upload_workflow", { projectTitle: "Old Extension" });
  await oldClient.pollAndHandle();
  const oldUploadWorkflow = await oldUploadWorkflowPromise;
  assert.strictEqual(oldUploadWorkflow.reloadRequired, true);
  assert.strictEqual(oldUploadWorkflow.uploadControlCount, 0);
  assert.strictEqual(oldUploadWorkflow.requiresUserFilePicker, true);
  assert.strictEqual(oldUploadWorkflow.nonMutating, true);
  assert.ok(oldUploadWorkflow.reason.includes("reload the unpacked Chrome extension"));

  const oldDownloadWorkflowPromise = bridge.callTool("inspect_download_workflow", { projectTitle: "Old Extension" });
  await oldClient.pollAndHandle();
  const oldDownloadWorkflow = await oldDownloadWorkflowPromise;
  assert.strictEqual(oldDownloadWorkflow.reloadRequired, true);
  assert.strictEqual(oldDownloadWorkflow.downloadControlCount, 0);
  assert.strictEqual(oldDownloadWorkflow.supportedDirectDownload, false);
  assert.strictEqual(oldDownloadWorkflow.requiresUserConfirmation, true);
  assert.strictEqual(oldDownloadWorkflow.nonMutating, true);
  assert.ok(oldDownloadWorkflow.reason.includes("reload the unpacked Chrome extension"));

  const oldCommentsPromise = bridge.callTool("inspect_visible_comments", { projectTitle: "Old Extension" });
  await oldClient.pollAndHandle();
  const oldComments = await oldCommentsPromise;
  assert.strictEqual(oldComments.reloadRequired, true);
  assert.strictEqual(oldComments.threadCount, 0);
  assert.strictEqual(oldComments.nonMutating, true);
  assert.strictEqual(oldComments.supportsWriteActions, false);
  assert.ok(oldComments.reason.includes("reload the unpacked Chrome extension"));

  const oldCommentPlanPromise = bridge.callTool("prepare_comment_action", {
    projectTitle: "Old Extension",
    action: "resolve",
    threadIndex: 0,
    reason: "prepare stale comment guard"
  });
  await oldClient.pollAndHandle();
  const oldCommentPlan = await oldCommentPlanPromise;
  assert.strictEqual(oldCommentPlan.readyToExecute, false);
  assert.strictEqual(oldCommentPlan.ui.reloadRequired, true);
  assert.ok(oldCommentPlan.blockers.some((blocker) => blocker.includes("reload")));
  assert.ok(oldCommentPlan.confirmationPhrase.includes("unselected thread"));

  const oldPreparePromise = bridge.callTool("prepare_file_operation", {
    projectTitle: "Old Extension",
    operation: "rename",
    fileName: "main.tex",
    newFileName: "main-renamed.tex",
    reason: "prepare rename with stale extension"
  });
  await oldClient.pollAndHandle();
  await oldClient.pollAndHandle();
  const oldPrepare = await oldPreparePromise;
  assert.strictEqual(oldPrepare.readyToExecute, false);
  assert.strictEqual(oldPrepare.ui.reloadRequired, true);
  assert.ok(oldPrepare.blockers.some((blocker) => blocker.includes("reload")));
  assert.ok(oldPrepare.confirmationPhrase.includes("main.tex -> main-renamed.tex"));

  const restoreRead = await queueReadFile(bridge, client, "main.tex", "main.tex");
  const restorePromise = bridge.callTool("restore_from_snapshot", {
    projectTitle: "Codex Free",
    expectedFileName: "main.tex",
    beforeHash: restoreRead.beforeHash,
    reason: "restore previous main snapshot",
    snapshotPath: replacedFile.snapshotPath
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  await client.pollAndHandle();
  const restored = await restorePromise;
  assert.strictEqual(restored.ok, true);
  assert.ok(client.files["main.tex"].includes("\\documentclass"));

  const log = await bridge.callTool("get_recent_patch_log", { limit: 20 });
  assert.ok(log.records.length >= 4);
  const serializedLog = JSON.stringify(log.records);
  assert.ok(!/overleaf_session|session2|password|git\.overleaf\.com|abc123|xyz789|test-token/i.test(serializedLog));

  const mcpInit = await handleMcpRequest(bridge, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.strictEqual(mcpInit.result.serverInfo.name, "overleaf-browser-bridge");
  assert.strictEqual(mcpInit.result.serverInfo.version, "0.5.31");
  const mcpTools = await handleMcpRequest(bridge, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  for (const toolName of PUBLIC_TOOLS) assert.ok(mcpTools.result.tools.some((tool) => tool.name === toolName));

  validateStdioParser();
  await validateContentScriptDomHelpers();
  await validateBackgroundBridgeProxy();
  validateManifest();
  await bridge.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("overleaf-browser-bridge tests passed");
}

async function queueReadFile(bridge, client, fileName, expectedFileName) {
  const promise = bridge.callTool("read_file", {
    projectTitle: "Codex Free",
    fileName,
    expectedFileName
  });
  await client.pollAndHandle();
  await client.pollAndHandle();
  return promise;
}

async function startFakeMirrorWorkflowServer(tmp, token) {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (req.url !== "/tools/call" || req.method !== "POST") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      const body = raw ? JSON.parse(raw) : {};
      const toolArgs = body.arguments || {};
      let payload;
      if (body.name === "preview_mirror_diff") {
        payload = {
          ok: true,
          projectTitle: toolArgs.projectTitle,
          mirrorRoot: path.join(tmp, "mirror-root"),
          manifestPath: path.join(tmp, "mirror-root", "manifest.json"),
          comparedFileCount: 2,
          changedFileCount: 1,
          addedFileCount: 0,
          removedFileCount: 0,
          files: [
            {
              path: "main.tex",
              fileName: "main.tex",
              status: "changed",
              currentHash: "b".repeat(64),
              mirrorHash: "c".repeat(64),
              diff: "PRIVATE DIFF TEXT",
              diffLineCount: 4,
              diffTruncated: false
            },
            {
              path: "refs.bib",
              fileName: "refs.bib",
              status: "unchanged",
              currentHash: "d".repeat(64),
              mirrorHash: "d".repeat(64),
              diff: "",
              diffLineCount: 0,
              diffTruncated: false
            }
          ]
        };
      } else if (body.name === "prepare_mirror_sync_plan") {
        payload = {
          ok: true,
          projectTitle: toolArgs.projectTitle,
          direction: toolArgs.direction,
          readyToExecute: toolArgs.direction !== "review_only",
          supportsAutomaticSync: false,
          confirmationToken: "token-1",
          confirmationPhrase: `CONFIRM MIRROR SYNC ${String(toolArgs.direction || "").toUpperCase()}`,
          syncPlanHash: "a".repeat(64),
          blockers: [],
          actions: [
            {
              path: "main.tex",
              operation: toolArgs.direction === "mirror_to_overleaf" ? "update_overleaf_file_from_mirror" : "update_mirror_file_from_overleaf",
              currentHash: "b".repeat(64),
              mirrorHash: "c".repeat(64)
            }
          ]
        };
      } else if (body.name === "execute_mirror_sync_plan") {
        payload = {
          ok: true,
          action: "overleaf_to_mirror",
          projectTitle: toolArgs.projectTitle,
          oldMirrorRoot: path.join(tmp, "old-mirror"),
          newMirrorRoot: path.join(tmp, "new-mirror"),
          syncPlanHash: toolArgs.syncPlanHash,
          confirmationToken: toolArgs.confirmationToken,
          mirrorWritten: true,
          nonMutatingOverleaf: true,
          mutatingOverleaf: false
        };
      } else {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `unexpected tool ${body.name}` }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, result: payload }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const infoPath = path.join(tmp, "mirror-workflow-server-info.json");
  fs.writeFileSync(infoPath, JSON.stringify({
    serverUrl: `http://127.0.0.1:${address.port}`,
    token
  }), "utf8");
  return {
    infoPath,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function rawRequest(baseUrl, urlPath, options) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method: options.method,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  if (options.expectOk !== false) {
    assert.ok(response.ok, `${urlPath} failed with ${response.status}: ${text}`);
  }
  return {
    status: response.status,
    ok: response.ok,
    ...(text ? JSON.parse(text) : {})
  };
}

function validateStdioParser() {
  const messages = [];
  const parser = createStdioMessageParser((raw, mode) => {
    messages.push({ raw, mode });
  });
  parser.feed('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
  const framed = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} });
  parser.feed(`Content-Length: ${Buffer.byteLength(framed, "utf8")}\r\n\r\n${framed}`);
  assert.strictEqual(messages.length, 2);
  assert.strictEqual(messages[0].mode, "jsonl");
  assert.strictEqual(JSON.parse(messages[0].raw).method, "tools/list");
  assert.strictEqual(messages[1].mode, "content-length");
  assert.strictEqual(JSON.parse(messages[1].raw).method, "initialize");
}

class FakeOverleafClient {
  constructor(baseUrl, token, options = {}) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.clientId = options.clientId || "testclient1";
    this.projectTitle = options.projectTitle || "Codex Free Sync Test";
    this.pageUrl = options.pageUrl || "https://www.overleaf.com/project/abc123";
    this.currentPath = options.currentPath || "main.tex";
    this.files = options.files || {
      "main.tex": "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n",
      "sections/01_introduction.tex": "\\section{Introduction}\nHello from Overleaf.\n\\subsection{Motivation}\nWhy this bridge exists.\n\\section{Related Work}\nPrior systems use Git tokens.\n",
      "refs.bib": "@article{codex2026,title={Bridge}}\n",
      "figures/overview.png": "fake image bytes"
    };
    this.selection = "";
    this.compileResult = options.compileResult || null;
    this.compileDelayMs = Number(options.compileDelayMs || 0);
    this.contentScriptVersion = options.contentScriptVersion || "0.5.31";
    this.supportsArtifactInventory = options.supportsArtifactInventory !== false;
    this.artifactBytes = null;
    this.supportsFileOperationInspector = options.supportsFileOperationInspector !== false;
    this.legacyFileOperationUiSchema = Boolean(options.legacyFileOperationUiSchema);
    this.fileOperationUiSchemaVersion = options.fileOperationUiSchemaVersion || 9;
    this.supportsUploadWorkflowInspector = options.supportsUploadWorkflowInspector !== false;
    this.supportsDownloadWorkflowInspector = options.supportsDownloadWorkflowInspector !== false;
    this.supportsVisibleCommentsInspector = options.supportsVisibleCommentsInspector !== false;
    this.commentThreads = options.commentThreads || [
      {
        source: "article",
        role: "article",
        label: "Review comment",
        preview: "Please clarify the bridge boundary.",
        visible: true,
        resolved: false,
        lineNumber: 12,
            actions: [
              { action: "reply", label: "Reply", visible: true, disabled: false, actionOnly: true },
              { action: "resolve", label: "Resolve", visible: true, disabled: false, actionOnly: true },
              { action: "delete-comment", label: "Delete comment", visible: true, disabled: false, actionOnly: true }
            ],
        replyCount: 0
      },
      {
        source: "article",
        role: "article",
        label: "Resolved comment",
        preview: "Resolved: wording updated.",
        visible: true,
        resolved: true,
        lineNumber: 18,
            actions: [
              { action: "reopen", label: "Reopen", visible: true, disabled: false, actionOnly: true },
              { action: "delete-comment", label: "Delete comment", visible: true, disabled: false, actionOnly: true }
            ],
        replyCount: 0
      }
    ];
  }

  async register() {
    await this.request("/bridge/register", {
      method: "POST",
      body: {
        clientId: this.clientId,
        pageUrl: this.pageUrl,
        projectTitle: this.projectTitle,
        fileName: `description${this.fileName()}more_vert`,
        editorMode: "source",
        contentScriptVersion: this.contentScriptVersion
      }
    });
  }

  async pollAndHandle() {
    const next = await this.request(`/bridge/next?clientId=${this.clientId}`, { method: "GET" });
    assert.ok(next.ok);
    assert.ok(next.command, "expected queued command");
    const command = next.command;
    let payload;
    if (command.type === "health_check") {
      payload = { ...this.meta(), isOverleafProject: true, tokenConfigured: true, editorReadable: true, editorWritable: true };
    } else if (command.type === "get_current_project") {
      payload = this.meta();
    } else if (command.type === "list_open_project_files") {
      payload = {
        ...this.meta(),
        files: Object.keys(this.files).map((filePath) => ({
          fileName: path.basename(filePath),
          path: filePath,
          selected: filePath === this.currentPath,
          depth: filePath.includes("/") ? 2 : 1
        }))
      };
    } else if (command.type === "open_file") {
      const fileName = command.payload.fileName;
      const found = Object.keys(this.files).find((candidate) => candidate === fileName || path.basename(candidate) === fileName);
      if (!found) throw new Error(`test file not found: ${fileName}`);
      this.currentPath = found;
      payload = { ...this.meta(), openedFileName: this.fileName() };
    } else if (command.type === "read_current_file") {
      payload = { ...this.meta(), text: this.files[this.currentPath] };
    } else if (command.type === "get_selection") {
      const text = this.files[this.currentPath];
      payload = {
        ...this.meta(),
        selectedText: this.selection,
        hasSelection: Boolean(this.selection),
        startOffsetApprox: text.indexOf(this.selection),
        endOffsetApprox: text.indexOf(this.selection) + this.selection.length,
        contextBefore: "",
        contextAfter: ""
      };
    } else if (command.type === "get_editor_diagnostics") {
      const diagnostic = {
        text: "Undefined control sequence",
        title: "",
        ariaLabel: "",
        className: "cm-diagnostic cm-diagnostic-error",
        role: "tooltip",
        lineNumber: 3,
        visible: true
      };
      payload = {
        ...this.meta(),
        diagnostics: [diagnostic],
        diagnosticCount: 1,
        visibleDiagnostics: [diagnostic]
      };
    } else if (command.type === "replace_selection") {
      const replacement = command.payload.replacement || "";
      if (!this.selection) throw new Error("test selection is empty");
      this.files[this.currentPath] = this.files[this.currentPath].replace(this.selection, replacement);
      this.selection = replacement;
      payload = { ...this.meta(), replacementLength: replacement.length };
    } else if (command.type === "insert_text") {
      const inserted = command.payload.text || "";
      this.files[this.currentPath] += inserted;
      payload = { ...this.meta(), insertedLength: inserted.length };
    } else if (command.type === "replace_file") {
      this.files[this.currentPath] = String(command.payload.text || "");
      payload = { ...this.meta(), replacementLength: this.files[this.currentPath].length };
    } else if (command.type === "execute_file_operation") {
      const operation = command.payload.operation;
      const fileName = command.payload.fileName;
      const newFileName = command.payload.newFileName;
      if (operation === "create") {
        if (this.files[fileName] !== undefined) throw new Error(`test file already exists: ${fileName}`);
        this.files[fileName] = "";
        this.currentPath = fileName;
      } else if (operation === "rename") {
        if (this.files[fileName] === undefined) throw new Error(`test file not found: ${fileName}`);
        if (this.files[newFileName] !== undefined) throw new Error(`test destination already exists: ${newFileName}`);
        this.files[newFileName] = this.files[fileName];
        delete this.files[fileName];
        this.currentPath = newFileName;
      } else if (operation === "delete") {
        if (this.files[fileName] === undefined) throw new Error(`test file not found: ${fileName}`);
        delete this.files[fileName];
        this.currentPath = Object.keys(this.files)[0] || "";
      } else {
        throw new Error(`unsupported test file operation: ${operation}`);
      }
      payload = { ...this.meta(), operation, fileName, newFileName, executed: true };
    } else if (command.type === "execute_comment_action") {
      const action = command.payload.action;
      const threadIndex = Number(command.payload.threadIndex);
      const thread = this.commentThreads[threadIndex];
      if (!thread) throw new Error(`test comment thread not found: ${threadIndex}`);
      if (action === "reply") {
        const replyText = String(command.payload.replyText || "");
        if (!replyText.trim()) throw new Error("test replyText is empty");
        thread.replyCount = Number(thread.replyCount || 0) + 1;
      } else if (action === "resolve") {
        thread.resolved = true;
        thread.actions = [
          { action: "reopen", label: "Reopen", visible: true, disabled: false, actionOnly: true },
          { action: "delete-comment", label: "Delete comment", visible: true, disabled: false, actionOnly: true }
        ];
      } else if (action === "reopen") {
        thread.resolved = false;
        thread.actions = [
          { action: "reply", label: "Reply", visible: true, disabled: false, actionOnly: true },
          { action: "resolve", label: "Resolve", visible: true, disabled: false, actionOnly: true },
          { action: "delete-comment", label: "Delete comment", visible: true, disabled: false, actionOnly: true }
        ];
      } else if (action === "delete-comment") {
        this.commentThreads.splice(threadIndex, 1);
      } else {
        throw new Error(`unsupported test comment action: ${action}`);
      }
      payload = {
        ...this.meta(),
        action,
        threadIndex,
        executed: true,
        replyTextLength: action === "reply" ? String(command.payload.replyText || "").length : 0
      };
    } else if (command.type === "compile_project") {
      if (this.compileDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.compileDelayMs));
      payload = {
        ...this.meta(),
        ...(this.compileResult || {
          compileCompleted: true,
          compileTimedOut: false,
          visibleStatus: "Errors 1 | Warnings 1",
          logSnippet: "Recompile complete. All logs7 | Errors0 | Warnings0 | Output written on output.pdf (11 pages, 218216 bytes)"
        })
      };
    } else if (command.type === "list_visible_artifacts") {
      if (!this.supportsArtifactInventory) {
        await this.request("/bridge/result", {
          method: "POST",
          body: {
            id: command.id,
            ok: false,
            error: "unknown command: list_visible_artifacts"
          }
        });
        return;
      }
      payload = {
        ...this.meta(),
        artifactCount: 3,
        artifacts: [
          {
            type: "pdf",
            source: "iframe",
            label: "PDF preview",
            url: "https://www.overleaf.com/project/<redacted>/output/output.pdf",
            visible: true
          },
          {
            type: "log",
            source: "button",
            label: "Logs and output files",
            url: "",
            visible: true,
            actionOnly: true
          },
          {
            type: "bbl",
            source: "a",
            label: "main.bbl",
            url: "https://www.overleaf.com/project/<redacted>/output/main.bbl",
            visible: true
          }
        ]
      };
    } else if (command.type === "export_visible_artifact") {
      if (!this.supportsArtifactInventory) {
        await this.request("/bridge/result", {
          method: "POST",
          body: {
            id: command.id,
            ok: false,
            error: "unknown command: export_visible_artifact"
          }
        });
        return;
      }
      const artifactBytes = this.artifactBytes || Buffer.from("%PDF-1.7\n% fake overleaf pdf\n", "utf8");
      payload = {
        ...this.meta(),
        ok: true,
        type: command.payload.artifactType || "pdf",
        source: "iframe",
        label: "PDF preview",
        url: "https://www.overleaf.com/project/<redacted>/output/output.pdf",
        selectedIndex: 0,
        fileName: "output.pdf",
        mimeType: "application/pdf",
        byteLength: artifactBytes.length,
        base64: artifactBytes.toString("base64")
      };
    } else if (command.type === "inspect_file_operation_ui") {
      if (!this.supportsFileOperationInspector) {
        await this.request("/bridge/result", {
          method: "POST",
          body: {
            id: command.id,
            ok: false,
            error: "unknown command: inspect_file_operation_ui"
          }
        });
        return;
      }
      payload = {
        ...this.meta(),
        selectedFile: this.fileName(),
        controlCount: 4,
        controls: [
          { operation: "create", source: "button", role: "button", label: "New file", visible: true, disabled: false, score: 160, actionOnly: true },
          { operation: "rename", source: "button", role: "menuitem", label: "Rename", visible: true, disabled: false, score: 122, actionOnly: true },
          { operation: "delete", source: "button", role: "menuitem", label: "Delete file", visible: true, disabled: false, score: 122, actionOnly: true },
          { operation: "upload", source: "input", role: "", label: "Upload file", visible: false, disabled: false, score: 125, actionOnly: true }
        ]
      };
      if (!this.legacyFileOperationUiSchema) {
        payload.fileOperationUiSchemaVersion = this.fileOperationUiSchemaVersion;
        payload.capabilities = {
          rankedOperationControls: true,
          visibleFolders: true,
          scopedFileDialogInputs: true
        };
        payload.visibleFolderCount = this.visibleFolders().length;
        payload.visibleFolders = this.visibleFolders();
      } else {
        payload.controls = payload.controls.map(({ score, ...control }) => control);
      }
    } else if (command.type === "inspect_upload_workflow") {
      if (!this.supportsUploadWorkflowInspector) {
        await this.request("/bridge/result", {
          method: "POST",
          body: {
            id: command.id,
            ok: false,
            error: "unknown command: inspect_upload_workflow"
          }
        });
        return;
      }
      payload = {
        ...this.meta(),
        uploadControlCount: 2,
        uploadControls: [
          { source: "input", role: "", label: "Upload file", visible: false, disabled: false, accept: ".png,.jpg,.jpeg,.pdf", multiple: true, directory: false, actionOnly: true },
          { source: "button", role: "button", label: "Upload image", visible: true, disabled: false, accept: "", multiple: false, directory: false, actionOnly: true }
        ],
        dropzoneCount: 1,
        dropzones: [
          { source: "div", role: "", label: "Drop files here to upload", visible: true, disabled: false, actionOnly: true }
        ],
        acceptValues: [".png,.jpg,.jpeg,.pdf"],
        imageCandidateCount: 1,
        imageCandidates: [
          { fileName: "figures/overview.png", path: "figures/overview.png", selected: false, depth: 2 }
        ],
        supportedLocalSelection: false,
        requiresUserFilePicker: true,
        nonMutating: true,
        blockers: [
          "Browser security prevents content scripts from assigning local files to input[type=file]."
        ],
        recommendations: [
          "Use the visible upload dialog manually, then reference the uploaded image from LaTeX."
        ]
      };
    } else if (command.type === "inspect_download_workflow") {
      if (!this.supportsDownloadWorkflowInspector) {
        await this.request("/bridge/result", {
          method: "POST",
          body: {
            id: command.id,
            ok: false,
            error: "unknown command: inspect_download_workflow"
          }
        });
        return;
      }
      payload = {
        ...this.meta(),
        downloadControlCount: 3,
        downloadControls: [
          { downloadType: "project-zip", source: "button", role: "menuitem", label: "Download project", url: "", visible: true, disabled: false, actionOnly: true },
          { downloadType: "source-file", source: "button", role: "button", label: "Download file", url: "", visible: true, disabled: false, actionOnly: true },
          { downloadType: "pdf", source: "a", role: "", label: "Download PDF", url: "https://www.overleaf.com/project/<redacted>/output/output.pdf", visible: true, disabled: false, actionOnly: false }
        ],
        downloadCandidateCount: 3,
        downloadCandidates: [
          { kind: "visible-artifact", downloadType: "pdf", index: 0, source: "iframe", label: "PDF preview", url: "https://www.overleaf.com/project/<redacted>/output/output.pdf", visible: true, actionOnly: false },
          { kind: "visible-artifact", downloadType: "log", index: 1, source: "button", label: "Logs and output files", url: "", visible: true, actionOnly: true },
          { kind: "selected-source-file", downloadType: "source-file", index: 0, fileName: this.fileName(), path: this.currentPath, selected: true, depth: this.currentPath.includes("/") ? 2 : 1, actionOnly: true }
        ],
        supportedDirectDownload: false,
        requiresUserConfirmation: true,
        nonMutating: true,
        blockers: [
          "This tool is read-only; it does not click Overleaf download controls or fetch files."
        ],
        recommendations: [
          "Use list_visible_artifacts or export_visible_artifact for one visible output artifact when a redacted downloadable URL is available."
        ]
      };
    } else if (command.type === "inspect_visible_comments") {
      if (!this.supportsVisibleCommentsInspector) {
        await this.request("/bridge/result", {
          method: "POST",
          body: {
            id: command.id,
            ok: false,
            error: "unknown command: inspect_visible_comments"
          }
        });
        return;
      }
      payload = {
        ...this.meta(),
        threadCount: this.commentThreads.length,
        threads: this.commentThreads.map((thread) => ({
          ...thread,
          actionCount: (thread.actions || []).length,
          actions: thread.actions || []
        })),
        actionControlCount: this.commentThreads.reduce((count, thread) => count + (thread.actions || []).length, 0),
        actionControls: this.commentThreads.flatMap((thread) => (thread.actions || []).map((action) => ({
          ...action,
          source: "button",
          role: "button"
        }))),
        nonMutating: true,
        supportsWriteActions: false,
        requiresUserConfirmation: true,
        blockers: [
          "This tool is read-only; replying, resolving, reopening, or deleting comments is intentionally not automated."
        ],
        recommendations: [
          "Open the comments panel before scanning."
        ]
      };
    } else {
      throw new Error(`unknown command in test: ${command.type}`);
    }

    await this.request("/bridge/result", {
      method: "POST",
      body: {
        id: command.id,
        ok: true,
        payload
      }
    });
  }

  fileName() {
    return path.basename(this.currentPath);
  }

  visibleFolders() {
    const folders = new Set();
    for (const filePath of Object.keys(this.files)) {
      const parts = filePath.split("/");
      for (let index = 1; index < parts.length; index += 1) {
        folders.add(parts.slice(0, index).join("/"));
      }
    }
    return Array.from(folders).sort().map((folderPath) => ({
      folderName: path.basename(folderPath),
      path: folderPath,
      selected: false,
      depth: folderPath.split("/").length,
      expanded: true
    }));
  }

  meta() {
    return {
      projectTitle: this.projectTitle,
      fileName: this.fileName(),
      editorMode: "source",
      pageUrl: this.pageUrl.replace(/\/project\/[^/?#]+/, "/project/<redacted>")
    };
  }

  async request(urlPath, options) {
    const response = await fetch(`${this.baseUrl}${urlPath}`, {
      method: options.method,
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json"
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const text = await response.text();
    assert.ok(response.ok, `${urlPath} failed with ${response.status}: ${text}`);
    return text ? JSON.parse(text) : {};
  }
}

function validateManifest() {
  const manifestPath = path.resolve(__dirname, "../extension/manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.strictEqual(manifest.manifest_version, 3);
  assert.strictEqual(manifest.background.service_worker, "background.js");
  assert.ok(manifest.host_permissions.includes("https://*.overleaf.com/project/*"));
  assert.ok(manifest.content_scripts[0].matches.includes("https://*.overleaf.com/project/*"));
  assert.ok(manifest.content_scripts.every((entry) => entry.matches.includes("https://*.overleaf.com/project/*")));
  assert.ok(!manifest.host_permissions.includes("https://www.overleaf.com/project/*"));
  assert.ok(manifest.content_scripts.some((entry) => (entry.js || []).includes("pageBridge.js") && entry.world === "MAIN"));
  assert.ok(manifest.content_scripts.some((entry) => (entry.js || []).includes("contentScript.js")));
  assert.ok(!manifest.permissions.includes("cookies"));
  assert.ok(!manifest.permissions.includes("history"));
}

async function validateBackgroundBridgeProxy() {
  const source = fs.readFileSync(path.resolve(__dirname, "../extension/background.js"), "utf8");
  let messageListener = null;
  const requests = [];
  const sandbox = {
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          }
        }
      }
    },
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      return { ok: true, status: 200, text: async () => '{"ok":true}' };
    },
    URL,
    Set,
    String,
    Promise
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "extension/background.js" });
  const hooks = sandbox.__overleafBridgeBackgroundTestHooks;
  assert.ok(hooks, "background bridge test hooks were not exposed");
  assert.strictEqual(typeof messageListener, "function");
  assert.ok(hooks.parseBridgeTarget("http://127.0.0.1:38475", "/bridge/register"));
  assert.ok(hooks.parseBridgeTarget("https://overleaf.example.com", "/bridge/next?clientId=test"));
  assert.strictEqual(hooks.parseBridgeTarget("http://127.0.0.1:38475", "/tools/call"), null);
  assert.strictEqual(hooks.parseBridgeTarget("javascript:alert(1)", "/bridge/register"), null);

  const response = await hooks.proxyBridgeRequest({
    serverUrl: "http://127.0.0.1:38475",
    path: "/bridge/register",
    method: "POST",
    body: '{"clientId":"test"}',
    token: "test-token"
  });
  assert.strictEqual(response.ok, true);
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].url, "http://127.0.0.1:38475/bridge/register");
  assert.strictEqual(requests[0].options.headers.Authorization, "Bearer test-token");
}

async function validateContentScriptDomHelpers() {
  const hooks = loadContentScriptTestHooks();
  const bigContainer = new FakeElement("div", {
    text: "keyboard_arrow_downFile treenote_addNew filecreate_new_folderNew folderuploadUploaddeleteDelete",
    attrs: { "aria-label": "File tree New file New folder Upload Delete" }
  });
  const realNewFileButton = new FakeElement("button", { text: "note_addNew file" });
  const addFilesMenuButton = new FakeElement("button", {
    text: "descriptionNew file",
    attrs: { role: "menuitem" }
  });
  const rankedCreate = hooks.rankFileOperationControlElements([
    bigContainer,
    addFilesMenuButton,
    realNewFileButton
  ], "create");
  assert.strictEqual(rankedCreate[0].element, realNewFileButton);
  assert.ok(!rankedCreate.some((candidate) => candidate.element === bigContainer));

  const localizedNewFileButton = new FakeElement("button", { text: "新建文件" });
  const localizedNewFolderButton = new FakeElement("button", { text: "新建目录" });
  const localizedUploadButton = new FakeElement("button", { text: "上传" });
  const topFileMenuButton = new FakeElement("button", {
    text: "文件",
    attrs: { class: "toolbar-menu-bar-item" }
  });
  const pdfZoomOutButton = new FakeElement("button", { text: "remove | 缩小" });
  assert.strictEqual(hooks.classifyFileOperationControl("新建文件", localizedNewFileButton), "create");
  assert.strictEqual(hooks.classifyFileOperationControl("新建目录", localizedNewFolderButton), "create");
  assert.strictEqual(hooks.classifyFileOperationControl("上传", localizedUploadButton), "upload");
  assert.strictEqual(hooks.classifyFileOperationControl("文件", topFileMenuButton), "");
  assert.strictEqual(hooks.classifyFileOperationControl("remove | 缩小", pdfZoomOutButton), "");

  const dialog = new FakeElement("div", { attrs: { role: "dialog" } });
  const fileNameInput = new FakeElement("input", {
    parent: dialog,
    attrs: { type: "text", placeholder: "File name" }
  });
  const shareInput = new FakeElement("input", {
    parent: dialog,
    attrs: { type: "email", placeholder: "Email address" }
  });
  const searchInput = new FakeElement("input", {
    attrs: { type: "search", placeholder: "Search files" }
  });
  const rankedInputs = hooks.rankDialogTextInputElements([shareInput, searchInput, fileNameInput], "create");
  assert.strictEqual(rankedInputs[0].input, fileNameInput);
  assert.ok(!rankedInputs.some((candidate) => candidate.input === shareInput));

  const localizedDialog = new FakeElement("div", {
    text: "新建文件",
    attrs: { role: "dialog" }
  });
  const localizedFileNameInput = new FakeElement("input", {
    parent: localizedDialog,
    attrs: { type: "text", placeholder: "文件名" }
  });
  let localizedCreateClicked = false;
  new FakeElement("button", {
    parent: localizedDialog,
    text: "创建",
    onClick: () => { localizedCreateClicked = true; }
  });
  const localizedDialogHooks = loadContentScriptTestHooks({
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector.includes("[role='dialog'] input")) return [localizedFileNameInput];
      return [];
    }
  });
  await localizedDialogHooks.fillDialogTextAndConfirm("supplementary.tex", ["Create", "创建"], "create");
  assert.strictEqual(localizedFileNameInput.value, "supplementary.tex");
  assert.strictEqual(localizedCreateClicked, true);

  const shareDialog = new FakeElement("div", {
    text: "共享该项目 添加邮件地址",
    attrs: { role: "dialog" }
  });
  const blockingHooks = loadContentScriptTestHooks({
    querySelectorAll(selector) {
      if (selector.includes("[role='dialog']")) return [shareDialog];
      return [];
    }
  });
  assert.throws(() => blockingHooks.assertNoBlockingDialog(), /close the visible Overleaf dialog/);

  const sectionsFolder = new FakeElement("div", {
    text: "folder sections",
    attrs: { role: "treeitem", "aria-level": "1", "aria-expanded": "true" }
  });
  const introFile = new FakeElement("div", {
    text: "description 01_introduction.tex",
    attrs: { role: "treeitem", "aria-level": "2" }
  });
  const outlineHeading = new FakeElement("div", {
    text: "Introduction",
    attrs: { role: "treeitem", "aria-level": "1", "aria-expanded": "false" }
  });
  const entries = hooks.collectFileTreeEntriesFromItems([sectionsFolder, introFile, outlineHeading]);
  assert.ok(entries.some((entry) => entry.kind === "folder" && entry.path === "sections"));
  assert.ok(entries.some((entry) => entry.kind === "file" && entry.path === "sections/01_introduction.tex"));
  assert.ok(!entries.some((entry) => entry.path === "Introduction"));

  const realDomSectionsFolder = new FakeElement("li", {
    text: "chevron_rightsections",
    attrs: { role: "treeitem", "aria-label": "sections", "aria-expanded": "false" }
  });
  const outlineTree = new FakeElement("ul", {
    attrs: { role: "tree", class: "outline-item-list outline-item-list-root" }
  });
  const realDomOutlineHeading = new FakeElement("li", {
    parent: outlineTree,
    text: "Introduction",
    attrs: { role: "treeitem", "aria-label": "Introduction", class: "outline-item outline-item-no-children" }
  });
  const trustedRootEntries = hooks.collectFileTreeEntriesFromItems(
    [realDomSectionsFolder, realDomOutlineHeading],
    { trustFileTreeRoot: true }
  );
  assert.ok(trustedRootEntries.some((entry) => entry.kind === "folder" && entry.path === "sections"));
  assert.ok(!trustedRootEntries.some((entry) => entry.path === "Introduction"));

  const overleafRoot = new FakeElement("ul", {
    attrs: { role: "tree", "data-testid": "file-tree-list-root", class: "file-tree-list" }
  });
  new FakeElement("li", {
    parent: overleafRoot,
    text: "expand_moresections",
    attrs: { role: "treeitem", "aria-label": "sections", "aria-expanded": "true" }
  });
  const nestedSectionsTree = new FakeElement("ul", {
    parent: overleafRoot,
    attrs: { role: "tree", class: "file-tree-folder-list" }
  });
  new FakeElement("li", {
    parent: nestedSectionsTree,
    text: "description01_introduction.tex",
    attrs: { role: "treeitem", "aria-label": "01_introduction.tex" }
  });
  const nestedEntries = hooks.collectFileTreeEntriesFromItems(
    overleafRoot.querySelectorAll('[role="treeitem"]'),
    { root: overleafRoot, trustFileTreeRoot: true }
  );
  assert.ok(nestedEntries.some((entry) => entry.kind === "file" && entry.path === "sections/01_introduction.tex"));

  assert.strictEqual(hooks.isFileLikeName("README"), true);
  assert.strictEqual(hooks.isFileLikeName("elsarticle.dtx"), true);
  assert.strictEqual(hooks.isFileLikeName("elsarticle.ins"), true);
  assert.strictEqual(hooks.fileNameMatches("01_introduction.tex", "sections/01_introduction.tex"), true);
  assert.strictEqual(hooks.fileNameMatches("sections/01_introduction.tex", "01_introduction.tex"), true);

  const fileTreeToolbar = new FakeElement("div", {
    attrs: { class: "file-tree-toolbar", "aria-label": "File tree toolbar" }
  });
  let createMenuItem = null;
  const fileMenuButton = new FakeElement("button", {
    parent: fileTreeToolbar,
    attrs: { "aria-label": "File menu", "data-testid": "file-menu" },
    onClick: () => {
      createMenuItem = new FakeElement("button", {
        text: "New file",
        attrs: { role: "menuitem", "aria-label": "New file" }
      });
    }
  });
  const existingFileRow = new FakeElement("li", {
    attrs: { role: "treeitem", "aria-label": "main.tex" }
  });
  let rowMenuClicked = false;
  const rowMenuButton = new FakeElement("button", {
    parent: existingFileRow,
    attrs: { "aria-label": "File menu" },
    onClick: () => { rowMenuClicked = true; }
  });
  const menuHooks = loadContentScriptTestHooks({
    querySelectorAll() {
      return [rowMenuButton, fileMenuButton, createMenuItem].filter(Boolean);
    }
  });
  let newFileClicked = false;
  fileMenuButton.onClick = () => {
    createMenuItem = new FakeElement("button", {
      text: "New file",
      attrs: { role: "menuitem", "aria-label": "New file" },
      onClick: () => { newFileClicked = true; }
    });
  };
  await menuHooks.clickOperationControl("create", "");
  assert.strictEqual(rowMenuClicked, false);
  assert.strictEqual(newFileClicked, true);

  const collapsedRoot = new FakeElement("ul", {
    attrs: { role: "tree", "data-testid": "file-tree-list-root", class: "file-tree-list" }
  });
  const collapsedFolder = new FakeElement("li", {
    parent: collapsedRoot,
    text: "chevron_rightsections",
    attrs: { role: "treeitem", "aria-label": "sections", "aria-expanded": "false" }
  });
  const folderToggle = new FakeElement("button", {
    parent: collapsedFolder,
    attrs: { "aria-label": "Expand folder" }
  });
  let selectedNestedFile = null;
  folderToggle.onClick = () => {
    collapsedFolder.setAttribute("aria-expanded", "true");
    const nestedTree = new FakeElement("ul", {
      parent: collapsedRoot,
      attrs: { role: "tree", class: "file-tree-folder-list" }
    });
    selectedNestedFile = new FakeElement("li", {
      parent: nestedTree,
      text: "description04_experiments.tex",
      attrs: { role: "treeitem", "aria-label": "04_experiments.tex" }
    });
    selectedNestedFile.onClick = () => selectedNestedFile.setAttribute("aria-selected", "true");
  };
  const nestedHooks = loadContentScriptTestHooks({
    querySelector(selector) {
      if (selector === '[role="treeitem"][aria-selected="true"]') return selectedNestedFile;
      return null;
    },
    querySelectorAll() {
      return [collapsedRoot];
    }
  });
  const openedNested = await nestedHooks.openFile("sections/04_experiments.tex");
  assert.strictEqual(collapsedFolder.getAttribute("aria-expanded"), "true");
  assert.strictEqual(openedNested.fileName, "04_experiments.tex");

  const fileTreeRoot = new FakeElement("div", {
    text: "File tree New file notes sections main.tex README elsarticle.dtx",
    attrs: { "aria-label": "File tree" }
  });
  new FakeElement("div", {
    parent: fileTreeRoot,
    text: "folder sections",
    attrs: { role: "treeitem", "aria-level": "1", "aria-expanded": "false" }
  });
  new FakeElement("div", {
    parent: fileTreeRoot,
    text: "description paper_body.tex",
    attrs: { role: "treeitem", "aria-level": "1" }
  });
  new FakeElement("div", {
    parent: fileTreeRoot,
    text: "description README",
    attrs: { role: "treeitem", "aria-level": "1" }
  });
  const outlineRoot = new FakeElement("div", {
    text: "Introduction Related work Method Conclusion"
  });
  new FakeElement("div", {
    parent: outlineRoot,
    text: "Introduction",
    attrs: { role: "treeitem", "aria-level": "1", "aria-expanded": "false" }
  });
  new FakeElement("div", {
    parent: outlineRoot,
    text: "Related work",
    attrs: { role: "treeitem", "aria-level": "1", "aria-expanded": "true" }
  });
  const rankedRoots = hooks.rankFileTreeRootCandidates([outlineRoot, fileTreeRoot]);
  assert.strictEqual(rankedRoots[0].element, fileTreeRoot);

  const splitPath = hooks.splitCreatePath("sections/01_introduction.tex");
  assert.strictEqual(splitPath.parentPath, "sections");
  assert.strictEqual(splitPath.baseName, "01_introduction.tex");

  const compileOptionsButton = new FakeElement("button", {
    text: "切换编译选项菜单",
    attrs: { "aria-label": "切换编译选项菜单" }
  });
  const localizedCompileButton = new FakeElement("button", {
    text: "重新编译",
    attrs: { title: "重新编译" }
  });
  const englishCompileButton = new FakeElement("button", {
    attrs: { "aria-label": "Recompile" }
  });
  assert.strictEqual(
    hooks.findCompileButton([compileOptionsButton, localizedCompileButton]),
    localizedCompileButton
  );
  assert.strictEqual(hooks.findCompileButton([englishCompileButton]), englishCompileButton);

  const compileStatus = new FakeElement("div", {
    text: "Errors 0 | Warnings 0 | Output written on output.pdf (11 pages, 100 bytes)",
    attrs: { role: "status" }
  });
  const compilingButton = new FakeElement("button", { text: "Compiling" });
  const compileHooks = loadContentScriptTestHooks({
    querySelectorAll(selector) {
      if (selector === '[role="status"], .log-entry, .pdf-viewer, button, a') return [compileStatus];
      return [compilingButton, compileStatus];
    }
  });
  const freshCompilePromise = compileHooks.waitForCompileCompletion(
    compileStatus.textContent,
    compilingButton,
    { timeoutMs: 200, pollMs: 5, settleMs: 10 }
  );
  setTimeout(() => {
    compilingButton.textContent = "Recompile";
    compileStatus.textContent = "Errors 0 | Warnings 10 | Output written on output.pdf (32 pages, 200 bytes)";
  }, 15);
  const freshCompile = await freshCompilePromise;
  assert.strictEqual(freshCompile.completed, true);
  assert.match(freshCompile.logSnippet, /Warnings 10/);
  assert.match(freshCompile.logSnippet, /32 pages/);

  const staleStatus = new FakeElement("div", {
    text: "Errors 0 | Warnings 0 | Output written on output.pdf (11 pages, 100 bytes)",
    attrs: { role: "status" }
  });
  const idleButton = new FakeElement("button", { text: "Recompile" });
  const staleHooks = loadContentScriptTestHooks({
    querySelectorAll(selector) {
      if (selector === '[role="status"], .log-entry, .pdf-viewer, button, a') return [staleStatus];
      return [idleButton, staleStatus];
    }
  });
  const staleCompile = await staleHooks.waitForCompileCompletion(
    staleStatus.textContent,
    idleButton,
    { timeoutMs: 30, pollMs: 5, settleMs: 10 }
  );
  assert.strictEqual(staleCompile.completed, false);
  assert.strictEqual(staleCompile.timedOut, true);
  assert.strictEqual(staleCompile.logSnippet, "");

  const stateOnlyStatus = new FakeElement("div", {
    text: "Errors 0 | Warnings 0 | Output written on output.pdf (11 pages, 100 bytes)",
    attrs: { role: "status" }
  });
  const stateOnlyButton = new FakeElement("button", {
    text: "Recompile",
    attrs: { "aria-label": "Recompile", "data-state": "idle" }
  });
  const stateOnlyHooks = loadContentScriptTestHooks({
    querySelectorAll(selector) {
      if (selector === '[role="status"], .log-entry, .pdf-viewer, button, a') return [stateOnlyStatus];
      return [stateOnlyButton, stateOnlyStatus];
    }
  });
  const previousActivitySignature = stateOnlyHooks.getCompileActivitySignature(stateOnlyButton);
  const stateOnlyPromise = stateOnlyHooks.waitForCompileCompletion(
    stateOnlyStatus.textContent,
    stateOnlyButton,
    { timeoutMs: 200, pollMs: 5, settleMs: 10, previousActivitySignature }
  );
  setTimeout(() => stateOnlyButton.setAttribute("data-state", "running"), 10);
  setTimeout(() => stateOnlyButton.setAttribute("data-state", "idle"), 30);
  const stateOnlyCompile = await stateOnlyPromise;
  assert.strictEqual(stateOnlyCompile.completed, true);
  assert.match(stateOnlyCompile.logSnippet, /Errors 0/);

  const pdfLink = new FakeElement("a", {
    attrs: { href: "/download/project/test/build/build-old/output/output.pdf" }
  });
  const pdfLabel = new FakeElement("a", {
    text: "下载 PDF",
    attrs: { href: "/download/project/test/build/build-old/output/output.pdf" }
  });
  const localizedRecompile = new FakeElement("button", { text: "重新编译" });
  const outputHooks = loadContentScriptTestHooks({
    querySelectorAll(selector) {
      if (selector === "a[href]") return [pdfLink];
      if (selector === '[role="status"], .log-entry, .pdf-viewer, button, a') return [pdfLabel];
      return [localizedRecompile, pdfLabel];
    }
  });
  const previousOutputSignature = outputHooks.getCompileOutputSignature();
  const outputRefreshPromise = outputHooks.waitForCompileCompletion(
    "下载 PDF",
    localizedRecompile,
    { timeoutMs: 200, pollMs: 5, settleMs: 10, previousOutputSignature }
  );
  setTimeout(() => pdfLink.setAttribute("href", "/download/project/test/build/build-new/output/output.pdf"), 10);
  const outputRefreshCompile = await outputRefreshPromise;
  assert.strictEqual(outputRefreshCompile.completed, true);
  assert.strictEqual(outputRefreshCompile.evidence, "pdf-output-refreshed");
  assert.strictEqual(outputRefreshCompile.logSnippet, "");
}

function loadContentScriptTestHooks(documentOverrides = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, "../extension/contentScript.js"), "utf8");
  const sandbox = {
    console,
    location: {
      href: "https://www.overleaf.com/project/test",
      hostname: "www.overleaf.com",
      pathname: "/project/test"
    },
    document: {
      title: "",
      documentElement: { dataset: {} },
      querySelector: () => null,
      querySelectorAll: () => [],
      ...documentOverrides
    },
    window: {
      __OVERLEAF_BRIDGE_ENABLE_TEST_HOOKS__: true,
      addEventListener: () => {},
      getComputedStyle: () => ({ visibility: "visible", display: "block" }),
      CSS: { escape: (value) => String(value) }
    },
    chrome: {
      storage: {
        sync: { get: () => {} },
        onChanged: { addListener: () => {} }
      },
      runtime: {
        onMessage: { addListener: () => {} }
      }
    },
    sessionStorage: {
      getItem: () => "test-client-id",
      setItem: () => {}
    },
    URL,
    InputEvent: class InputEvent {},
    Event,
    fetch: () => Promise.reject(new Error("fetch should not run in content script helper tests")),
    setTimeout,
    clearTimeout,
    Math,
    Date,
    Promise,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Object
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;
  sandbox.window.chrome = sandbox.chrome;
  sandbox.window.sessionStorage = sandbox.sessionStorage;
  sandbox.window.location = sandbox.location;
  sandbox.globalThis = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "extension/contentScript.js" });
  assert.ok(sandbox.window.__overleafBridgeTestHooks, "content script test hooks were not exposed");
  return sandbox.window.__overleafBridgeTestHooks;
}

class FakeElement {
  constructor(tagName, options = {}) {
    this.tagName = String(tagName || "div").toUpperCase();
    this.textContent = options.text || "";
    this.parentElement = options.parent || null;
    this.children = [];
    this.disabled = Boolean(options.disabled);
    this.visible = options.visible !== false;
    this.onClick = options.onClick || null;
    this.attrs = new Map(Object.entries(options.attrs || {}).map(([key, value]) => [key.toLowerCase(), String(value)]));
    this.className = this.attrs.get("class") || "";
    this.classList = {
      contains: (name) => String(this.className || "").split(/\s+/).includes(name)
    };
    if (this.parentElement) this.parentElement.children.push(this);
  }

  getAttribute(name) {
    return this.attrs.get(String(name || "").toLowerCase()) || "";
  }

  setAttribute(name, value) {
    this.attrs.set(String(name || "").toLowerCase(), String(value));
  }

  getBoundingClientRect() {
    return this.visible ? { width: 24, height: 24 } : { width: 0, height: 0 };
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matchesSelector(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  matchesSelector(selector) {
    const role = this.getAttribute("role");
    const ariaModal = this.getAttribute("aria-modal");
    const className = this.className || "";
    return String(selector || "").split(",").some((part) => {
      const value = part.trim();
      if (value === "[role='dialog']") return role === "dialog";
      if (value === "[aria-modal='true']") return ariaModal === "true";
      if (value === ".modal") return className.split(/\s+/).includes("modal");
      if (value === "[class*='dialog']") return /dialog/i.test(className);
      if (value === "[class*='popover']") return /popover/i.test(className);
      if (value === ".cm-editor") return className.split(/\s+/).includes("cm-editor");
      if (value === "[role='treeitem']") return role === "treeitem";
      if (value === "li") return String(this.tagName || "").toLowerCase() === "li";
      if (value === "[data-testid*='file']") return /file/i.test(this.getAttribute("data-testid"));
      if (value === "[class*='file-tree']") return /file-tree/i.test(className);
      if (value === "[aria-label*='file']") return /file/i.test(this.getAttribute("aria-label"));
      return false;
    });
  }

  querySelectorAll(selector = "") {
    const descendants = [];
    const visit = (node) => {
      for (const child of node.children) {
        descendants.push(child);
        visit(child);
      }
    };
    visit(this);
    if (!selector || selector === "*") return descendants;
    if (selector === "[role=\"treeitem\"]" || selector === "[role='treeitem']") {
      return descendants.filter((element) => element.getAttribute("role") === "treeitem");
    }
    if (/button|\[role=['"]button['"]\]|\[aria-label\]|\[title\]/.test(selector)) {
      return descendants.filter((element) => {
        const tagName = String(element.tagName || "").toLowerCase();
        return tagName === "button" || element.getAttribute("role") === "button" || element.getAttribute("aria-label") || element.getAttribute("title");
      });
    }
    return descendants;
  }

  scrollIntoView() {}
  click() {
    if (this.onClick) this.onClick();
  }
  focus() {}
  dispatchEvent() {}
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
