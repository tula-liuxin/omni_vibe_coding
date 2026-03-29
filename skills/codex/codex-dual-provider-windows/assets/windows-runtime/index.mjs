#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import readlinePromises from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import enquirer from "enquirer";

const { Select, Input, Confirm, Password } = enquirer;

function isIgnorablePromptCloseError(error) {
  return error && typeof error === "object" && error.code === "ERR_USE_AFTER_CLOSE";
}

function installPromptCloseGuards() {
  process.on("uncaughtException", (error) => {
    if (isIgnorablePromptCloseError(error)) {
      process.exitCode = 0;
      return;
    }
    console.error(`Error: ${error.message || error}`);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    if (isIgnorablePromptCloseError(reason)) {
      process.exitCode = 0;
      return;
    }
    console.error(`Error: ${reason?.message || reason}`);
    process.exit(1);
  });
}

installPromptCloseGuards();

const VERSION = 1;
const MANAGER_HOME = path.join(os.homedir(), ".codex3-manager");
const STATE_PATH = path.join(MANAGER_HOME, "state.json");
const PROFILES_DIR = path.join(MANAGER_HOME, "profiles");
const BACKUPS_DIR = path.join(MANAGER_HOME, "backups");
const SCRIPTS_DIR = path.join(MANAGER_HOME, "scripts");
const OFFICIAL_MANAGER_HOME = path.join(os.homedir(), ".codex-manager");
const PLAIN_CODEX_BRIDGE_DIR = path.join(OFFICIAL_MANAGER_HOME, "plain-codex-bridge");
const PLAIN_CODEX_MODE_STATE_PATH = path.join(OFFICIAL_MANAGER_HOME, "plain-codex-mode.json");
const PLAIN_CODEX_BACKUP_AUTH_PATH = path.join(PLAIN_CODEX_BRIDGE_DIR, "official-auth.json");
const PLAIN_CODEX_BACKUP_CONFIG_PATH = path.join(
  PLAIN_CODEX_BRIDGE_DIR,
  "official-config.toml",
);
const LAUNCHER_DIR =
  process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "npm")
    : path.join(os.homedir(), ".local", "bin");

const DEFAULT_THIRD_PARTY_HOME = path.join(os.homedir(), ".codex-apikey");
const DEFAULT_SHARED_CODEX_HOME = path.join(os.homedir(), ".codex");
const SHARED_SESSION_RELATIVE_PATHS = ["sessions", "archived_sessions"];
const PROVIDER_MODE_COMPAT = "compat";
const PROVIDER_MODE_STABLE_HTTP = "stable_http";
const DEFAULT_STABLE_HTTP_PROVIDER_ID = "sub2api";
const OFFICIAL_HOME = path.join(os.homedir(), ".codex");
const OFFICIAL_AUTH_PATH = path.join(OFFICIAL_HOME, "auth.json");
const OFFICIAL_CONFIG_PATH = path.join(OFFICIAL_HOME, "config.toml");
const DEFAULT_PROVIDER = {
  command_name: "codex3",
  third_party_home: DEFAULT_THIRD_PARTY_HOME,
  shared_codex_home: DEFAULT_SHARED_CODEX_HOME,
  mode: PROVIDER_MODE_COMPAT,
  provider_name: "openai",
  base_url: "https://sub.aimizy.com",
  model: "gpt-5.4",
  review_model: "gpt-5.4",
  model_reasoning_effort: "xhigh",
  model_context_window: 1000000,
  model_auto_compact_token_limit: 900000,
};

const RUNTIME_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_WRAPPER_INSTALLER = path.resolve(
  RUNTIME_DIR,
  "..",
  "..",
  "scripts",
  "install_codex3_wrapper.ps1",
);

function normalizeEnvToken(value, fallback = "CODEX3") {
  const normalized = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return normalized || fallback;
}

function getProviderEnvKey(commandName) {
  return `${normalizeEnvToken(commandName)}_OPENAI_API_KEY`;
}

const PLAIN_CODEX_MODE_OFFICIAL = "official";
const PLAIN_CODEX_MODE_THIRD_PARTY = "third_party";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function pathExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function readPlainCodexModeState() {
  if (!pathExists(PLAIN_CODEX_MODE_STATE_PATH)) {
    return null;
  }
  try {
    const parsed = readJson(PLAIN_CODEX_MODE_STATE_PATH);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function getPlainCodexMode() {
  const state = readPlainCodexModeState();
  return state?.mode === PLAIN_CODEX_MODE_THIRD_PARTY
    ? PLAIN_CODEX_MODE_THIRD_PARTY
    : PLAIN_CODEX_MODE_OFFICIAL;
}

function setPlainCodexModeState(mode, extra = {}) {
  ensureDir(PLAIN_CODEX_BRIDGE_DIR);
  writeJson(PLAIN_CODEX_MODE_STATE_PATH, {
    mode,
    updated_at: new Date().toISOString(),
    ...extra,
  });
}

function capturePlainCodexOfficialBackupsIfNeeded() {
  if (getPlainCodexMode() === PLAIN_CODEX_MODE_THIRD_PARTY) {
    return;
  }
  ensureDir(PLAIN_CODEX_BRIDGE_DIR);
  if (pathExists(OFFICIAL_AUTH_PATH)) {
    fs.copyFileSync(OFFICIAL_AUTH_PATH, PLAIN_CODEX_BACKUP_AUTH_PATH);
  }
  if (pathExists(OFFICIAL_CONFIG_PATH)) {
    fs.copyFileSync(OFFICIAL_CONFIG_PATH, PLAIN_CODEX_BACKUP_CONFIG_PATH);
  }
}

function findFirstTomlTableHeaderIndex(lines) {
  const index = lines.findIndex((line) => /^\s*\[.*\]\s*$/.test(line));
  return index === -1 ? lines.length : index;
}

function stripTopLevelTomlEntries(text, keys) {
  const keySet = new Set(keys);
  const output = [];
  let currentTable = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (/^\s*\[.*\]\s*$/.test(rawLine)) {
      currentTable = trimmed;
      output.push(rawLine);
      continue;
    }
    if (currentTable === null) {
      const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=/);
      if (match && keySet.has(match[1])) {
        continue;
      }
    }
    output.push(rawLine);
  }

  return output.join("\n");
}

function writeManagedTopLevelTomlKeys(text, entries, commentLabel) {
  const keys = Object.keys(entries);
  const cleanedText = stripTopLevelTomlEntries(text, keys);
  const lines = cleanedText ? cleanedText.split(/\r?\n/) : [];
  const firstTableIndex = findFirstTomlTableHeaderIndex(lines);
  const before = lines.slice(0, firstTableIndex);
  const after = lines.slice(firstTableIndex);

  while (before.length && !before[before.length - 1].trim()) {
    before.pop();
  }
  while (after.length && !after[0].trim()) {
    after.shift();
  }

  const managedBlock = [
    commentLabel,
    ...Object.entries(entries).map(([key, serializedValue]) => `${key} = ${serializedValue}`),
  ];

  const outputLines = [];
  if (before.length) {
    outputLines.push(...before, "");
  }
  outputLines.push(...managedBlock);
  if (after.length) {
    outputLines.push("", ...after);
  }

  return outputLines.join("\n").replace(/\n?$/, "\n");
}

function replaceTomlTable(text, tableName, entries, commentLabel) {
  const tableHeader = `[${tableName}]`;
  const lines = text ? text.split(/\r?\n/) : [];
  let start = -1;
  let end = lines.length;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (start === -1) {
      if (trimmed === tableHeader) {
        start = index;
      }
      continue;
    }
    if (/^\[.*\]$/.test(trimmed)) {
      end = index;
      break;
    }
  }

  if (start !== -1) {
    if (start > 0 && lines[start - 1].trim() === commentLabel) {
      start -= 1;
    }
    lines.splice(start, end - start);
  }

  while (lines.length && !lines[lines.length - 1].trim()) {
    lines.pop();
  }
  if (lines.length) {
    lines.push("");
  }

  lines.push(commentLabel, tableHeader);
  for (const [key, serializedValue] of Object.entries(entries)) {
    lines.push(`${key} = ${serializedValue}`);
  }
  lines.push("");

  return lines.join("\n").replace(/\n?$/, "\n");
}

