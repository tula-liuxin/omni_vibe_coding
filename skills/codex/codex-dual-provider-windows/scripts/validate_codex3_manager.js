#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  filesMatch,
  jsonFilesMatch,
  launcherDir,
  officialCliHome,
  officialHome,
  pathExists,
  readJson,
  readPlainCodexModeState,
  readText,
  userHome,
} = require("../../_internal-codex-windows-core/scripts/validator-common.cjs");

const DEFAULT_PROVIDER = {
  command_name: "codex3",
  third_party_home: path.join(userHome(), ".codex-apikey"),
  shared_codex_home: path.join(userHome(), ".codex"),
  provider_name: "api111",
  base_url: "https://api.xcode.best/v1",
  model: "gpt-5.4",
  model_reasoning_effort: "high",
  preferred_auth_method: "apikey",
  model_context_window: 1000000,
  model_auto_compact_token_limit: 900000,
};

function safeRealPath(filePath) {
  try {
    return typeof fs.realpathSync.native === "function"
      ? fs.realpathSync.native(filePath)
      : fs.realpathSync(filePath);
  } catch {
    return null;
  }
}

function pathResolvesTo(filePath, targetPath) {
  const left = safeRealPath(filePath);
  const right = safeRealPath(targetPath);
  return Boolean(left && right && path.resolve(left) === path.resolve(right));
}

function filesShareIdentity(leftPath, rightPath) {
  try {
    const left = fs.statSync(leftPath);
    const right = fs.statSync(rightPath);
    return left.dev === right.dev && left.ino === right.ino;
  } catch {
    return false;
  }
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

function normalizeOptionalString(value) {
  if (value == null) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed || null;
}

function normalizeOptionalPositiveInteger(value) {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.trunc(parsed);
}

function normalizeProvider(rawProvider = {}, tuning = {}) {
  const provider = { ...DEFAULT_PROVIDER, ...(rawProvider || {}) };
  const overrides = tuning && typeof tuning === "object" ? tuning : {};
  return {
    command_name:
      normalizeOptionalString(provider.command_name) || DEFAULT_PROVIDER.command_name,
    third_party_home: path.resolve(
      normalizeOptionalString(provider.third_party_home) || DEFAULT_PROVIDER.third_party_home,
    ),
    shared_codex_home: path.resolve(
      normalizeOptionalString(provider.shared_codex_home) || DEFAULT_PROVIDER.shared_codex_home,
    ),
    provider_name: "api111",
    base_url: normalizeOptionalString(provider.base_url) || DEFAULT_PROVIDER.base_url,
    model:
      normalizeOptionalString(overrides.model) ||
      normalizeOptionalString(provider.model) ||
      DEFAULT_PROVIDER.model,
    review_model:
      normalizeOptionalString(overrides.review_model) ||
      normalizeOptionalString(provider.review_model),
    model_reasoning_effort:
      normalizeOptionalString(overrides.model_reasoning_effort) ||
      normalizeOptionalString(provider.model_reasoning_effort) ||
      DEFAULT_PROVIDER.model_reasoning_effort,
    preferred_auth_method: "apikey",
    model_context_window:
      normalizeOptionalPositiveInteger(overrides.model_context_window) ||
      normalizeOptionalPositiveInteger(provider.model_context_window) ||
      DEFAULT_PROVIDER.model_context_window,
    model_auto_compact_token_limit:
      normalizeOptionalPositiveInteger(overrides.model_auto_compact_token_limit) ||
      normalizeOptionalPositiveInteger(provider.model_auto_compact_token_limit) ||
      DEFAULT_PROVIDER.model_auto_compact_token_limit,
  };
}

function getWindowsOpenAiApiKeyWarnings() {
  const warnings = [];
  if (process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).trim()) {
    warnings.push(
      "OPENAI_API_KEY is set in the current process environment. The codex3 wrapper strips it for child runs, but new shells can still inherit it.",
    );
  }

  if (process.platform !== "win32") {
    return warnings;
  }

  const result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      '[PSCustomObject]@{ user = -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable("OPENAI_API_KEY","User")); machine = -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable("OPENAI_API_KEY","Machine")) } | ConvertTo-Json -Compress',
    ],
    { encoding: "utf8", windowsHide: true },
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
      // ignore parse failures in diagnostics
    }
  }

  return warnings;
}

