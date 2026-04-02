#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
let DatabaseSync = null;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  DatabaseSync = null;
}

function pathExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function safeRealPath(filePath) {
  try {
    if (typeof fs.realpathSync.native === "function") {
      return fs.realpathSync.native(filePath);
    }
    return fs.realpathSync(filePath);
  } catch {
    return null;
  }
}

function pathResolvesTo(filePath, targetPath) {
  const left = safeRealPath(filePath);
  const right = safeRealPath(targetPath);
  if (!left || !right) {
    return false;
  }
  return path.resolve(left) === path.resolve(right);
}

function filesShareIdentity(filePath, targetPath) {
  try {
    const left = fs.statSync(filePath);
    const right = fs.statSync(targetPath);
    return (
      Number.isFinite(left.dev) &&
      Number.isFinite(left.ino) &&
      Number.isFinite(right.dev) &&
      Number.isFinite(right.ino) &&
      left.dev === right.dev &&
      left.ino === right.ino
    );
  } catch {
    return false;
  }
}

function inspectThreadIndex(homePath) {
  const dbPath = path.join(homePath, "state_5.sqlite");
  if (!pathExists(dbPath) || !DatabaseSync) {
    return null;
  }

  function readSummary(openPath) {
    let db = null;
    try {
      db = new DatabaseSync(openPath, { readonly: true });
      const tableRow = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'threads'")
        .get();
      if (!tableRow) {
        return null;
      }

      const threadCount = db.prepare("SELECT COUNT(*) AS count FROM threads").get()?.count ?? 0;
      const cwdCounts = db
        .prepare(
          `
            SELECT cwd, COUNT(*) AS count
            FROM threads
            GROUP BY cwd
            ORDER BY count DESC, cwd ASC
            LIMIT 3
          `,
        )
        .all()
        .map((row) => ({
          cwd: row.cwd,
          count: row.count,
        }));

      return {
        dbPath,
        inspectedPath: openPath,
        threadCount,
        cwdCounts,
      };
    } finally {
      if (db) {
        db.close();
      }
    }
  }

  try {
    return readSummary(dbPath);
  } catch (error) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex3-thread-index-"));
    const copiedDbPath = path.join(tmpDir, "state_5.sqlite");
    try {
      fs.copyFileSync(dbPath, copiedDbPath);
      for (const suffix of ["-wal", "-shm"]) {
        const sidecar = `${dbPath}${suffix}`;
        if (pathExists(sidecar)) {
          fs.copyFileSync(sidecar, `${copiedDbPath}${suffix}`);
        }
      }
      return readSummary(copiedDbPath);
    } catch (copiedError) {
      return {
        dbPath,
        error: `${error.message}; copy retry failed: ${copiedError.message}`,
      };
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failures in diagnostics
      }
    }
  }
}

function usesBuiltInOpenAiProvider(provider) {
  return String(provider?.provider_name || "").trim().toLowerCase() === "openai";
}