function removeTomlTable(text, tableName, commentLabel) {
  const tableHeader = `[${tableName}]`;
  const lines = text ? text.split(/\r?\n/) : [];
  let start = -1;
  let end = lines.length;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (start === -1) {
      if (trimmed === tableHeader) {
        start = index;
      }
      continue;
    }
    if (/^\[.*\]$/.test(trimmed)) {
      end = index;
      break;
    }
  }

  if (start !== -1) {
    if (start > 0 && lines[start - 1].trim() === commentLabel) {
      start -= 1;
    }
    lines.splice(start, end - start);
  }

  while (lines.length && !lines[lines.length - 1].trim()) {
    lines.pop();
  }

  return lines.join("\n").replace(/\n?$/, "\n");
}

function dedupeManagedCommentLines(text, commentLabel) {
  const lines = text.split(/\r?\n/);
  const output = [];
  for (const line of lines) {
    if (
      line.trim() === commentLabel &&
      output.length > 0 &&
      output[output.length - 1].trim() === commentLabel
    ) {
      continue;
    }
    output.push(line);
  }
  return output.join("\n").replace(/\n?$/, "\n");
}

function isoNow() {
  return new Date().toISOString();
}

function backupFileIfExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  ensureDir(BACKUPS_DIR);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUPS_DIR, `${timestamp}-${label}`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function normalizeProviderMode(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/-/g, "_");
  return normalized === PROVIDER_MODE_STABLE_HTTP
    ? PROVIDER_MODE_STABLE_HTTP
    : PROVIDER_MODE_COMPAT;
}

function providerModeCliLabel(mode) {
  return normalizeProviderMode(mode) === PROVIDER_MODE_STABLE_HTTP ? "stable-http" : "compat";
}

function usesBuiltInOpenAiProvider(provider) {
  return normalizeProviderMode(provider?.mode) === PROVIDER_MODE_COMPAT;
}