function validateThirdPartyConfig(configText, provider, issues) {
  const requiredSnippets = [
    'model_provider = "api111"',
    `model = "${provider.model}"`,
    `model_reasoning_effort = "${provider.model_reasoning_effort}"`,
    'cli_auth_credentials_store = "file"',
    'disable_response_storage = true',
    'preferred_auth_method = "apikey"',
    `model_context_window = ${provider.model_context_window}`,
    `model_auto_compact_token_limit = ${provider.model_auto_compact_token_limit}`,
    "[model_providers.api111]",
    'name = "api111"',
    `base_url = "${provider.base_url}"`,
    'wire_api = "responses"',
  ];

  for (const snippet of requiredSnippets) {
    if (!configText.includes(snippet)) {
      issues.push(`Third-party config is missing expected setting: ${snippet}`);
    }
  }

  if (provider.review_model && !configText.includes(`review_model = "${provider.review_model}"`)) {
    issues.push(`Third-party config is missing expected setting: review_model = "${provider.review_model}"`);
  }
}

const jsonMode = process.argv.includes("--json");
const managerHome = process.env.CODEX3_MANAGER_HOME
  ? path.resolve(process.env.CODEX3_MANAGER_HOME)
  : path.join(userHome(), ".codex3-manager");
const launchers = launcherDir();
const desktopHome = officialHome();
const officialCli = officialCliHome();
const officialManagerHome = path.join(userHome(), ".codex-manager");
const plainCodexModeState = readPlainCodexModeState(officialManagerHome);
const plainCodexMode = plainCodexModeState?.mode || "official";

const issues = [];
const warnings = getWindowsOpenAiApiKeyWarnings();

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
  path.join(launchers, "codex3_m.ps1"),
  path.join(launchers, "codex3_m.cmd"),
  path.join(launchers, "codex.ps1"),
  path.join(launchers, "codex.cmd"),
]) {
  if (!pathExists(launcherFile)) {
    issues.push(`Missing launcher: ${launcherFile}`);
  }
}

const codexPs1Path = path.join(launchers, "codex.ps1");
const codexCmdPath = path.join(launchers, "codex.cmd");
if (pathExists(codexPs1Path)) {
  const text = readText(codexPs1Path);
  if (!text.includes("CODEX_HOME") || !text.includes(officialCli)) {
    issues.push(`codex.ps1 does not pin CODEX_HOME to ${officialCli}.`);
  }
  if (
    !text.includes('model_provider="openai"') ||
    !text.includes('cli_auth_credentials_store="file"')
  ) {
    issues.push("codex.ps1 does not inject the managed official provider/auth overrides.");
  }
}
if (pathExists(codexCmdPath)) {
  const text = readText(codexCmdPath);
  if (!text.includes("codex.ps1") || !text.includes("ExecutionPolicy Bypass")) {
    issues.push("codex.cmd does not delegate to the managed codex.ps1 wrapper.");
  }
}

const statePath = path.join(managerHome, "state.json");
let state = null;
if (pathExists(statePath)) {
  try {
    state = readJson(statePath);
  } catch (error) {
    issues.push(`Invalid state JSON: ${statePath} (${error.message})`);
  }
} else {
  warnings.push(`State file not found: ${statePath}`);
}

if (state && (!state.profiles || typeof state.profiles !== "object")) {
  issues.push(`State file has an unexpected profiles shape: ${statePath}`);
}

const provider = normalizeProvider(state?.provider || {}, state?.tuning || {});

for (const wrapperFile of [
  path.join(launchers, `${provider.command_name}.ps1`),
  path.join(launchers, `${provider.command_name}.cmd`),
]) {
  if (!pathExists(wrapperFile)) {
    issues.push(`Missing third-party wrapper launcher: ${wrapperFile}`);
  }
}

if (path.resolve(provider.third_party_home) === path.resolve(desktopHome)) {
  issues.push("third_party_home resolves to ~/.codex, which would mix auth storage with Desktop state.");
}
if (path.resolve(provider.third_party_home) === path.resolve(provider.shared_codex_home)) {
  issues.push("third_party_home matches shared_codex_home, so third-party auth would leak into shared state.");
}