function effectiveOpenAiBaseUrl(provider) {
  const trimmed = String(provider?.base_url || "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

const PROVIDER_MODE_COMPAT = "compat";
const PROVIDER_MODE_STABLE_HTTP = "stable_http";
const DEFAULT_STABLE_HTTP_PROVIDER_ID = "sub2api";

function normalizeProviderMode(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/-/g, "_");
  return normalized === PROVIDER_MODE_STABLE_HTTP
    ? PROVIDER_MODE_STABLE_HTTP
    : PROVIDER_MODE_COMPAT;
}

function normalizeProvider(provider = {}) {
  const mode = normalizeProviderMode(provider.mode || PROVIDER_MODE_COMPAT);
  return {
    ...provider,
    mode,
    provider_name: mode === PROVIDER_MODE_COMPAT ? "openai" : DEFAULT_STABLE_HTTP_PROVIDER_ID,
  };
}

function detectAuthKind(authData) {
  if (
    authData?.auth_mode === "apikey" ||
    (typeof authData?.OPENAI_API_KEY === "string" && authData.OPENAI_API_KEY.trim())
  ) {
    return "apikey";
  }
  throw new Error("Unsupported auth.json shape.");
}

function normalizeProfile(profile, profileId) {
  if (!profile || typeof profile !== "object") {
    return null;
  }
  return {
    ...profile,
    profile_id: profile.profile_id || profileId,
  };
}

function readPlainCodexModeState(managerHome) {
  const filePath = path.join(path.dirname(managerHome), ".codex-manager", "plain-codex-mode.json");
  if (!pathExists(filePath)) {
    return null;
  }
  try {
    const parsed = readJson(filePath);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

const jsonMode = process.argv.includes("--json");
const managerHome = process.env.CODEX3_MANAGER_HOME
  ? path.resolve(process.env.CODEX3_MANAGER_HOME)
  : path.join(os.homedir(), ".codex3-manager");
const officialCliHome = path.join(os.homedir(), ".codex-official");
const launcherDir =
  process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "npm")
    : path.join(os.homedir(), ".local", "bin");

const issues = [];
const warnings = [];
const sharedSessionRelativePaths = ["sessions", "archived_sessions"];
const sharedSessionIndexFile = "session_index.jsonl";
const plainCodexModeState = readPlainCodexModeState(managerHome);
const plainCodexMode = plainCodexModeState?.mode || "official";

for (const runtimeFile of [
  path.join(managerHome, "index.mjs"),
  path.join(managerHome, "package.json"),
  path.join(managerHome, "package-lock.json"),
  path.join(managerHome, "scripts", "install_codex3_wrapper.ps1"),
]) {
  if (!pathExists(runtimeFile)) {
    issues.push(`Missing runtime file: ${runtimeFile}`);
  }
}

for (const launcherFile of [
  path.join(launcherDir, "codex3_m.ps1"),
  path.join(launcherDir, "codex3_m.cmd"),
]) {
  if (!pathExists(launcherFile)) {
    issues.push(`Missing manager launcher: ${launcherFile}`);
  }
}

if (process.platform === "win32") {
  const codexPs1Path = path.join(launcherDir, "codex.ps1");
  const codexCmdPath = path.join(launcherDir, "codex.cmd");

  for (const launcherFile of [codexPs1Path, codexCmdPath]) {
    if (!pathExists(launcherFile)) {
      issues.push(`Missing managed plain codex launcher: ${launcherFile}`);
    }
  }

  if (pathExists(codexPs1Path)) {
    const codexPs1Text = readText(codexPs1Path);
    if (!codexPs1Text.includes("CODEX_HOME") || !codexPs1Text.includes(officialCliHome)) {
      issues.push(`codex.ps1 does not pin CODEX_HOME to ${officialCliHome}.`);
    }
  }

  if (pathExists(codexCmdPath)) {
    const codexCmdText = readText(codexCmdPath);
    if (!codexCmdText.includes("CODEX_HOME") || !codexCmdText.includes(officialCliHome)) {
      issues.push(`codex.cmd does not pin CODEX_HOME to ${officialCliHome}.`);
    }
  }
}

const statePath = path.join(managerHome, "state.json");
let state = null;
if (pathExists(statePath)) {
  try {
    state = readJson(statePath);
    if (!state.profiles || typeof state.profiles !== "object") {
      state.profiles = {};
    }
  } catch (error) {
    issues.push(`Invalid state JSON: ${statePath} (${error.message})`);
  }
} else {
  warnings.push(`State file not found: ${statePath}`);
}

let provider = {
  command_name: "codex3",
  third_party_home: path.join(os.homedir(), ".codex-apikey"),
  shared_codex_home: path.join(os.homedir(), ".codex"),
  mode: PROVIDER_MODE_COMPAT,
  provider_name: "openai",
  base_url: "https://sub.aimizy.com",
  model: "gpt-5.4",
  review_model: "gpt-5.4",
  model_reasoning_effort: "xhigh",
  model_context_window: 1000000,
  model_auto_compact_token_limit: 900000,
};

if (state?.provider && typeof state.provider === "object") {
  provider = normalizeProvider({
    ...provider,
    ...state.provider,
  });
}

for (const wrapperFile of [
  path.join(launcherDir, `${provider.command_name}.ps1`),
  path.join(launcherDir, `${provider.command_name}.cmd`),
]) {
  if (!pathExists(wrapperFile)) {
    issues.push(`Missing third-party wrapper launcher: ${wrapperFile}`);
  }
}

if (process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).trim()) {
  warnings.push(
    "OPENAI_API_KEY is set in the current process environment. The wrapper removes it for child runs, but new shells may still inherit it.",
  );
}

if (path.resolve(provider.third_party_home) === path.resolve(path.join(os.homedir(), ".codex"))) {
  issues.push("third_party_home resolves to ~/.codex, which would mix third-party auth storage with the shared Codex home.");
}

if (path.resolve(provider.third_party_home) === path.resolve(provider.shared_codex_home)) {
  issues.push("third_party_home matches shared_codex_home, so third-party auth would leak into the shared Codex state.");
}

if (!pathExists(provider.shared_codex_home)) {
  warnings.push(`Shared Codex home does not exist yet: ${provider.shared_codex_home}`);
}

for (const relativePath of sharedSessionRelativePaths) {
  const targetPath = path.join(provider.shared_codex_home, relativePath);
  const linkPath = path.join(provider.third_party_home, relativePath);
  if (!pathExists(targetPath)) {
    warnings.push(`Shared session target does not exist yet: ${targetPath}`);
    continue;
  }
  if (!pathExists(linkPath)) {
    issues.push(`Shared session path is missing from third-party home: ${linkPath}`);
    continue;
  }
  if (!pathResolvesTo(linkPath, targetPath)) {
    issues.push(
      `Shared session path does not resolve to the shared Codex home: ${linkPath} -> ${targetPath}`,
    );
  }
}

if (state && state.profiles && typeof state.profiles === "object") {
  for (const [profileId, rawProfile] of Object.entries(state.profiles)) {
    const profile = normalizeProfile(rawProfile, profileId);
    if (!profile) {
      issues.push(`Invalid profile entry: ${profileId}`);
      continue;
    }
    const authPath = path.join(managerHome, "profiles", profile.profile_id, "auth.json");
    if (!pathExists(authPath)) {
      issues.push(`Missing saved auth for profile ${profile.profile_id}: ${authPath}`);
      continue;
    }
    try {
      if (detectAuthKind(readJson(authPath)) !== "apikey") {
        issues.push(`Saved auth is not API key auth for profile ${profile.profile_id}`);
      }
    } catch (error) {
      issues.push(`Invalid saved auth for profile ${profile.profile_id}: ${error.message}`);
    }
  }
}

const thirdPartyAuthPath = path.join(provider.third_party_home, "auth.json");
const thirdPartyConfigPath = path.join(provider.third_party_home, "config.toml");

if (!pathExists(thirdPartyConfigPath)) {
  issues.push(`Missing third-party config: ${thirdPartyConfigPath}`);
} else {
  const configText = readText(thirdPartyConfigPath);
  const requiredSnippets = usesBuiltInOpenAiProvider(provider)
    ? [
        'cli_auth_credentials_store = "file"',
        'model_provider = "openai"',
        `openai_base_url = "${effectiveOpenAiBaseUrl(provider)}"`,
        `model = "${provider.model}"`,
        `review_model = "${provider.review_model}"`,
        `model_reasoning_effort = "${provider.model_reasoning_effort}"`,
        `model_context_window = ${provider.model_context_window}`,
        `model_auto_compact_token_limit = ${provider.model_auto_compact_token_limit}`,
      ]
      : [
        'cli_auth_credentials_store = "file"',
        `model_provider = "${provider.provider_name}"`,
        `model = "${provider.model}"`,
        `review_model = "${provider.review_model}"`,
        `model_reasoning_effort = "${provider.model_reasoning_effort}"`,
        `model_context_window = ${provider.model_context_window}`,
        `model_auto_compact_token_limit = ${provider.model_auto_compact_token_limit}`,
        `base_url = "${provider.base_url}"`,
        "requires_openai_auth = true",
        "supports_websockets = false",
      ];
  for (const snippet of requiredSnippets) {
    if (!configText.includes(snippet)) {
      issues.push(`Third-party config is missing expected setting: ${snippet}`);
    }
  }
}

if (state?.active_profile_id) {
  if (!state.profiles[state.active_profile_id]) {
    issues.push(`active_profile_id points to a missing profile: ${state.active_profile_id}`);
  }
  if (!pathExists(thirdPartyAuthPath)) {
    issues.push(`Active third-party auth is missing: ${thirdPartyAuthPath}`);
  } else {
    try {
      if (detectAuthKind(readJson(thirdPartyAuthPath)) !== "apikey") {
        issues.push(`Active third-party auth is not in API key mode: ${thirdPartyAuthPath}`);
      }
    } catch (error) {
      issues.push(`Invalid active third-party auth JSON: ${thirdPartyAuthPath} (${error.message})`);
    }
  }
}

const wrapperPs1Path = path.join(launcherDir, `${provider.command_name}.ps1`);
if (pathExists(wrapperPs1Path)) {
  const wrapperText = readText(wrapperPs1Path);
  if (!wrapperText.includes("previousCodexHome")) {
    warnings.push("Wrapper ps1 does not appear to restore CODEX_HOME.");
  }
  if (!wrapperText.includes("previousOpenAiApiKey")) {
    warnings.push("Wrapper ps1 does not appear to restore OPENAI_API_KEY.");
  }
  if (!wrapperText.includes("Remove-Item Env:OPENAI_API_KEY")) {
    warnings.push("Wrapper ps1 does not appear to remove inherited OPENAI_API_KEY during child runs.");
  }
}

const sessionIndexTargetPath = path.join(provider.shared_codex_home, sharedSessionIndexFile);
const sessionIndexLinkPath = path.join(provider.third_party_home, sharedSessionIndexFile);
if (!pathExists(sessionIndexTargetPath)) {
  warnings.push(`Shared session index target does not exist yet: ${sessionIndexTargetPath}`);
} else if (!pathExists(sessionIndexLinkPath)) {
  issues.push(`Shared session index is missing from third-party home: ${sessionIndexLinkPath}`);
} else if (!filesShareIdentity(sessionIndexLinkPath, sessionIndexTargetPath)) {
  issues.push(
    `Shared session index is not hard-linked to the shared Codex home: ${sessionIndexLinkPath} -> ${sessionIndexTargetPath}`,
  );
}

const thirdPartyThreadIndex = inspectThreadIndex(provider.third_party_home);
if (thirdPartyThreadIndex?.error) {
  warnings.push(
    `Could not inspect third-party thread index at ${thirdPartyThreadIndex.dbPath}: ${thirdPartyThreadIndex.error}`,
  );
} else if (thirdPartyThreadIndex?.threadCount > 0) {
  warnings.push(
    "Recent Codex builds keep sidebar/thread metadata in state_5.sqlite per CODEX_HOME. codex3 can therefore have a separate thread list even when sessions, archived_sessions, and session_index.jsonl are shared.",
  );
  if (thirdPartyThreadIndex.cwdCounts.length > 0) {
    const samples = thirdPartyThreadIndex.cwdCounts
      .map((entry) => `${entry.cwd} (${entry.count})`)
      .join(", ");
    warnings.push(
      `Current codex3 thread cwd samples from ${thirdPartyThreadIndex.dbPath}: ${samples}. Workspace-filtered sidebars only show threads whose cwd matches the active workspace.`,
    );
  }
}

if (process.platform === "win32") {
  const result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      '[PSCustomObject]@{ user = -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable("OPENAI_API_KEY","User")); machine = -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable("OPENAI_API_KEY","Machine")) } | ConvertTo-Json -Compress',
    ],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );

  if (result.status === 0 && result.stdout.trim()) {
    try {
      const parsed = JSON.parse(result.stdout.trim());
      if (parsed.user) {
        warnings.push("OPENAI_API_KEY is set at Windows User scope.");
      }
      if (parsed.machine) {
        warnings.push("OPENAI_API_KEY is set at Windows Machine scope.");
      }
    } catch {
      // ignore parse failures
    }
  }
}

if (plainCodexMode === "third_party") {
  warnings.push(
    `Desktop is currently following the third-party lane. The plain codex CLI should still stay on ${officialCliHome} via the managed codex launcher.`,
  );
}

const payload = {
  ok: issues.length === 0,
  issues,
  warnings,
  paths: {
    managerHome,
    launcherDir,
    officialCliHome,
    thirdPartyHome: provider.third_party_home,
    sharedCodexHome: provider.shared_codex_home,
  },
  plainCodexMode,
};

if (jsonMode) {
  console.log(JSON.stringify(payload, null, 2));
} else if (issues.length === 0) {
  console.log("No blocking issues found for the third-party lane.");
  warnings.forEach((warning) => console.log(`Warning: ${warning}`));
} else {
  console.log("Issues found:");
  issues.forEach((issue) => console.log(`- ${issue}`));
  warnings.forEach((warning) => console.log(`Warning: ${warning}`));
}

process.exit(issues.length === 0 ? 0 : 1);