function effectiveOpenAiBaseUrl(provider) {
  const trimmed = String(provider?.base_url || "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

function normalizeProvider(provider = {}) {
  const mode = normalizeProviderMode(provider.mode || DEFAULT_PROVIDER.mode);
  const commandName =
    String(provider.command_name || DEFAULT_PROVIDER.command_name).trim() ||
    DEFAULT_PROVIDER.command_name;
  const thirdPartyHome = path.resolve(
    String(provider.third_party_home || DEFAULT_PROVIDER.third_party_home),
  );
  const sharedCodexHome = path.resolve(
    String(provider.shared_codex_home || DEFAULT_PROVIDER.shared_codex_home),
  );
  return {
    command_name: commandName,
    third_party_home: thirdPartyHome,
    shared_codex_home: sharedCodexHome,
    mode,
    provider_name:
      mode === PROVIDER_MODE_COMPAT ? "openai" : DEFAULT_STABLE_HTTP_PROVIDER_ID,
    base_url:
      String(provider.base_url || DEFAULT_PROVIDER.base_url).trim().replace(/\/+$/, "") ||
      DEFAULT_PROVIDER.base_url,
    model:
      String(provider.model || DEFAULT_PROVIDER.model).trim() || DEFAULT_PROVIDER.model,
    review_model:
      String(provider.review_model || provider.model || DEFAULT_PROVIDER.review_model).trim() ||
      DEFAULT_PROVIDER.review_model,
    model_reasoning_effort:
      String(
        provider.model_reasoning_effort || DEFAULT_PROVIDER.model_reasoning_effort,
      ).trim() || DEFAULT_PROVIDER.model_reasoning_effort,
    model_context_window:
      Number.isFinite(Number(provider.model_context_window))
        ? Number(provider.model_context_window)
        : DEFAULT_PROVIDER.model_context_window,
    model_auto_compact_token_limit:
      Number.isFinite(Number(provider.model_auto_compact_token_limit))
        ? Number(provider.model_auto_compact_token_limit)
        : DEFAULT_PROVIDER.model_auto_compact_token_limit,
  };
}

function profileDir(profileId) {
  return path.join(PROFILES_DIR, profileId);
}

function profileAuthPath(profileId) {
  return path.join(profileDir(profileId), "auth.json");
}

function thirdPartyAuthPath(provider) {
  return path.join(provider.third_party_home, "auth.json");
}

function thirdPartyConfigPath(provider) {
  return path.join(provider.third_party_home, "config.toml");
}

function sharedSessionLinkPath(provider, relativePath) {
  return path.join(provider.third_party_home, relativePath);
}

function sharedSessionTargetPath(provider, relativePath) {
  return path.join(provider.shared_codex_home, relativePath);
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

function loadState() {
  ensureDir(MANAGER_HOME);
  ensureDir(PROFILES_DIR);
  ensureDir(BACKUPS_DIR);
  ensureDir(SCRIPTS_DIR);

  if (!fs.existsSync(STATE_PATH)) {
    const state = {
      schema_version: VERSION,
      provider: normalizeProvider(DEFAULT_PROVIDER),
      profiles: {},
      active_profile_id: null,
    };
    writeJson(STATE_PATH, state);
    return state;
  }

  const state = readJson(STATE_PATH);
  if (typeof state !== "object" || state === null) {
    throw new Error(`Invalid state file: ${STATE_PATH}`);
  }

  let changed = false;
  if (!state.profiles || typeof state.profiles !== "object") {
    state.profiles = {};
    changed = true;
  }
  state.provider = normalizeProvider(state.provider || DEFAULT_PROVIDER);
  if (!("active_profile_id" in state)) {
    state.active_profile_id = null;
    changed = true;
  }
  if (state.schema_version !== VERSION) {
    state.schema_version = VERSION;
    changed = true;
  }

  for (const [profileId, rawProfile] of Object.entries(state.profiles)) {
    const normalized = normalizeProfile(rawProfile, profileId);
    if (!normalized) {
      delete state.profiles[profileId];
      changed = true;
      continue;
    }
    state.profiles[profileId] = normalized;
  }

  if (state.active_profile_id && !state.profiles[state.active_profile_id]) {
    state.active_profile_id = null;
    changed = true;
  }

  if (changed) {
    backupFileIfExists(STATE_PATH, "state.json.bak");
    saveState(state);
  }
  return state;
}

function saveState(state) {
  writeJson(STATE_PATH, state);
}

function maskApiKey(apiKey) {
  const value = String(apiKey || "").trim();
  if (!value) {
    return "(missing)";
  }
  if (value.length >= 12) {
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  }
  return "(hidden)";
}

function createProfileId(apiKey) {
  return createHash("sha256").update(String(apiKey || "").trim()).digest("hex").slice(0, 32);
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

function extractApiKeyMeta(authData) {
  if (detectAuthKind(authData) !== "apikey") {
    throw new Error("Expected auth_mode=apikey auth data.");
  }
  const apiKey = String(authData.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing.");
  }
  return {
    masked_key: maskApiKey(apiKey),
    key_hash: createProfileId(apiKey),
  };
}

function buildAuthData(apiKey) {
  const trimmed = String(apiKey || "").trim();
  if (!trimmed) {
    throw new Error("API key is required.");
  }
  return {
    auth_mode: "apikey",
    OPENAI_API_KEY: trimmed,
  };
}

function normalizeProfile(profile, profileId = null) {
  if (!profile || typeof profile !== "object") {
    return null;
  }
  const id = profile.profile_id || profileId;
  if (!id) {
    return null;
  }
  return {
    ...profile,
    profile_id: id,
    alias: String(profile.alias || "third-party-api-key"),
    created_at: profile.created_at || isoNow(),
    last_used_at: profile.last_used_at || null,
    key_hash: String(profile.key_hash || id),
  };
}

function getProfiles(state) {
  return Object.entries(state.profiles || {})
    .map(([profileId, profile]) => normalizeProfile(profile, profileId))
    .filter(Boolean)
    .sort((left, right) => {
      const leftTs = Date.parse(left.last_used_at || left.created_at || 0) || 0;
      const rightTs = Date.parse(right.last_used_at || right.created_at || 0) || 0;
      return rightTs - leftTs;
    });
}

function requireProfile(state, profileId) {
  const profile = normalizeProfile(state.profiles?.[profileId], profileId);
  if (!profile) {
    throw new Error(`Unknown third-party profile: ${profileId}`);
  }
  return profile;
}

function readSavedProfileMaskedKey(profileId) {
  const authPath = profileAuthPath(profileId);
  if (!fs.existsSync(authPath)) {
    return "(missing)";
  }
  try {
    return extractApiKeyMeta(readJson(authPath)).masked_key;
  } catch {
    return "(invalid auth)";
  }
}

function saveProfileAuth(profileId, authData) {
  ensureDir(profileDir(profileId));
  writeJson(profileAuthPath(profileId), authData);
}

function writeThirdPartyConfig(provider) {
  const text = usesBuiltInOpenAiProvider(provider)
    ? [
        'cli_auth_credentials_store = "file"',
        'model_provider = "openai"',
        `openai_base_url = "${effectiveOpenAiBaseUrl(provider)}"`,
        `model = "${provider.model}"`,
        `review_model = "${provider.review_model}"`,
        `model_reasoning_effort = "${provider.model_reasoning_effort}"`,
        'disable_response_storage = true',
        'network_access = "enabled"',
        'windows_wsl_setup_acknowledged = true',
        `model_context_window = ${provider.model_context_window}`,
        `model_auto_compact_token_limit = ${provider.model_auto_compact_token_limit}`,
        "",
        "[features]",
        "apps = false",
        "",
      ].join("\n")
    : [
        'cli_auth_credentials_store = "file"',
        `model_provider = "${provider.provider_name}"`,
        `model = "${provider.model}"`,
        `review_model = "${provider.review_model}"`,
        `model_reasoning_effort = "${provider.model_reasoning_effort}"`,
        'disable_response_storage = true',
        'network_access = "enabled"',
        'windows_wsl_setup_acknowledged = true',
        `model_context_window = ${provider.model_context_window}`,
        `model_auto_compact_token_limit = ${provider.model_auto_compact_token_limit}`,
        "",
        `[model_providers.${provider.provider_name}]`,
        `name = "${provider.provider_name}"`,
        `base_url = "${provider.base_url}"`,
        'wire_api = "responses"',
        'requires_openai_auth = true',
        'supports_websockets = false',
        "",
        "[features]",
        "apps = false",
        "",
      ].join("\n");

  ensureDir(provider.third_party_home);
  backupFileIfExists(thirdPartyConfigPath(provider), "codex3-config.toml.bak");
  writeText(thirdPartyConfigPath(provider), text);
}

function buildPlainCodexThirdPartyTopLevelEntries(provider) {
  const entries = {
    cli_auth_credentials_store: '"file"',
    model_provider: JSON.stringify(provider.provider_name),
    model: JSON.stringify(provider.model),
    review_model: JSON.stringify(provider.review_model),
    model_reasoning_effort: JSON.stringify(provider.model_reasoning_effort),
    disable_response_storage: "true",
    network_access: '"enabled"',
    windows_wsl_setup_acknowledged: "true",
    model_context_window: String(provider.model_context_window),
    model_auto_compact_token_limit: String(provider.model_auto_compact_token_limit),
  };
  if (usesBuiltInOpenAiProvider(provider)) {
    entries.openai_base_url = JSON.stringify(effectiveOpenAiBaseUrl(provider));
  }
  return entries;
}

function buildPlainCodexThirdPartyProviderTableEntries(provider) {
  if (usesBuiltInOpenAiProvider(provider)) {
    return null;
  }
  return {
    name: JSON.stringify(provider.provider_name),
    base_url: JSON.stringify(provider.base_url),
    wire_api: JSON.stringify("responses"),
    requires_openai_auth: "true",
    supports_websockets: "false",
  };
}

function applyPlainCodexThirdPartyBridge(provider) {
  ensureDir(OFFICIAL_HOME);
  const commentLabel = "# codex3_m managed plain codex";
  let configText = pathExists(OFFICIAL_CONFIG_PATH) ? readText(OFFICIAL_CONFIG_PATH) : "";
  configText = writeManagedTopLevelTomlKeys(
    configText,
    buildPlainCodexThirdPartyTopLevelEntries(provider),
    commentLabel,
  );
  const providerTableEntries = buildPlainCodexThirdPartyProviderTableEntries(provider);
  for (const tableName of [
    "model_providers.OpenAI",
    `model_providers.${DEFAULT_STABLE_HTTP_PROVIDER_ID}`,
  ]) {
    if (!providerTableEntries || tableName !== `model_providers.${provider.provider_name}`) {
      configText = removeTomlTable(configText, tableName, commentLabel);
    }
  }
  if (providerTableEntries) {
    configText = replaceTomlTable(
      configText,
      `model_providers.${provider.provider_name}`,
      providerTableEntries,
      commentLabel,
    );
  }
  configText = dedupeManagedCommentLines(configText, commentLabel);
  writeText(OFFICIAL_CONFIG_PATH, configText);
}

function copyThirdPartyAuthToOfficial(provider) {
  const source = thirdPartyAuthPath(provider);
  if (!pathExists(source)) {
    throw new Error(`Third-party auth is missing at ${source}`);
  }
  ensureDir(OFFICIAL_HOME);
  fs.copyFileSync(source, OFFICIAL_AUTH_PATH);
}

function resolveWrapperInstallerPath() {
  const candidates = [
    path.join(SCRIPTS_DIR, "install_codex3_wrapper.ps1"),
    REPO_WRAPPER_INSTALLER,
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "Wrapper installer is missing. Expected install_codex3_wrapper.ps1 in ~/.codex3-manager/scripts or the skill repo.",
  );
}

function runWrapperInstaller(provider) {
  const installer = resolveWrapperInstallerPath();
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    installer,
    "-CommandName",
    provider.command_name,
    "-ThirdPartyHome",
    provider.third_party_home,
    "-SharedCodexHome",
    provider.shared_codex_home,
    "-ProviderName",
    provider.provider_name,
    "-BaseUrl",
    provider.base_url,
    "-Model",
    provider.model,
    "-ReviewModel",
    provider.review_model,
    "-ModelReasoningEffort",
    provider.model_reasoning_effort,
    "-ModelContextWindow",
    String(provider.model_context_window),
    "-ModelAutoCompactTokenLimit",
    String(provider.model_auto_compact_token_limit),
  ];

  const result = spawnSync("powershell", args, {
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(details || `Wrapper installer exited with status ${result.status ?? "unknown"}.`);
  }
}

function deleteThirdPartyAuthIfPresent(provider) {
  const authPath = thirdPartyAuthPath(provider);
  if (fs.existsSync(authPath)) {
    backupFileIfExists(authPath, "codex3-auth.json.bak");
    fs.rmSync(authPath, { force: true });
  }
}

function detectRunningCodexProcesses() {
  if (process.platform !== "win32") {
    return [];
  }

  const psScript = `
$me = ${process.pid};
$items = Get-CimInstance Win32_Process |
  Where-Object {
    $_.ProcessId -ne $me -and
    $_.CommandLine -and (
      $_.CommandLine -match '(?i)AppData\\\\Roaming\\\\npm\\\\node_modules\\\\@openai\\\\codex' -or
      $_.CommandLine -match '(?i)codex-win32-x64'
    ) -and
    $_.CommandLine -notmatch '(?i)codex3-manager'
  } |
  Select-Object ProcessId, Name, CommandLine;
$items | ConvertTo-Json -Compress
`;

  const result = spawnSync("powershell", ["-NoProfile", "-Command", psScript], {
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }

  const parsed = JSON.parse(result.stdout.trim());
  return Array.isArray(parsed) ? parsed : [parsed];
}

function formatProcessSummary(processes) {
  if (!processes.length) {
    return "none";
  }
  return processes.map((item) => `${item.Name}(${item.ProcessId})`).join(", ");
}

function assertNoRunningCodexProcesses() {
  const processes = detectRunningCodexProcesses();
  if (!processes.length) {
    return;
  }
  throw new Error(
    `Running Codex CLI process detected: ${formatProcessSummary(processes)}. Close it first or rerun with --force.`,
  );
}

async function activateProfile(state, profileId, { silent = false, skipProcessCheck = false } = {}) {
  const profile = requireProfile(state, profileId);
  const provider = normalizeProvider(state.provider);
  const source = profileAuthPath(profile.profile_id);
  if (!fs.existsSync(source)) {
    throw new Error(`Saved auth is missing for profile ${profile.profile_id}`);
  }
  if (!skipProcessCheck) {
    assertNoRunningCodexProcesses();
  }

  ensureDir(provider.third_party_home);
  backupFileIfExists(thirdPartyAuthPath(provider), "codex3-auth.json.bak");
  fs.copyFileSync(source, thirdPartyAuthPath(provider));
  writeThirdPartyConfig(provider);

  profile.last_used_at = isoNow();
  state.profiles[profile.profile_id] = profile;
  state.active_profile_id = profile.profile_id;
  saveState(state);

  if (!silent) {
    console.log(
      `Applied third-party profile: ${profile.alias} | ${readSavedProfileMaskedKey(profile.profile_id)}`,
    );
    if (skipProcessCheck) {
      console.log(
        "Heads-up: already-running Codex windows keep their old in-memory auth until they are restarted.",
      );
    }
  }
}

async function setPlainCodexThirdPartyMode(
  state,
  { silent = false, skipProcessCheck = false } = {},
) {
  const provider = normalizeProvider(state.provider);
  const activeProfileId = state.active_profile_id;
  if (!activeProfileId) {
    throw new Error(
      "No active third-party profile is selected. Use Manage first so codex3_m knows which profile plain codex should follow.",
    );
  }

  if (!skipProcessCheck) {
    assertNoRunningCodexProcesses();
  }

  await activateProfile(state, activeProfileId, { silent: true, skipProcessCheck: true });
  capturePlainCodexOfficialBackupsIfNeeded();
  copyThirdPartyAuthToOfficial(provider);
  applyPlainCodexThirdPartyBridge(provider);

  setPlainCodexModeState(PLAIN_CODEX_MODE_THIRD_PARTY, {
    source: "codex3_m",
    provider_name: provider.provider_name,
    provider_base_url: provider.base_url,
    active_profile_id: activeProfileId,
  });

  if (!silent) {
    const profile = requireProfile(state, activeProfileId);
    console.log(
      `Plain codex now follows codex3 using third-party profile: ${profile.alias} | ${readSavedProfileMaskedKey(profile.profile_id)}`,
    );
    if (skipProcessCheck) {
      console.log(
        "Heads-up: already-running Codex windows keep their old in-memory auth until they are restarted.",
      );
    }
  }
}

async function deleteProfile(state, profileId, { silent = false, skipProcessCheck = false } = {}) {
  const profile = requireProfile(state, profileId);
  const isActive = state.active_profile_id === profile.profile_id;
  if (isActive && !skipProcessCheck) {
    assertNoRunningCodexProcesses();
  }

  delete state.profiles[profile.profile_id];
  const dirPath = profileDir(profile.profile_id);
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }

  if (isActive) {
    const remaining = getProfiles(state);
    if (remaining.length) {
      state.active_profile_id = null;
      saveState(state);
      await activateProfile(state, remaining[0].profile_id, {
        silent: true,
        skipProcessCheck,
      });
    } else {
      state.active_profile_id = null;
      deleteThirdPartyAuthIfPresent(normalizeProvider(state.provider));
      saveState(state);
    }
  } else {
    saveState(state);
  }

  if (!silent) {
    console.log(`Deleted third-party profile: ${profile.alias}`);
  }
}

function renameProfileAlias(state, profileId, alias) {
  const profile = requireProfile(state, profileId);
  profile.alias = alias;
  state.profiles[profile.profile_id] = profile;
  saveState(state);
  return profile;
}

function doctorReport(state) {
  const issues = [];
  const warnings = [];
  const provider = normalizeProvider(state.provider);
  const wrapperPs1Path = path.join(LAUNCHER_DIR, `${provider.command_name}.ps1`);
  const wrapperCmdPath = path.join(LAUNCHER_DIR, `${provider.command_name}.cmd`);

  for (const filePath of [
    path.join(LAUNCHER_DIR, "codex3_m.ps1"),
    path.join(LAUNCHER_DIR, "codex3_m.cmd"),
  ]) {
    if (!fs.existsSync(filePath)) {
      issues.push(`Missing manager launcher: ${filePath}`);
    }
  }

  for (const filePath of [wrapperPs1Path, wrapperCmdPath]) {
    if (!fs.existsSync(filePath)) {
      issues.push(`Missing third-party wrapper launcher: ${filePath}`);
    }
  }

  if (process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).trim()) {
    warnings.push(
      "OPENAI_API_KEY is set in the current environment. The wrapper removes it for child runs, but new shells may still inherit it.",
    );
  }

  const officialHome = path.join(os.homedir(), ".codex");
  if (path.resolve(provider.third_party_home) === path.resolve(officialHome)) {
    issues.push("third_party_home resolves to ~/.codex, which would mix third-party auth storage with the shared Codex home.");
  }

  if (path.resolve(provider.third_party_home) === path.resolve(provider.shared_codex_home)) {
    issues.push("third_party_home matches shared_codex_home, so third-party auth would leak into the shared Codex state.");
  }

  if (!fs.existsSync(provider.shared_codex_home)) {
    warnings.push(`Shared Codex home does not exist yet: ${provider.shared_codex_home}`);
  }

  for (const relativePath of SHARED_SESSION_RELATIVE_PATHS) {
    const targetPath = sharedSessionTargetPath(provider, relativePath);
    const linkPath = sharedSessionLinkPath(provider, relativePath);
    if (!fs.existsSync(targetPath)) {
      warnings.push(`Shared session target does not exist yet: ${targetPath}`);
      continue;
    }
    if (!fs.existsSync(linkPath)) {
      issues.push(`Shared session path is missing from third-party home: ${linkPath}`);
      continue;
    }
    if (!pathResolvesTo(linkPath, targetPath)) {
      issues.push(
        `Shared session path does not resolve to the shared Codex home: ${linkPath} -> ${targetPath}`,
      );
    }
  }

  for (const profile of getProfiles(state)) {
    const authPath = profileAuthPath(profile.profile_id);
    if (!fs.existsSync(authPath)) {
      issues.push(`Saved auth missing for profile ${profile.profile_id}`);
      continue;
    }
    try {
      if (detectAuthKind(readJson(authPath)) !== "apikey") {
        issues.push(`Saved auth for profile ${profile.profile_id} is not in API key mode.`);
      }
    } catch (error) {
      issues.push(
        `Saved auth for profile ${profile.profile_id} is invalid: ${error.message || error}`,
      );
    }
  }

  if (state.active_profile_id) {
    const activeProfile = state.profiles[state.active_profile_id];
    if (!activeProfile) {
      issues.push(`active_profile_id points to a missing profile: ${state.active_profile_id}`);
    } else {
      const authPath = thirdPartyAuthPath(provider);
      if (!fs.existsSync(authPath)) {
        issues.push(`Active third-party auth is missing: ${authPath}`);
      } else {
        try {
          const currentMeta = extractApiKeyMeta(readJson(authPath));
          const expectedMeta = extractApiKeyMeta(readJson(profileAuthPath(activeProfile.profile_id)));
          if (currentMeta.key_hash !== expectedMeta.key_hash) {
            issues.push(
              `Third-party auth does not match the active saved profile ${activeProfile.profile_id}.`,
            );
          }
        } catch (error) {
          issues.push(`Active third-party auth is invalid: ${error.message || error}`);
        }
      }
    }
  }

  const configPath = thirdPartyConfigPath(provider);
  if (!fs.existsSync(configPath)) {
    issues.push(`Third-party config is missing: ${configPath}`);
  } else {
    const configText = readText(configPath);
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

  if (fs.existsSync(wrapperPs1Path)) {
    const wrapperText = readText(wrapperPs1Path);
    if (!wrapperText.includes("previousCodexHome")) {
      warnings.push("Wrapper ps1 does not appear to restore CODEX_HOME.");
    }
    if (!wrapperText.includes("previousOpenAiApiKey")) {
      warnings.push("Wrapper ps1 does not appear to restore OPENAI_API_KEY.");
    }
    if (!wrapperText.includes("Remove-Item Env:OPENAI_API_KEY")) {
      warnings.push(
        "Wrapper ps1 does not appear to remove inherited OPENAI_API_KEY during child runs.",
      );
    }
  }

  return { issues, warnings };
}

async function promptLine(question) {
  const rl = readlinePromises.createInterface({ input, output });
  try {
    const answer = await rl.question(question);
    return answer.trim();
  } finally {
    rl.close();
  }
}

async function promptRequired(question, errorLabel) {
  const value = await promptLine(question);
  if (!value) {
    throw new Error(errorLabel);
  }
  return value;
}

async function promptYesNo(question, defaultValue = false) {
  const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
  const answer = (await promptLine(question + suffix)).toLowerCase();
  if (!answer) {
    return defaultValue;
  }
  if (answer === "y" || answer === "yes") {
    return true;
  }
  if (answer === "n" || answer === "no") {
    return false;
  }
  throw new Error("Please answer yes or no.");
}

async function runPrompt(prompt) {
  try {
    return await prompt.run();
  } catch {
    return null;
  }
}

function getSummaryLines(state) {
  const provider = normalizeProvider(state.provider);
  const activeProfile = state.active_profile_id ? state.profiles[state.active_profile_id] : null;
  return [
    "codex3_m",
    `Command: ${provider.command_name}`,
    `Mode: ${providerModeCliLabel(provider.mode)}`,
    `Provider: ${provider.provider_name} | ${provider.base_url}`,
    `Model: ${provider.model} | review ${provider.review_model}`,
    `Active profile: ${activeProfile ? `${activeProfile.alias} | ${readSavedProfileMaskedKey(activeProfile.profile_id)}` : "(none)"}`,
    `Saved third-party profiles: ${getProfiles(state).length}`,
  ];
}

function buildHeader(state, title, description, extraLines = []) {
  return [
    ...getSummaryLines(state),
    "",
    title,
    description,
    ...extraLines,
  ].join("\n");
}

async function selectChoice({
  title,
  description,
  choices,
  state = loadState(),
  promptClass = null,
  extraLines = null,
}) {
  const PromptClass = promptClass || Select;
  return runPrompt(
    new PromptClass({
      name: "value",
      message: title,
      header: buildHeader(
        state,
        title,
        description,
        extraLines || ["Keys: Up/Down move | Enter confirm | Esc back"],
      ),
      footer: "",
      choices,
    }),
  );
}

async function promptInputPrompt(message, initial = "") {
  const value = await runPrompt(
    new Input({
      name: "value",
      message,
      initial,
    }),
  );
  if (value == null) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed || null;
}

async function promptConfirmPrompt(message, initial = false) {
  const value = await runPrompt(
    new Confirm({
      name: "value",
      message,
      initial,
    }),
  );
  return value === true;
}

async function promptSecretPrompt(message) {
  const value = await runPrompt(
    new Password({
      name: "value",
      message,
    }),
  );
  if (value == null) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed || null;
}

function parseOptionValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

async function probeProvider(state, { model = null } = {}) {
  const provider = normalizeProvider(state.provider);
  const authPath = thirdPartyAuthPath(provider);
  if (!fs.existsSync(authPath)) {
    throw new Error(`Third-party auth.json is missing at ${authPath}`);
  }
  const authData = readJson(authPath);
  const apiKey = String(authData.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error(`OPENAI_API_KEY is missing in ${authPath}`);
  }

  const endpointBase = provider.base_url.replace(/\/+$/, "");
  const endpoint = `${endpointBase}/responses`;
  const requestBody = {
    model: model || provider.model,
    input: "Reply with exactly: ok",
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const bodyText = await response.text();
  let parsedBody = null;
  try {
    parsedBody = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parsedBody = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    endpoint,
    model: requestBody.model,
    body: parsedBody || bodyText || null,
  };
}

class ManageSelectPrompt extends Select {
  constructor(options = {}) {
    super({
      ...options,
    });
    this.manageSubmitMode = "activate";
  }

  async next() {
    return this.openMenu();
  }

  async openMenu() {
    const choice = this.focused;
    if (!choice || choice.name === "__back__") {
      return this.alert();
    }
    this.manageSubmitMode = "menu";
    return this.submit();
  }

  async submit() {
    if (this.manageSubmitMode === "menu") {
      const choice = this.focused;
      if (!choice) {
        return this.alert();
      }
      this.state.submitted = true;
      this.value = { mode: "menu", recordId: choice.name };
      await this.close();
      this.emit("submit", this.value);
      return;
    }

    this.manageSubmitMode = "activate";
    return super.submit();
  }
}

async function promptProfileAlias(providedAlias = null, suggestedAlias = null) {
  if (providedAlias) {
    return providedAlias.trim();
  }
  const answer = await promptLine(
    `Enter the third-party API key profile name${suggestedAlias ? ` [${suggestedAlias}]` : ""}: `,
  );
  if (answer) {
    return answer;
  }
  if (suggestedAlias) {
    return suggestedAlias;
  }
  throw new Error("Profile name is required.");
}

async function promptApiKeyValue(providedValue = null) {
  if (providedValue) {
    return String(providedValue).trim();
  }
  if (!process.stdin.isTTY) {
    throw new Error("Adding a third-party API key requires an interactive terminal.");
  }
  const apiKey = await promptSecretPrompt("Third-party OPENAI_API_KEY:");
  if (!apiKey) {
    throw new Error("API key is required.");
  }
  return apiKey;
}

async function maybeActivateProfile(state, profileId, options = {}) {
  const shouldActivate =
    options.activateNow == null
      ? await promptYesNo("Activate this third-party profile for codex3 now?", true)
      : options.activateNow;

  if (!shouldActivate) {
    console.log("Saved without activation.");
    return;
  }

  if (!options.force) {
    assertNoRunningCodexProcesses();
  }
  await activateProfile(state, profileId, { skipProcessCheck: Boolean(options.force) });
}

async function interactiveResolveForce(actionLabel) {
  const processes = detectRunningCodexProcesses();
  if (!processes.length) {
    return { proceed: true, force: false };
  }

  console.log("");
  console.log(`Running Codex CLI detected: ${formatProcessSummary(processes)}`);
  console.log(`This ${actionLabel} updates the shared third-party auth/profile files.`);
  console.log(
    "Already-running Codex windows keep their old in-memory auth until they are restarted.",
  );
  const confirmed = await promptConfirmPrompt("Force continue anyway?", false);
  return {
    proceed: confirmed,
    force: confirmed,
  };
}

async function interactiveMaybeActivateProfile(state, profileId) {
  const shouldActivate = await promptConfirmPrompt(
    "Use this third-party API key profile for codex3 now?",
    true,
  );
  if (!shouldActivate) {
    return false;
  }

  const decision = await interactiveResolveForce("activation");
  if (!decision.proceed) {
    console.log("Activation canceled. Current third-party auth was not changed.");
    return false;
  }
  await activateProfile(state, profileId, { skipProcessCheck: decision.force });
  return true;
}

async function registerProfileFromAuthData(authData, options = {}) {
  const state = loadState();
  const meta = extractApiKeyMeta(authData);
  const profileId = createProfileId(authData.OPENAI_API_KEY);
  const existing = normalizeProfile(state.profiles?.[profileId], profileId);
  const suggestedAlias = existing?.alias || `third-party-key-${getProfiles(state).length + 1}`;
  const alias = await promptProfileAlias(options.alias || null, suggestedAlias);

  saveProfileAuth(profileId, buildAuthData(authData.OPENAI_API_KEY));

  const profile = {
    profile_id: profileId,
    alias,
    key_hash: meta.key_hash,
    created_at: existing?.created_at || isoNow(),
    last_used_at: existing?.last_used_at || null,
  };

  state.profiles[profileId] = profile;
  saveState(state);

  console.log(`Saved third-party profile: ${profile.alias}`);
  console.log(`Profile id: ${profile.profile_id}`);
  await maybeActivateProfile(state, profile.profile_id, options);
}

async function interactiveRegisterProfileFromAuthData(authData, options = {}) {
  const state = loadState();
  const meta = extractApiKeyMeta(authData);
  const profileId = createProfileId(authData.OPENAI_API_KEY);
  const existing = normalizeProfile(state.profiles?.[profileId], profileId);
  const suggestedAlias = existing?.alias || `third-party-key-${getProfiles(state).length + 1}`;
  const alias =
    options.alias ||
    (await promptInputPrompt("Third-party API key profile name:", suggestedAlias)) ||
    suggestedAlias;

  state.profiles[profileId] = {
    profile_id: profileId,
    alias,
    key_hash: meta.key_hash,
    created_at: existing?.created_at || isoNow(),
    last_used_at: existing?.last_used_at || null,
  };
  saveProfileAuth(profileId, buildAuthData(authData.OPENAI_API_KEY));
  saveState(state);

  await interactiveMaybeActivateProfile(state, profileId);
  return true;
}

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function summarizeState(state) {
  const provider = normalizeProvider(state.provider);
  return {
    provider,
    active_profile_id: state.active_profile_id,
    profiles: getProfiles(state).map((profile) => ({
      profile_id: profile.profile_id,
      alias: profile.alias,
      masked_key: readSavedProfileMaskedKey(profile.profile_id),
      is_active: profile.profile_id === state.active_profile_id,
      created_at: profile.created_at,
      last_used_at: profile.last_used_at || null,
    })),
  };
}

function printProfileSummary(state) {
  const profiles = getProfiles(state);
  if (!profiles.length) {
    console.log("No saved third-party profiles.");
    return;
  }

  profiles.forEach((profile, index) => {
    const activeMark = profile.profile_id === state.active_profile_id ? "*" : " ";
    console.log(
      `${String(index + 1).padStart(2, " ")} ${activeMark} ${profile.alias} | ${readSavedProfileMaskedKey(profile.profile_id)}`,
    );
    console.log(`   profile_id: ${profile.profile_id}`);
  });
  console.log("");
  console.log("* active third-party profile in manager state");
}

function printOverview(state) {
  const provider = normalizeProvider(state.provider);
  const plainCodexMode = getPlainCodexMode();
  console.log("codex3_m");
  console.log("");
  console.log(`Command: ${provider.command_name}`);
  console.log(`Third-party home: ${provider.third_party_home}`);
  console.log(`Shared Codex home: ${provider.shared_codex_home}`);
  console.log(`Provider: ${provider.provider_name} | ${provider.base_url}`);
  console.log(`Model: ${provider.model} | review ${provider.review_model}`);
  console.log(`Plain codex mode: ${plainCodexMode}`);
  console.log(`Saved profiles: ${getProfiles(state).length}`);
  console.log(
    `Active profile: ${state.active_profile_id ? `${requireProfile(state, state.active_profile_id).alias} | ${readSavedProfileMaskedKey(state.active_profile_id)}` : "(none)"}`,
  );
  console.log("");
  printProfileSummary(state);
  console.log("");
  console.log("Commands:");
  console.log("  codex3_m login");
  console.log("  codex3_m list");
  console.log("  codex3_m activate <profile-id> [--force]");
  console.log("  codex3_m rename <profile-id> --alias <manual-name>");
  console.log("  codex3_m delete <profile-id> [--force]");
  console.log("  codex3_m use-codex3 [--force]");
  console.log("  codex3_m provider show");
  console.log("  codex3_m provider set");
  console.log("  codex3_m doctor");
}

function buildManageChoices(state) {
  const choices = getProfiles(state).map((profile) => ({
    name: profile.profile_id,
    message: profile.alias,
    hint: `${readSavedProfileMaskedKey(profile.profile_id)}${profile.profile_id === state.active_profile_id ? " | active" : ""}`,
  }));

  choices.push({
    name: "__back__",
    message: "Back",
  });

  return choices;
}

async function runManageActionsMenu(profileId) {
  while (true) {
    const state = loadState();
    const profile = normalizeProfile(state.profiles?.[profileId], profileId);
    if (!profile) {
      return;
    }

    const choice = await selectChoice({
      title: "Profile Actions",
      description: `${profile.alias} | Tab from Manage opens this menu.`,
      state,
      choices: [
        {
          name: "rename",
          message: "Rename",
          hint: profile.alias,
        },
        {
          name: "delete",
          message: "Delete",
          hint: "remove only this saved third-party API key profile",
        },
        {
          name: "back",
          message: "Back",
        },
      ],
    });

    if (!choice || choice === "back") {
      return;
    }

    if (choice === "rename") {
      const alias =
        (await promptInputPrompt("Third-party API key profile name:", profile.alias)) ||
        profile.alias;
      renameProfileAlias(state, profileId, alias);
      continue;
    }

    const confirmed = await promptConfirmPrompt(
      `Delete third-party profile '${profile.alias}'?`,
      false,
    );
    if (!confirmed) {
      continue;
    }
    const decision =
      state.active_profile_id === profileId
        ? await interactiveResolveForce("delete")
        : { proceed: true, force: false };
    if (!decision.proceed) {
      console.log("Delete canceled. Current third-party auth remains unchanged.");
      continue;
    }
    await deleteProfile(state, profileId, { skipProcessCheck: decision.force });
    return;
  }
}

async function runManagePage() {
  while (true) {
    const state = loadState();
    const selected = await selectChoice({
      title: "Manage",
      description: "Enter applies the selected third-party profile locally. Tab opens Rename or Delete.",
      state,
      promptClass: ManageSelectPrompt,
      extraLines: ["Keys: Up/Down move | Enter apply locally | Tab more actions | Esc back"],
      choices: buildManageChoices(state),
    });

    if (!selected || selected === "__back__") {
      return;
    }

    if (typeof selected === "object" && selected.mode === "menu") {
      await runManageActionsMenu(selected.recordId);
      continue;
    }

    const profile = requireProfile(loadState(), selected);
    if (loadState().active_profile_id === profile.profile_id) {
      console.log(`Already using '${profile.alias}'.`);
      continue;
    }

    const decision = await interactiveResolveForce("switch");
    if (!decision.proceed) {
      console.log("Switch canceled. Current third-party auth remains unchanged.");
      continue;
    }
    await activateProfile(loadState(), profile.profile_id, { skipProcessCheck: decision.force });
    return;
  }
}

async function runProviderPage() {
  while (true) {
    const state = loadState();
    const provider = normalizeProvider(state.provider);
    const choice = await selectChoice({
      title: "Provider",
      description: "Inspect or update the third-party provider settings and shared session home used by codex3.",
      state,
      choices: [
        {
          name: "show",
          message: "Show current provider settings",
          hint: `${provider.provider_name} | ${provider.base_url}`,
        },
        {
          name: "mode",
          message: "Switch provider mode",
          hint:
            providerModeCliLabel(provider.mode) === "compat"
              ? "compat | better recent-session visibility"
              : "stable-http | disable websocket path",
        },
        {
          name: "set",
          message: "Edit provider settings",
          hint: `${provider.command_name} | ${provider.model}`,
        },
        {
          name: "reinstall",
          message: "Reinstall codex3 wrapper",
          hint: provider.command_name,
        },
        {
          name: "back",
          message: "Back",
        },
      ],
    });

    if (!choice || choice === "back") {
      return;
    }

    if (choice === "show") {
      await selectChoice({
        title: "Provider Settings",
        description: "Esc returns.",
        state,
        choices: [
          { name: "command", message: `Command: ${provider.command_name}`, hint: "wrapper command" },
          { name: "mode", message: `Mode: ${providerModeCliLabel(provider.mode)}`, hint: "compat or stable-http" },
          { name: "home", message: `Third-party home: ${provider.third_party_home}`, hint: "stores third-party auth and provider mirror config" },
          { name: "shared_home", message: `Shared Codex home: ${provider.shared_codex_home}`, hint: "sessions and archived_sessions are shared from here" },
          { name: "provider", message: `Provider: ${provider.provider_name}`, hint: "derived from mode" },
          { name: "url", message: `Base URL: ${provider.base_url}`, hint: "OpenAI-compatible endpoint" },
          { name: "model", message: `Model: ${provider.model}`, hint: "default model" },
          { name: "review_model", message: `Review model: ${provider.review_model}`, hint: "tutorial review_model" },
          { name: "effort", message: `Reasoning effort: ${provider.model_reasoning_effort}`, hint: "tutorial model_reasoning_effort" },
          { name: "window", message: `Context window: ${provider.model_context_window}`, hint: "tutorial model_context_window" },
          { name: "compact", message: `Auto compact limit: ${provider.model_auto_compact_token_limit}`, hint: "tutorial model_auto_compact_token_limit" },
          { name: "back", message: "Back" },
        ],
      });
      continue;
    }

    if (choice === "mode") {
      const modeChoice = await selectChoice({
        title: "Provider Mode",
        description:
          "Compat uses provider id 'openai' for better session visibility. Stable HTTP uses a custom provider id with websockets disabled.",
        state,
        choices: [
          {
            name: PROVIDER_MODE_COMPAT,
            message: "compat",
            hint: "best session visibility with official recent sessions, but some gateways reconnect",
          },
          {
            name: PROVIDER_MODE_STABLE_HTTP,
            message: "stable-http",
            hint: "better speed and stability on some third-party gateways, but session lists split by provider id",
          },
          {
            name: "back",
            message: "Back",
          },
        ],
      });

      if (!modeChoice || modeChoice === "back") {
        continue;
      }

      await handleProviderSet(["--mode", modeChoice]);
      continue;
    }

    if (choice === "reinstall") {
      writeThirdPartyConfig(provider);
      runWrapperInstaller(provider);
      console.log(`Reinstalled wrapper command '${provider.command_name}'.`);
      continue;
    }

    const commandName =
      (await promptInputPrompt("Wrapper command name:", provider.command_name)) ||
      provider.command_name;
    const thirdPartyHome =
      (await promptInputPrompt("Third-party auth home:", provider.third_party_home)) ||
      provider.third_party_home;
    const sharedCodexHome =
      (await promptInputPrompt("Shared Codex home:", provider.shared_codex_home)) ||
      provider.shared_codex_home;
    const baseUrl = (await promptInputPrompt("Base URL:", provider.base_url)) || provider.base_url;
    const model = (await promptInputPrompt("Model:", provider.model)) || provider.model;
    const reviewModel =
      (await promptInputPrompt("Review model:", provider.review_model)) || provider.review_model;
    const reasoningEffort =
      (await promptInputPrompt("Model reasoning effort:", provider.model_reasoning_effort)) ||
      provider.model_reasoning_effort;
    const contextWindow =
      (await promptInputPrompt(
        "Model context window:",
        String(provider.model_context_window),
      )) || String(provider.model_context_window);
    const autoCompactTokenLimit =
      (await promptInputPrompt(
        "Model auto compact token limit:",
        String(provider.model_auto_compact_token_limit),
      )) || String(provider.model_auto_compact_token_limit);

    await handleProviderSet([
      "--command-name",
      commandName,
      "--mode",
      providerModeCliLabel(provider.mode),
      "--third-party-home",
      thirdPartyHome,
      "--shared-codex-home",
      sharedCodexHome,
      "--base-url",
      baseUrl,
      "--model",
      model,
      "--review-model",
      reviewModel,
      "--model-reasoning-effort",
      reasoningEffort,
      "--model-context-window",
      contextWindow,
      "--model-auto-compact-token-limit",
      autoCompactTokenLimit,
    ]);
  }
}

async function runLoginPage() {
  while (true) {
    const state = loadState();
    const choice = await selectChoice({
      title: "Login",
      description: "Save a third-party API key profile while keeping auth isolated and sharing session dirs.",
      state,
      choices: [
        {
          name: "add",
          message: "Add third-party API key now",
          hint: "prompts for API key and saves it under ~/.codex3-manager",
        },
        {
          name: "import_current",
          message: "Use current third-party auth.json",
          hint: "imports the auth already present in the third-party auth home",
        },
        {
          name: "back",
          message: "Back",
        },
      ],
    });

    if (!choice || choice === "back") {
      return;
    }

    if (choice === "add") {
      const apiKey = await promptApiKeyValue();
      await interactiveRegisterProfileFromAuthData(buildAuthData(apiKey));
      continue;
    }

    const provider = normalizeProvider(state.provider);
    const authPath = thirdPartyAuthPath(provider);
    if (!fs.existsSync(authPath)) {
      throw new Error(`Third-party auth.json is missing at ${authPath}`);
    }
    await interactiveRegisterProfileFromAuthData(readJson(authPath));
  }
}

async function runOverviewPage() {
  while (true) {
    const state = loadState();
    const choice = await selectChoice({
      title: "Home",
      description: "Choose the thing you want to do most often.",
      state,
      choices: [
        {
          name: "login",
          message: "Login",
          hint: "save a third-party API key profile",
        },
        {
          name: "manage",
          message: "Manage",
          hint: "switch, rename, or delete saved third-party profiles",
        },
        {
          name: "provider",
          message: "Provider",
          hint: "edit shared wrapper/provider settings for codex3",
        },
        {
          name: "use_codex3",
          message: "Plain codex -> codex3",
          hint: "bridge ~/.codex to the active third-party profile without touching the launcher",
        },
        {
          name: "quit",
          message: "Quit",
        },
      ],
    });

    if (!choice || choice === "quit") {
      console.log("Bye.");
      return;
    }

    if (choice === "login") {
      await runLoginPage();
      continue;
    }
    if (choice === "manage") {
      await runManagePage();
      continue;
    }
    if (choice === "use_codex3") {
      const decision = await interactiveResolveForce("plain-codex bridge");
      if (!decision.proceed) {
        console.log("Plain codex bridge canceled.");
        continue;
      }
      await setPlainCodexThirdPartyMode(loadState(), { skipProcessCheck: decision.force });
      return;
    }
    await runProviderPage();
  }
}

function printHelp() {
  console.log(`codex3_m

Machine-local manager for isolated codex3 auth plus shared session directories on Windows.

Usage:
  codex3_m
  codex3_m menu
  codex3_m login [--import-current] [--alias <manual-name>] [--activate|--no-activate] [--force]
  codex3_m list [--json]
  codex3_m activate <profile-id> [--force]
  codex3_m rename <profile-id> --alias <manual-name>
  codex3_m delete <profile-id> [--force]
  codex3_m use-codex3 [--force]
  codex3_m mode show
  codex3_m mode set <compat|stable-http>
  codex3_m provider show [--json]
  codex3_m provider set [--mode <compat|stable-http>] [--command-name <name>] [--third-party-home <path>] [--shared-codex-home <path>] [--base-url <url>] [--model <name>] [--review-model <name>] [--model-reasoning-effort <name>] [--model-context-window <n>] [--model-auto-compact-token-limit <n>]
  codex3_m doctor

Notes:
  - Running plain 'codex3_m' opens a Home page with Login, Manage, Provider, Plain codex -> codex3, and Quit.
  - compat mode keeps third-party auth outside ~/.codex and aligns provider id with the built-in openai lane for better recent-session visibility.
  - stable-http mode uses a custom provider id with supports_websockets=false for gateways that reconnect too often.
  - The provider mirror config lives under ~/.codex-apikey/config.toml by default and records the tutorial values applied to codex3.
  - Saved third-party API key profiles live under ~/.codex3-manager/profiles/.
`);
}

async function handleList(state, args) {
  const json = args.includes("--json");
  if (json) {
    printJson(summarizeState(state));
    return;
  }
  printProfileSummary(state);
}

async function handleLogin(args) {
  let importCurrent = false;
  let alias = null;
  let activateNow = null;
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--import-current") {
      importCurrent = true;
    } else if (arg === "--alias") {
      alias = parseOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--activate") {
      activateNow = true;
    } else if (arg === "--no-activate") {
      activateNow = false;
    } else if (arg === "--force") {
      force = true;
    } else {
      throw new Error(`Unknown login option: ${arg}`);
    }
  }

  if (importCurrent) {
    const provider = normalizeProvider(loadState().provider);
    const authPath = thirdPartyAuthPath(provider);
    if (!fs.existsSync(authPath)) {
      throw new Error(`Third-party auth.json is missing at ${authPath}`);
    }
    await registerProfileFromAuthData(readJson(authPath), {
      alias,
      activateNow,
      force,
    });
    return;
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      "Use 'codex3_m login --import-current' or run 'codex3_m login' in an interactive terminal.",
    );
  }

  const apiKey = await promptApiKeyValue();
  await registerProfileFromAuthData(buildAuthData(apiKey), {
    alias,
    activateNow,
    force,
  });
}

async function handleActivate(state, args) {
  const profileId = args[0];
  if (!profileId) {
    throw new Error("Usage: codex3_m activate <profile-id> [--force]");
  }

  let force = false;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--force") {
      force = true;
    } else {
      throw new Error(`Unknown activate option: ${arg}`);
    }
  }

  await activateProfile(state, profileId, { skipProcessCheck: force });
}