for (const relativePath of ["sessions", "archived_sessions"]) {
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
    issues.push(`Shared session path does not resolve to the shared Codex home: ${linkPath} -> ${targetPath}`);
  }
}

const sessionIndexTargetPath = path.join(provider.shared_codex_home, "session_index.jsonl");
const sessionIndexLinkPath = path.join(provider.third_party_home, "session_index.jsonl");
if (!pathExists(sessionIndexTargetPath)) {
  warnings.push(`Shared session index target does not exist yet: ${sessionIndexTargetPath}`);
} else if (!pathExists(sessionIndexLinkPath)) {
  issues.push(`Shared session index is missing from third-party home: ${sessionIndexLinkPath}`);
} else if (!filesShareIdentity(sessionIndexLinkPath, sessionIndexTargetPath)) {
  issues.push(
    `Shared session index is not hard-linked to the shared Codex home: ${sessionIndexLinkPath} -> ${sessionIndexTargetPath}`,
  );
}

if (state?.profiles && typeof state.profiles === "object") {
  for (const [profileId, rawProfile] of Object.entries(state.profiles)) {
    const savedId = rawProfile?.profile_id || profileId;
    const authPath = path.join(managerHome, "profiles", savedId, "auth.json");
    if (!pathExists(authPath)) {
      issues.push(`Missing saved auth for profile ${savedId}: ${authPath}`);
      continue;
    }
    try {
      if (detectAuthKind(readJson(authPath)) !== "apikey") {
        issues.push(`Saved auth is not API key auth for profile ${savedId}.`);
      }
    } catch (error) {
      issues.push(`Invalid saved auth for profile ${savedId}: ${error.message}`);
    }
  }
}

const thirdPartyAuthPath = path.join(provider.third_party_home, "auth.json");
const thirdPartyConfigPath = path.join(provider.third_party_home, "config.toml");

if (!pathExists(thirdPartyConfigPath)) {
  issues.push(`Missing third-party config: ${thirdPartyConfigPath}`);
} else {
  validateThirdPartyConfig(readText(thirdPartyConfigPath), provider, issues);
}

if (state?.active_profile_id) {
  if (!state.profiles?.[state.active_profile_id]) {
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

if (plainCodexMode === "third_party") {
  const desktopAuthPath = path.join(desktopHome, "auth.json");
  const desktopConfigPath = path.join(desktopHome, "config.toml");

  if (!pathExists(desktopAuthPath)) {
    issues.push(`Desktop auth is missing while codex.exe should follow the third-party lane: ${desktopAuthPath}`);
  } else if (!jsonFilesMatch(desktopAuthPath, thirdPartyAuthPath)) {
    issues.push("Desktop auth.json does not match the active third-party auth.json.");
  }

  if (!pathExists(desktopConfigPath)) {
    issues.push(`Desktop config is missing while codex.exe should follow the third-party lane: ${desktopConfigPath}`);
  } else if (!filesMatch(desktopConfigPath, thirdPartyConfigPath)) {
    issues.push("Desktop config.toml does not match the active third-party config.toml.");
  }
} else {
  warnings.push(
    `Desktop is currently following the official lane. Third-party mirror checks are skipped until you switch with codex3_m use-codex3.`,
  );
}

const payload = {
  ok: issues.length === 0,
  issues,
  warnings,
  provider,
  paths: {
    managerHome,
    launcherDir: launchers,
    officialCliHome: officialCli,
    desktopHome,
    thirdPartyHome: provider.third_party_home,
    sharedCodexHome: provider.shared_codex_home,
  },
  plainCodexMode,
};

if (jsonMode) {
  console.log(JSON.stringify(payload, null, 2));
} else if (!issues.length) {
  console.log("No blocking issues found for the third-party lane.");
  warnings.forEach((warning) => console.log(`Warning: ${warning}`));
} else {
  console.log("Issues found:");
  issues.forEach((issue) => console.log(`- ${issue}`));
  warnings.forEach((warning) => console.log(`Warning: ${warning}`));
}

process.exit(issues.length === 0 ? 0 : 1);
