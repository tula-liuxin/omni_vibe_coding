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

const VERSION = 1;
const MANAGER_HOME = path.join(os.homedir(), ".codex3-manager");
const STATE_PATH = path.join(MANAGER_HOME, "state.json");
const PROFILES_DIR = path.join(MANAGER_HOME, "profiles");
const BACKUPS_DIR = path.join(MANAGER_HOME, "backups");
const SCRIPTS_DIR = path.join(MANAGER_HOME, "scripts");
const LAUNCHER_DIR =
  process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "npm")
    : path.join(os.homedir(), ".local", "bin");

const DEFAULT_THIRD_PARTY_HOME = path.join(os.homedir(), ".codex-apikey");
const DEFAULT_PROVIDER = {
  command_name: "codex3",
  third_party_home: DEFAULT_THIRD_PARTY_HOME,
  provider_name: "OpenAI",
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

function normalizeProvider(provider = {}) {
  const thirdPartyHome = path.resolve(
    String(provider.third_party_home || DEFAULT_PROVIDER.third_party_home),
  );
  return {
    command_name:
      String(provider.command_name || DEFAULT_PROVIDER.command_name).trim() ||
      DEFAULT_PROVIDER.command_name,
    third_party_home: thirdPartyHome,
    provider_name:
      String(provider.provider_name || DEFAULT_PROVIDER.provider_name).trim() ||
      DEFAULT_PROVIDER.provider_name,
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
  const text = [
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
    "",
    "[features]",
    "apps = false",
    "",
  ].join("\n");

  ensureDir(provider.third_party_home);
  backupFileIfExists(thirdPartyConfigPath(provider), "codex3-config.toml.bak");
  writeText(thirdPartyConfigPath(provider), text);
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
    issues.push("third_party_home resolves to ~/.codex, which breaks isolation from official codex.");
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
    const requiredSnippets = [
      'cli_auth_credentials_store = "file"',
      `model_provider = "${provider.provider_name}"`,
      `model = "${provider.model}"`,
      `review_model = "${provider.review_model}"`,
      `model_reasoning_effort = "${provider.model_reasoning_effort}"`,
      `model_context_window = ${provider.model_context_window}`,
      `model_auto_compact_token_limit = ${provider.model_auto_compact_token_limit}`,
      `base_url = "${provider.base_url}"`,
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
  console.log(`This ${actionLabel} updates the isolated third-party auth and config files.`);
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
  console.log("codex3_m");
  console.log("");
  console.log(`Command: ${provider.command_name}`);
  console.log(`Third-party home: ${provider.third_party_home}`);
  console.log(`Provider: ${provider.provider_name} | ${provider.base_url}`);
  console.log(`Model: ${provider.model} | review ${provider.review_model}`);
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
      description: "Inspect or update the shared third-party provider settings used by codex3.",
      state,
      choices: [
        {
          name: "show",
          message: "Show current provider settings",
          hint: `${provider.provider_name} | ${provider.base_url}`,
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
          { name: "home", message: `Third-party home: ${provider.third_party_home}`, hint: "isolated CODEX_HOME" },
          { name: "provider", message: `Provider: ${provider.provider_name}`, hint: "model_provider name" },
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
      (await promptInputPrompt("Third-party CODEX_HOME:", provider.third_party_home)) ||
      provider.third_party_home;
    const providerName =
      (await promptInputPrompt("Provider name:", provider.provider_name)) ||
      provider.provider_name;
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
      "--third-party-home",
      thirdPartyHome,
      "--provider-name",
      providerName,
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
      description: "Save a third-party API key profile for isolated codex3 usage.",
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
          hint: "imports the auth already present in the isolated third-party CODEX_HOME",
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
    await runProviderPage();
  }
}

function printHelp() {
  console.log(`codex3_m

Machine-local manager for isolated third-party codex3 API key profiles on Windows.

Usage:
  codex3_m
  codex3_m menu
  codex3_m login [--import-current] [--alias <manual-name>] [--activate|--no-activate] [--force]
  codex3_m list [--json]
  codex3_m activate <profile-id> [--force]
  codex3_m rename <profile-id> --alias <manual-name>
  codex3_m delete <profile-id> [--force]
  codex3_m provider show [--json]
  codex3_m provider set [--command-name <name>] [--third-party-home <path>] [--provider-name <name>] [--base-url <url>] [--model <name>] [--review-model <name>] [--model-reasoning-effort <name>] [--model-context-window <n>] [--model-auto-compact-token-limit <n>]
  codex3_m doctor

Notes:
  - Running plain 'codex3_m' opens a Home page with Login, Manage, Provider, and Quit.
  - codex3_m only manages the isolated third-party command and never touches official ~/.codex state.
  - The shared provider config lives under ~/.codex-apikey/config.toml by default and mirrors the tutorial values you provide.
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
  console.log(`Third-party home : ${provider.third_party_home}`);
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
    } else if (arg === "--third-party-home") {
      next.third_party_home = parseOptionValue(args, index, arg);
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
  console.log(`Updated provider settings for '${state.provider.command_name}'.`);
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