async function handleUseCodex3(state, args) {
  let force = false;

  for (const arg of args) {
    if (arg === "--force") {
      force = true;
    } else {
      throw new Error(`Unknown use-codex3 option: ${arg}`);
    }
  }

  if (!force && process.stdin.isTTY) {
    const decision = await interactiveResolveForce("plain-codex bridge");
    if (!decision.proceed) {
      console.log("Plain codex bridge canceled.");
      return;
    }
    force = decision.force;
  }

  await setPlainCodexThirdPartyMode(state, { skipProcessCheck: force });
}

async function handleRename(state, args) {
  const profileId = args[0];
  if (!profileId) {
    throw new Error("Usage: codex3_m rename <profile-id> --alias <manual-name>");
  }

  let alias = null;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--alias") {
      alias = parseOptionValue(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown rename option: ${arg}`);
    }
  }

  if (!alias) {
    alias = await promptRequired(
      "Enter the manual third-party API key profile name to display: ",
      "Profile name is required.",
    );
  }

  renameProfileAlias(state, profileId, alias);
  console.log(`Renamed third-party profile to: ${alias}`);
}

async function handleDelete(state, args) {
  const profileId = args[0];
  if (!profileId) {
    throw new Error("Usage: codex3_m delete <profile-id> [--force]");
  }

  let force = false;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--force") {
      force = true;
    } else {
      throw new Error(`Unknown delete option: ${arg}`);
    }
  }

  const profile = requireProfile(state, profileId);
  const confirmed = await promptYesNo(
    `Delete '${profile.alias}' (${readSavedProfileMaskedKey(profile.profile_id)})?`,
    false,
  );
  if (!confirmed) {
    console.log("Delete canceled.");
    return;
  }

  await deleteProfile(state, profileId, { skipProcessCheck: force });
}

async function handleProviderShow(state, args) {
  const json = args.includes("--json");
  const provider = normalizeProvider(state.provider);
  if (json) {
    printJson(provider);
    return;
  }
  console.log(`Command name     : ${provider.command_name}`);
  console.log(`Mode             : ${providerModeCliLabel(provider.mode)}`);
  console.log(`Third-party home : ${provider.third_party_home}`);
  console.log(`Shared Codex home: ${provider.shared_codex_home}`);
  console.log(`Provider name    : ${provider.provider_name}`);
  console.log(`Base URL         : ${provider.base_url}`);
  console.log(`Model            : ${provider.model}`);
  console.log(`Review model     : ${provider.review_model}`);
  console.log(`Reasoning effort : ${provider.model_reasoning_effort}`);
  console.log(`Context window   : ${provider.model_context_window}`);
  console.log(`Auto compact     : ${provider.model_auto_compact_token_limit}`);
}

async function handleProviderSet(args) {
  const state = loadState();
  const current = normalizeProvider(state.provider);
  const next = {
    ...current,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--command-name") {
      next.command_name = parseOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--mode") {
      next.mode = normalizeProviderMode(parseOptionValue(args, index, arg));
      index += 1;
    } else if (arg === "--third-party-home") {
      next.third_party_home = parseOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--shared-codex-home") {
      next.shared_codex_home = parseOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--provider-name") {
      next.provider_name = parseOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--base-url") {
      next.base_url = parseOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--model") {
      next.model = parseOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--review-model") {
      next.review_model = parseOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--model-reasoning-effort") {
      next.model_reasoning_effort = parseOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--model-context-window") {
      next.model_context_window = parseOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--model-auto-compact-token-limit") {
      next.model_auto_compact_token_limit = parseOptionValue(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown provider set option: ${arg}`);
    }
  }

  state.provider = normalizeProvider(next);
  saveState(state);
  writeThirdPartyConfig(state.provider);
  runWrapperInstaller(state.provider);
  if (state.active_profile_id) {
    await activateProfile(state, state.active_profile_id, {
      silent: true,
      skipProcessCheck: true,
    });
  }
  console.log(
    `Updated provider settings for '${state.provider.command_name}' (${providerModeCliLabel(state.provider.mode)}).`,
  );
}

async function handleMode(state, args) {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "show") {
    await handleProviderShow(state, []);
    return;
  }
  if (subcommand === "set") {
    const modeArg = rest[0];
    if (!modeArg) {
      throw new Error("Usage: codex3_m mode set <compat|stable-http>");
    }
    await handleProviderSet(["--mode", modeArg]);
    return;
  }
  throw new Error(`Unknown mode subcommand: ${subcommand}`);
}

async function handleDoctor(state) {
  const { issues, warnings } = doctorReport(state);
  if (!issues.length) {
    console.log("No obvious issues found.");
    warnings.forEach((warning, index) => {
      console.log(`Warning ${index + 1}. ${warning}`);
    });
    return;
  }

  issues.forEach((issue, index) => {
    console.log(`${index + 1}. ${issue}`);
  });
  warnings.forEach((warning, index) => {
    console.log(`Warning ${index + 1}. ${warning}`);
  });
  process.exitCode = 1;
}

async function handleCommand(args) {
  const state = loadState();
  const [command, ...rest] = args;

  if (!command) {
    if (process.stdin.isTTY) {
      await runOverviewPage();
      return;
    }
    printOverview(state);
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "menu") {
    await runOverviewPage();
    return;
  }

  if (command === "list") {
    await handleList(state, rest);
    return;
  }

  if (command === "login") {
    await handleLogin(rest);
    return;
  }

  if (command === "activate") {
    await handleActivate(state, rest);
    return;
  }

  if (command === "use-codex3") {
    await handleUseCodex3(state, rest);
    return;
  }

  if (command === "rename") {
    await handleRename(state, rest);
    return;
  }

  if (command === "delete") {
    await handleDelete(state, rest);
    return;
  }

  if (command === "provider") {
    const [subcommand, ...providerArgs] = rest;
    if (!subcommand || subcommand === "show") {
      await handleProviderShow(state, providerArgs);
      return;
    }
    if (subcommand === "set") {
      await handleProviderSet(providerArgs);
      return;
    }
    throw new Error(`Unknown provider subcommand: ${subcommand}`);
  }

  if (command === "mode") {
    await handleMode(state, rest);
    return;
  }

  if (command === "doctor") {
    await handleDoctor(state);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

handleCommand(process.argv.slice(2)).catch((error) => {
  console.error(`Error: ${error.message || error}`);
  process.exitCode = 1;
});
