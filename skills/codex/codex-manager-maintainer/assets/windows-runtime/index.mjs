#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  ensureDir,
  ensureDirectoryJunction,
  ensureFileHardLink,
  pathExists,
  readJson,
  readJsonIfExists,
  readText,
  safeRealPath,
  writeJson,
  writeText,
} from "./_shared/common.mjs";
import { syncDesktopHomeFromSource } from "./_shared/desktop-home-sync.mjs";
import {
  PLAIN_CODEX_MODE_OFFICIAL,
  PLAIN_CODEX_MODE_THIRD_PARTY,
  getPlainCodexMode as getPlainCodexModeState,
  readPlainCodexModeState as readPlainCodexModeStateFile,
  setPlainCodexModeState as writePlainCodexModeState,
} from "./_shared/plain-codex-mode.mjs";
import {
  assertNoRunningCodexProcesses as assertNoRunningCodexProcessesCore,
  detectRunningCodexProcesses as detectRunningCodexProcessesCore,
  formatProcessSummary as formatProcessSummaryCore,
} from "./_shared/processes.mjs";
import {
  Confirm,
  Input,
  Password,
  Select,
  installPromptCloseGuards,
  promptConfirmPrompt as promptConfirmPromptCore,
  promptInputPrompt as promptInputPromptCore,
  promptLine as promptLineCore,
  promptRequired as promptRequiredCore,
  promptSecretPrompt as promptSecretPromptCore,
  promptYesNo as promptYesNoCore,
  runPrompt as runPromptCore,
} from "./_shared/prompts.mjs";
import {
  copyDatabaseWithSidecars as copyDatabaseWithSidecarsCore,
  findRecentRolloutsById as findRecentRolloutsByIdCore,
  parseThreadRowFromRollout as parseThreadRowFromRolloutCore,
  readRecentSessionIndexEntries as readRecentSessionIndexEntriesCore,
  removeDatabaseSidecars as removeDatabaseSidecarsCore,
  syncSharedThreadMetadata as syncSharedThreadMetadataCore,
  toUnixTimestampSeconds as toUnixTimestampSecondsCore,
} from "./_shared/thread-sync.mjs";

installPromptCloseGuards();

const VERSION = 3;
const MANAGER_HOME = path.join(os.homedir(), ".codex-manager");
const STATE_PATH = path.join(MANAGER_HOME, "state.json");
const ACCOUNTS_DIR = path.join(MANAGER_HOME, "accounts");
const OFFICIAL_API_KEYS_DIR = path.join(MANAGER_HOME, "official-api-keys");
const BACKUPS_DIR = path.join(MANAGER_HOME, "backups");
const TMP_DIR = path.join(MANAGER_HOME, "tmp");
const PLAIN_CODEX_MODE_STATE_PATH = path.join(MANAGER_HOME, "plain-codex-mode.json");
const LAUNCHER_DIR =
  process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "npm")
    : path.join(os.homedir(), ".local", "bin");

const OFFICIAL_HOME = path.join(os.homedir(), ".codex");
const OFFICIAL_AUTH_PATH = path.join(OFFICIAL_HOME, "auth.json");
const OFFICIAL_CONFIG_PATH = path.join(OFFICIAL_HOME, "config.toml");
const OFFICIAL_CLI_HOME = path.join(os.homedir(), ".codex-official");
const OFFICIAL_CLI_AUTH_PATH = path.join(OFFICIAL_CLI_HOME, "auth.json");
const OFFICIAL_CLI_CONFIG_PATH = path.join(OFFICIAL_CLI_HOME, "config.toml");
const THIRD_PARTY_MANAGER_STATE_PATH = path.join(os.homedir(), ".codex3-manager", "state.json");
const OFFICIAL_CLI_SHARED_DIRECTORIES = [
  "sessions",
  "archived_sessions",
  "skills",
  "memories",
  "rules",
  "vendor_imports",
];
const OFFICIAL_CLI_SHARED_FILES = ["session_index.jsonl"];

const MANAGED_CONFIG_KEYS = {
  cli_auth_credentials_store: '"file"',
};

const PROFILE_KIND_CHATGPT = "chatgpt";
const PROFILE_KIND_OFFICIAL_API_KEY = "official_api_key";

function ensureOfficialCliHomeLayout() {
  ensureDir(OFFICIAL_CLI_HOME);
  for (const relativePath of OFFICIAL_CLI_SHARED_DIRECTORIES) {
    ensureDirectoryJunction(
      path.join(OFFICIAL_CLI_HOME, relativePath),
      path.join(OFFICIAL_HOME, relativePath),
    );
  }
  for (const relativePath of OFFICIAL_CLI_SHARED_FILES) {
    ensureFileHardLink(
      path.join(OFFICIAL_CLI_HOME, relativePath),
      path.join(OFFICIAL_HOME, relativePath),
    );
  }
}

function resolveUpstreamCodexBinPath() {
  const candidates = [];

  if (process.platform === "win32") {
    candidates.push(path.join(LAUNCHER_DIR, "node_modules", "@openai", "codex", "bin", "codex.js"));
  }

  if (process.env.npm_config_prefix) {
    const npmPrefix = path.resolve(process.env.npm_config_prefix);
    candidates.push(
      process.platform === "win32"
        ? path.join(npmPrefix, "node_modules", "@openai", "codex", "bin", "codex.js")
        : path.join(npmPrefix, "lib", "node_modules", "@openai", "codex", "bin", "codex.js"),
    );
  }

  const resolved = candidates.find((candidate) => pathExists(candidate));
  if (!resolved) {
    throw new Error(
      `Unable to locate upstream @openai/codex at the expected global install paths. Checked: ${candidates.join(", ")}`,
    );
  }
  return resolved;
}

function runFreshOfficialLogin(captureHome) {
  const env = {
    ...process.env,
    CODEX_HOME: captureHome,
  };
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_BASE_URL;

  const result = spawnSync(
    process.execPath,
    [
      resolveUpstreamCodexBinPath(),
      "login",
      "-c",
      'model_provider="openai"',
      "-c",
      'cli_auth_credentials_store="file"',
    ],
    {
      env,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    throw new Error(`codex login exited with status ${result.status ?? "unknown"}.`);
  }
}

function getThirdPartyHomeFromState() {
  const state = readJsonIfExists(THIRD_PARTY_MANAGER_STATE_PATH);
  const configured = state?.provider?.third_party_home;
  return configured ? path.resolve(String(configured)) : path.join(os.homedir(), ".codex-apikey");
}

function getManagedThreadSyncTargets() {
  const targets = [OFFICIAL_HOME, OFFICIAL_CLI_HOME];
  const thirdPartyHome = getThirdPartyHomeFromState();
  if (thirdPartyHome && !targets.includes(thirdPartyHome) && pathExists(thirdPartyHome)) {
    targets.push(thirdPartyHome);
  }
  return targets;
}

function syncManagedThreadMetadata({ scope = "recent" } = {}) {
  const results = [];
  for (const targetHome of getManagedThreadSyncTargets()) {
    try {
      results.push({
        targetHome,
        ...syncSharedThreadMetadataCore(OFFICIAL_HOME, targetHome, { scope }),
      });
    } catch (error) {
      if (targetHome === OFFICIAL_HOME && pathExists(path.join(OFFICIAL_CLI_HOME, "state_5.sqlite"))) {
        try {
          removeDatabaseSidecars(path.join(OFFICIAL_HOME, "state_5.sqlite"));
          fs.copyFileSync(
            path.join(OFFICIAL_CLI_HOME, "state_5.sqlite"),
            path.join(OFFICIAL_HOME, "state_5.sqlite"),
          );
          results.push({
            targetHome,
            scanned: 0,
            upserted: 0,
            scope,
            mirrored_from: OFFICIAL_CLI_HOME,
          });
          continue;
        } catch {
          // fall through to normal error reporting
        }
      }
      results.push({
        targetHome,
        scanned: 0,
        upserted: 0,
        scope,
        error: error.message,
      });
    }
  }
  return results;
}

function findLatestStateDbBackup() {
  if (!pathExists(BACKUPS_DIR)) {
    return null;
  }
  const backups = fs
    .readdirSync(BACKUPS_DIR)
    .filter((name) => /^state_5\.sqlite\..*\.bak$/i.test(name))
    .sort();
  if (!backups.length) {
    return null;
  }
  return path.join(BACKUPS_DIR, backups[backups.length - 1]);
}

function parseThreadRowFromRollout(rolloutPath, fallbackTitle) {
  return parseThreadRowFromRolloutCore(rolloutPath, fallbackTitle);
}

function buildRecentSharedThreadRows(sharedHome, targetHome) {
  const indexEntries = readRecentSessionIndexEntriesCore(sharedHome);
  const found = findRecentRolloutsByIdCore(
    sharedHome,
    indexEntries.map((entry) => entry.id),
  );
  const rows = [];

  for (const entry of indexEntries) {
    const located = found.get(entry.id);
    if (!located) {
      continue;
    }

    const row = parseThreadRowFromRolloutCore(located.fullPath, entry.thread_name || "");
    if (!row.id) {
      continue;
    }

    row.archived = located.bucketName === "archived_sessions" ? 1 : 0;
    row.archived_at = row.archived ? row.updated_at : null;
    row.updated_at = Math.max(row.updated_at, toUnixTimestampSecondsCore(entry.updated_at || ""));
    row.title = entry.thread_name || row.title;
    row.rollout_path = path.join(
      targetHome,
      located.bucketName,
      path.relative(located.root, located.fullPath),
    );
    rows.push(row);
  }

  return rows;
}

function buildAllSharedThreadRows(sharedHome, targetHome) {
  const indexEntries = readRecentSessionIndexEntriesCore(sharedHome);
  const indexById = new Map(indexEntries.map((entry) => [entry.id, entry]));
  const rows = [];

  for (const bucketName of ["sessions", "archived_sessions"]) {
    const root = path.join(sharedHome, bucketName);
    if (!pathExists(root)) {
      continue;
    }

    const stack = [root];
    while (stack.length) {
      const current = stack.pop();
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (!entry.isFile() || !/^rollout-.*\.jsonl$/i.test(entry.name)) {
          continue;
        }

        const match = entry.name.match(
          /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i,
        );
        const rolloutId = match?.[1];
        const indexEntry = rolloutId ? indexById.get(rolloutId) : null;

        const row = parseThreadRowFromRolloutCore(fullPath, indexEntry?.thread_name || "");
        if (!row.id) {
          continue;
        }

        row.archived = bucketName === "archived_sessions" ? 1 : 0;
        row.archived_at = row.archived ? row.updated_at : null;
        row.updated_at = Math.max(row.updated_at, toUnixTimestampSecondsCore(indexEntry?.updated_at || ""));
        row.title = indexEntry?.thread_name || row.title;
        row.rollout_path = path.join(targetHome, bucketName, path.relative(root, fullPath));
        rows.push(row);
      }
    }
  }

  return rows;
}

function syncSharedThreadMetadata(sharedHome, targetHome, { scope = "recent" } = {}) {
  const result = syncSharedThreadMetadataCore(sharedHome, targetHome, { scope });
  return {
    ...result,
    scope,
  };
}

function readPlainCodexModeState() {
  return readPlainCodexModeStateFile(PLAIN_CODEX_MODE_STATE_PATH);
}

function getPlainCodexMode() {
  const state = readPlainCodexModeState();
  return state?.mode === PLAIN_CODEX_MODE_THIRD_PARTY
    ? PLAIN_CODEX_MODE_THIRD_PARTY
    : PLAIN_CODEX_MODE_OFFICIAL;
}

function setPlainCodexModeState(mode, extra = {}) {
  writePlainCodexModeState(PLAIN_CODEX_MODE_STATE_PATH, mode, extra);
}

function loadState() {
  ensureDir(MANAGER_HOME);
  ensureDir(ACCOUNTS_DIR);
  ensureDir(OFFICIAL_API_KEYS_DIR);
  ensureDir(BACKUPS_DIR);
  ensureDir(TMP_DIR);

  if (!fs.existsSync(STATE_PATH)) {
    const state = {
      schema_version: VERSION,
      active_tuple_id: null,
      tuples: {},
      official_api_key_profiles: {},
      active_official_profile: null,
    };
    writeJson(STATE_PATH, state);
    return state;
  }

  const state = readJson(STATE_PATH);
  if (typeof state !== "object" || state === null) {
    throw new Error(`Invalid state file: ${STATE_PATH}`);
  }
  if (![1, 2, VERSION].includes(state.schema_version)) {
    throw new Error(
      `Unsupported state schema_version ${state.schema_version}; expected ${VERSION}.`,
    );
  }
  if (!state.tuples || typeof state.tuples !== "object") {
    state.tuples = {};
  }
  if (!state.official_api_key_profiles || typeof state.official_api_key_profiles !== "object") {
    state.official_api_key_profiles = {};
  }
  if (!("active_tuple_id" in state)) {
    state.active_tuple_id = null;
  }
  if (!("active_official_profile" in state)) {
    state.active_official_profile = null;
  }
  let changed = false;
  for (const tuple of Object.values(state.tuples)) {
    if (tuple && typeof tuple === "object") {
      if (!tuple.login_workspace_id && tuple.account_id) {
        tuple.login_workspace_id = tuple.account_id;
        changed = true;
      }
      if (!tuple.auth_storage_key) {
        tuple.auth_storage_key = getTupleAuthStorageKey(tuple);
        changed = true;
      }
      if (!("visible_workspaces" in tuple)) {
        tuple.visible_workspaces = [];
        changed = true;
      }
    }
  }
  for (const profile of Object.values(state.official_api_key_profiles)) {
    if (profile && typeof profile === "object") {
      if (!profile.profile_id) {
        profile.profile_id = profile.auth_storage_key || profile.id || null;
        changed = true;
      }
      if (!profile.auth_storage_key && profile.profile_id) {
        profile.auth_storage_key = profile.profile_id;
        changed = true;
      }
      if (!profile.alias || !profile.alias.trim()) {
        profile.alias = "official-api-key";
        changed = true;
      }
    }
  }
  if (compactStateToSavedSnapshots(state)) {
    changed = true;
  }
  if (migrateSavedAuthCopies(state)) {
    changed = true;
  }
  if (state.schema_version < VERSION && state.active_tuple_id) {
    state.active_official_profile = {
      kind: PROFILE_KIND_CHATGPT,
      id: state.active_tuple_id,
    };
    changed = true;
  }
  if (
    state.active_official_profile &&
    (typeof state.active_official_profile !== "object" ||
      !state.active_official_profile.kind ||
      !state.active_official_profile.id)
  ) {
    state.active_official_profile = null;
    changed = true;
  }
  if (
    state.active_official_profile?.kind === PROFILE_KIND_CHATGPT &&
    !state.tuples[state.active_official_profile.id]
  ) {
    state.active_official_profile = null;
    changed = true;
  }
  if (
    state.active_official_profile?.kind === PROFILE_KIND_OFFICIAL_API_KEY &&
    !state.official_api_key_profiles[state.active_official_profile.id]
  ) {
    state.active_official_profile = null;
    changed = true;
  }
  if (
    !state.active_official_profile &&
    state.active_tuple_id &&
    state.tuples[state.active_tuple_id]
  ) {
    state.active_official_profile = {
      kind: PROFILE_KIND_CHATGPT,
      id: state.active_tuple_id,
    };
    changed = true;
  }
  if (state.schema_version !== VERSION) {
    state.schema_version = VERSION;
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

function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) {
    throw new Error("JWT token is not in the expected format.");
  }
  let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  while (payload.length % 4 !== 0) {
    payload += "=";
  }
  return JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
}

function extractAuthMeta(authData) {
  if (!authData?.tokens?.id_token) {
    throw new Error("Expected a ChatGPT auth.json with tokens.id_token.");
  }
  const payload = decodeJwtPayload(authData?.tokens?.id_token);
  const auth = payload["https://api.openai.com/auth"] || {};
  const organizations = Array.isArray(auth.organizations)
    ? auth.organizations.map((org) => ({
        id: org.id,
        title: org.title,
        is_default: Boolean(org.is_default),
        role: org.role || "",
      }))
    : [];

  return {
    account_id: auth.chatgpt_account_id,
    account_email: payload.email || "",
    account_name: payload.name || "",
    plan_type: auth.chatgpt_plan_type || "",
    login_workspace_id: auth.chatgpt_account_id,
    organizations,
  };
}

function detectAuthKind(authData) {
  if (authData?.tokens?.id_token) {
    return PROFILE_KIND_CHATGPT;
  }
  if (
    authData?.auth_mode === "apikey" ||
    (typeof authData?.OPENAI_API_KEY === "string" && authData.OPENAI_API_KEY.trim())
  ) {
    return PROFILE_KIND_OFFICIAL_API_KEY;
  }
  throw new Error("Unsupported auth.json shape.");
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

function extractOfficialApiKeyMeta(authData) {
  const apiKey = String(authData?.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("Expected an API key auth.json with OPENAI_API_KEY.");
  }
  return {
    auth_mode: "apikey",
    masked_key: maskApiKey(apiKey),
    key_hash: createHash("sha256").update(apiKey).digest("hex").slice(0, 32),
  };
}

function getTupleLoginWorkspaceId(tuple) {
  return tuple?.login_workspace_id || tuple?.account_id || null;
}

function normalizeAccountEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getMetaLoginWorkspaceId(meta) {
  return meta?.login_workspace_id || meta?.account_id || null;
}

function createSnapshotStorageKey(loginWorkspaceId, accountEmail) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        login_workspace_id: String(loginWorkspaceId || "").trim(),
        account_email: normalizeAccountEmail(accountEmail),
      }),
    )
    .digest("hex")
    .slice(0, 32);
}

function authSnapshotDir(authStorageKey) {
  return path.join(ACCOUNTS_DIR, authStorageKey);
}

function savedAuthPath(authStorageKey) {
  return path.join(authSnapshotDir(authStorageKey), "auth.json");
}

function officialApiKeyProfileDir(profileId) {
  return path.join(OFFICIAL_API_KEYS_DIR, profileId);
}

function officialApiKeyProfileAuthPath(profileId) {
  return path.join(officialApiKeyProfileDir(profileId), "auth.json");
}

function getTupleIdentityKey(tuple) {
  const loginWorkspaceId = getTupleLoginWorkspaceId(tuple);
  if (!loginWorkspaceId) {
    return null;
  }
  return JSON.stringify({
    login_workspace_id: loginWorkspaceId,
    account_email: normalizeAccountEmail(tuple?.account_email || ""),
  });
}

function getMetaIdentityKey(meta) {
  const loginWorkspaceId = getMetaLoginWorkspaceId(meta);
  if (!loginWorkspaceId) {
    return null;
  }
  return JSON.stringify({
    login_workspace_id: loginWorkspaceId,
    account_email: normalizeAccountEmail(meta?.account_email || ""),
  });
}

function getTupleAuthStorageKey(tuple) {
  if (tuple?.auth_storage_key) {
    return tuple.auth_storage_key;
  }
  const loginWorkspaceId = getTupleLoginWorkspaceId(tuple);
  if (!loginWorkspaceId) {
    return tuple?.account_id || null;
  }
  return createSnapshotStorageKey(loginWorkspaceId, tuple?.account_email || "");
}

function getMetaAuthStorageKey(meta) {
  const loginWorkspaceId = getMetaLoginWorkspaceId(meta);
  if (!loginWorkspaceId) {
    return meta?.account_id || null;
  }
  return createSnapshotStorageKey(loginWorkspaceId, meta?.account_email || "");
}

function createOfficialApiKeyStorageKey(apiKey) {
  return createHash("sha256").update(String(apiKey || "").trim()).digest("hex").slice(0, 32);
}

function normalizeOfficialApiKeyProfile(profile, profileId = null) {
  if (!profile || typeof profile !== "object") {
    return null;
  }
  const id = profile.profile_id || profile.auth_storage_key || profileId;
  if (!id) {
    return null;
  }
  return {
    ...profile,
    profile_id: id,
    auth_storage_key: profile.auth_storage_key || id,
    alias: String(profile.alias || "official-api-key"),
    created_at: profile.created_at || isoNow(),
    last_used_at: profile.last_used_at || null,
  };
}

function getOfficialApiKeyProfiles(state) {
  return Object.entries(state.official_api_key_profiles || {})
    .map(([profileId, profile]) => normalizeOfficialApiKeyProfile(profile, profileId))
    .filter(Boolean)
    .sort((left, right) => {
      const leftTs = Date.parse(left.last_used_at || left.created_at || 0) || 0;
      const rightTs = Date.parse(right.last_used_at || right.created_at || 0) || 0;
      return rightTs - leftTs;
    });
}

function getActiveOfficialProfile(state) {
  const active = state?.active_official_profile;
  if (!active?.kind || !active?.id) {
    return null;
  }
  if (active.kind === PROFILE_KIND_CHATGPT) {
    const tuple = state.tuples?.[active.id];
    return tuple ? { kind: PROFILE_KIND_CHATGPT, id: tuple.tuple_id, record: tuple } : null;
  }
  if (active.kind === PROFILE_KIND_OFFICIAL_API_KEY) {
    const profile = state.official_api_key_profiles?.[active.id];
    return profile
      ? {
          kind: PROFILE_KIND_OFFICIAL_API_KEY,
          id: active.id,
          record: normalizeOfficialApiKeyProfile(profile, active.id),
        }
      : null;
  }
  return null;
}

function isTupleCurrentlyActive(state, tupleId) {
  return (
    state?.active_official_profile?.kind === PROFILE_KIND_CHATGPT &&
    state.active_official_profile.id === tupleId
  );
}

function isOfficialApiKeyProfileActive(state, profileId) {
  return (
    state?.active_official_profile?.kind === PROFILE_KIND_OFFICIAL_API_KEY &&
    state.active_official_profile.id === profileId
  );
}

function describeOfficialApiKeyProfile(state, profile) {
  const authPath = officialApiKeyProfileAuthPath(profile.profile_id);
  let maskedKey = "(missing)";
  if (fs.existsSync(authPath)) {
    try {
      maskedKey = extractOfficialApiKeyMeta(readJson(authPath)).masked_key;
    } catch {
      maskedKey = "(invalid auth)";
    }
  }
  const activeMark = isOfficialApiKeyProfileActive(state, profile.profile_id) ? " | active" : "";
  return `${profile.alias} | ${maskedKey}${activeMark}`;
}

function requireOfficialApiKeyProfile(state, profileId) {
  const profile = normalizeOfficialApiKeyProfile(
    state.official_api_key_profiles?.[profileId],
    profileId,
  );
  if (!profile) {
    throw new Error(`Unknown official API key profile: ${profileId}`);
  }
  return profile;
}

function renameOfficialApiKeyProfileAlias(state, profileId, alias) {
  const profile = requireOfficialApiKeyProfile(state, profileId);
  profile.alias = alias;
  state.official_api_key_profiles[profile.profile_id] = profile;
  saveState(state);
  return profile;
}

function formatProfileKindLabel(kind) {
  if (!kind || kind === "(none)") {
    return "(none)";
  }
  if (kind === PROFILE_KIND_CHATGPT) {
    return "ChatGPT";
  }
  if (kind === PROFILE_KIND_OFFICIAL_API_KEY) {
    return "Official API key";
  }
  return String(kind || "unknown");
}

function parseProfileKind(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) {
    throw new Error("Profile kind is required.");
  }
  if (value === "chatgpt") {
    return PROFILE_KIND_CHATGPT;
  }
  if (
    value === "official-api-key" ||
    value === "official_api_key" ||
    value === "api-key" ||
    value === "apikey" ||
    value === "official-apikey"
  ) {
    return PROFILE_KIND_OFFICIAL_API_KEY;
  }
  throw new Error(`Unknown profile kind: ${rawValue}`);
}

function resolveOfficialProfileRef(state, recordId, explicitKind = null) {
  if (!recordId) {
    throw new Error("Profile id is required.");
  }

  if (explicitKind === PROFILE_KIND_CHATGPT) {
    const tuple = requireTuple(state, recordId);
    return { kind: PROFILE_KIND_CHATGPT, id: tuple.tuple_id, record: tuple };
  }

  if (explicitKind === PROFILE_KIND_OFFICIAL_API_KEY) {
    const profile = requireOfficialApiKeyProfile(state, recordId);
    return { kind: PROFILE_KIND_OFFICIAL_API_KEY, id: profile.profile_id, record: profile };
  }

  const tuple = state.tuples?.[recordId] || null;
  const profile = normalizeOfficialApiKeyProfile(
    state.official_api_key_profiles?.[recordId],
    recordId,
  );

  if (tuple && profile) {
    throw new Error(
      `Identifier ${recordId} exists in both ChatGPT tuples and official API key profiles. Re-run with --kind.`,
    );
  }
  if (tuple) {
    return { kind: PROFILE_KIND_CHATGPT, id: tuple.tuple_id, record: tuple };
  }
  if (profile) {
    return { kind: PROFILE_KIND_OFFICIAL_API_KEY, id: profile.profile_id, record: profile };
  }
  throw new Error(`Unknown official profile: ${recordId}`);
}

function buildOfficialApiKeyAuthData(apiKey) {
  const trimmed = String(apiKey || "").trim();
  if (!trimmed) {
    throw new Error("API key is required.");
  }
  return {
    auth_mode: "apikey",
    OPENAI_API_KEY: trimmed,
    last_refresh: null,
    tokens: null,
  };
}

function canonicalTupleIdForSnapshot(authStorageKey, loginWorkspaceId) {
  return tupleIdFor(authStorageKey, loginWorkspaceId);
}

function tupleTimestamp(tuple) {
  return Date.parse(tuple?.last_used_at || tuple?.created_at || 0) || 0;
}

function mergeVisibleWorkspaceHints(tuples) {
  const byId = new Map();

  for (const tuple of tuples) {
    const visible = Array.isArray(tuple?.visible_workspaces) ? tuple.visible_workspaces : [];
    for (const workspace of visible) {
      if (!workspace?.id || byId.has(workspace.id)) {
        continue;
      }
      byId.set(workspace.id, {
        id: workspace.id,
        title: workspace.title || "",
        is_default: Boolean(workspace.is_default),
        role: workspace.role || "",
      });
    }

    if (tuple?.workspace_id && !byId.has(tuple.workspace_id)) {
      byId.set(tuple.workspace_id, {
        id: tuple.workspace_id,
        title: tuple.workspace_title || "",
        is_default: false,
        role: tuple.workspace_role || "",
      });
    }
  }

  return Array.from(byId.values()).sort((left, right) => {
    if (Boolean(left.is_default) !== Boolean(right.is_default)) {
      return left.is_default ? -1 : 1;
    }
    return String(left.title || left.id).localeCompare(String(right.title || right.id));
  });
}

function chooseCanonicalTuple(tuples, activeTupleId) {
  return [...tuples].sort((left, right) => {
    const leftActive = left.tuple_id === activeTupleId ? 1 : 0;
    const rightActive = right.tuple_id === activeTupleId ? 1 : 0;
    if (leftActive !== rightActive) {
      return rightActive - leftActive;
    }

    const timestampDiff = tupleTimestamp(right) - tupleTimestamp(left);
    if (timestampDiff !== 0) {
      return timestampDiff;
    }

    return String(left.alias || "").localeCompare(String(right.alias || ""));
  })[0];
}

function firstNonEmptyTupleField(tuples, key, fallback = "") {
  for (const tuple of tuples) {
    const value = tuple?.[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return fallback;
}

function compactStateToSavedSnapshots(state) {
  const grouped = new Map();

  for (const tuple of Object.values(state.tuples)) {
    if (!tuple || typeof tuple !== "object") {
      continue;
    }
    const identityKey = getTupleIdentityKey(tuple);
    if (!identityKey) {
      continue;
    }
    const list = grouped.get(identityKey) || [];
    list.push(tuple);
    grouped.set(identityKey, list);
  }

  const nextTuples = {};
  let nextActiveTupleId = null;
  let changed = false;

  for (const tuples of grouped.values()) {
    const canonical = chooseCanonicalTuple(tuples, state.active_tuple_id);
    const loginWorkspaceId =
      getTupleLoginWorkspaceId(canonical) ||
      firstNonEmptyTupleField(tuples, "login_workspace_id", canonical.account_id || "");
    const accountEmail = firstNonEmptyTupleField(
      tuples,
      "account_email",
      canonical.account_email || "",
    );
    const authStorageKey = createSnapshotStorageKey(loginWorkspaceId, accountEmail);
    const canonicalTupleId = canonicalTupleIdForSnapshot(authStorageKey, loginWorkspaceId);
    const normalized = {
      ...canonical,
      tuple_id: canonicalTupleId,
      auth_storage_key: authStorageKey,
      account_id: firstNonEmptyTupleField(
        tuples,
        "account_id",
        canonical.account_id || loginWorkspaceId,
      ),
      login_workspace_id: loginWorkspaceId,
      account_email: accountEmail,
      account_name: firstNonEmptyTupleField(tuples, "account_name", canonical.account_name || ""),
      plan_type: firstNonEmptyTupleField(tuples, "plan_type", canonical.plan_type || ""),
      workspace_id: "",
      workspace_title: "",
      workspace_role: "",
      visible_workspaces: mergeVisibleWorkspaceHints(tuples),
    };

    if (!normalized.alias || !normalized.alias.trim()) {
      normalized.alias = normalized.account_email || loginWorkspaceId;
      changed = true;
    }

    nextTuples[canonicalTupleId] = normalized;

    if (
      tuples.length > 1 ||
      canonical.tuple_id !== canonicalTupleId ||
      canonical.auth_storage_key !== normalized.auth_storage_key ||
      canonical.account_id !== normalized.account_id ||
      canonical.workspace_id !== normalized.workspace_id ||
      canonical.workspace_title !== normalized.workspace_title ||
      canonical.workspace_role !== normalized.workspace_role
    ) {
      changed = true;
    }

    if (tuples.some((tuple) => tuple.tuple_id === state.active_tuple_id)) {
      nextActiveTupleId = canonicalTupleId;
    }
  }

  const previousTupleIds = Object.keys(state.tuples).sort();
  const nextTupleIds = Object.keys(nextTuples).sort();
  if (JSON.stringify(previousTupleIds) !== JSON.stringify(nextTupleIds)) {
    changed = true;
  }
  if ((state.active_tuple_id || null) !== (nextActiveTupleId || null)) {
    changed = true;
  }

  state.tuples = nextTuples;
  state.active_tuple_id = nextActiveTupleId;
  return changed;
}

function migrateSavedAuthCopies(state) {
  let changed = false;

  for (const tuple of Object.values(state.tuples)) {
    const authStorageKey = getTupleAuthStorageKey(tuple);
    if (!authStorageKey) {
      continue;
    }

    const targetPath = savedAuthPath(authStorageKey);
    if (fs.existsSync(targetPath)) {
      continue;
    }

    const legacyKeys = [tuple.account_id].filter(
      (candidate) => candidate && candidate !== authStorageKey,
    );
    for (const legacyKey of legacyKeys) {
      const legacyPath = savedAuthPath(legacyKey);
      if (!fs.existsSync(legacyPath)) {
        continue;
      }
      ensureDir(authSnapshotDir(authStorageKey));
      fs.copyFileSync(legacyPath, targetPath);
      changed = true;
      break;
    }
  }

  return changed;
}

function formatVisibleWorkspaceHints(tuple) {
  const visible = Array.isArray(tuple?.visible_workspaces) ? tuple.visible_workspaces : [];
  if (!visible.length) {
    return "";
  }

  const labels = visible
    .map((workspace) => workspace.title || workspace.id)
    .filter(Boolean);
  if (!labels.length) {
    return "";
  }
  if (labels.length <= 2) {
    return `visible orgs ${labels.join(", ")}`;
  }
  return `visible orgs ${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}

function formatTupleWorkspaceSummary(tuple) {
  const parts = [];
  const loginWorkspaceId = getTupleLoginWorkspaceId(tuple);
  if (loginWorkspaceId) {
    parts.push(`login ${loginWorkspaceId}`);
  }
  const visibleHints = formatVisibleWorkspaceHints(tuple);
  if (visibleHints) {
    parts.push(visibleHints);
  }
  return parts.join(" | ");
}

function shareSameRealLoginWorkspace(left, right) {
  return Boolean(
    left &&
      right &&
      getTupleLoginWorkspaceId(left) &&
      getTupleLoginWorkspaceId(left) === getTupleLoginWorkspaceId(right),
  );
}

function maybeWarnSameRealWorkspace(state, tuple) {
  const active = getActiveOfficialProfile(state)?.kind === PROFILE_KIND_CHATGPT
    ? getActiveOfficialProfile(state)?.record
    : null;
  if (!active || active.tuple_id === tuple.tuple_id) {
    return;
  }
  if (shareSameRealLoginWorkspace(active, tuple)) {
    console.log(
      "Selected tuple shares the same real login workspace id as the current active tuple. Re-applying it will not change backend limits by itself."
    );
  }
}

function tupleIdFor(accountId, workspaceId) {
  return `${accountId}::${workspaceId}`;
}

function getAllTuples(state) {
  return Object.values(state.tuples).sort((a, b) => {
    const aTs = Date.parse(a.last_used_at || a.created_at || 0);
    const bTs = Date.parse(b.last_used_at || b.created_at || 0);
    return bTs - aTs;
  });
}

function requireTuple(state, tupleId) {
  const tuple = state.tuples[tupleId];
  if (!tuple) {
    throw new Error(`Unknown tuple: ${tupleId}`);
  }
  return tuple;
}

function renameTupleAlias(state, tupleId, alias) {
  const tuple = requireTuple(state, tupleId);
  tuple.alias = alias;
  saveState(state);
  return tuple;
}

function createTupleFromMeta(meta, alias) {
  const loginWorkspaceId = getMetaLoginWorkspaceId(meta);
  const authStorageKey = getMetaAuthStorageKey(meta);
  return {
    tuple_id: canonicalTupleIdForSnapshot(authStorageKey, loginWorkspaceId),
    auth_storage_key: authStorageKey,
    account_id: meta.account_id,
    login_workspace_id: loginWorkspaceId,
    account_email: meta.account_email,
    account_name: meta.account_name,
    plan_type: meta.plan_type,
    workspace_id: "",
    workspace_title: "",
    workspace_role: "",
    visible_workspaces: Array.isArray(meta.organizations) ? meta.organizations : [],
    alias,
    created_at: isoNow(),
    last_used_at: null,
  };
}

function buildTomlKeyMatcher(key) {
  return new RegExp(`^\\s*${key.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&")}\\s*=`);
}

function isTomlTableHeader(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return false;
  }
  return /^\[\[?[^\]]+\]\]?$/.test(trimmed);
}

function findFirstTomlTableHeaderIndex(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    if (isTomlTableHeader(lines[index])) {
      return index;
    }
  }
  return lines.length;
}

function parseTomlKeyOccurrences(text, key) {
  const lines = text.split(/\r?\n/);
  const matcher = buildTomlKeyMatcher(key);
  const indexes = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trimStart().startsWith("#")) {
      continue;
    }
    if (matcher.test(line)) {
      indexes.push(index);
    }
  }
  return { lines, indexes };
}

function parseTomlTopLevelKeys(text, key) {
  const { lines, indexes: allIndexes } = parseTomlKeyOccurrences(text, key);
  const firstTableIndex = findFirstTomlTableHeaderIndex(lines);
  const indexes = allIndexes.filter((index) => index < firstTableIndex);
  const misplacedIndexes = allIndexes.filter((index) => index >= firstTableIndex);
  if (indexes.length > 1) {
    throw new Error(
      `Duplicate top-level config keys detected for ${key}. Fix the file, then rerun 'codex_m doctor'.`,
    );
  }
  return { lines, indexes, misplacedIndexes, firstTableIndex };
}

function stripManagedTomlEntries(text, keys) {
  const matchers = keys.map((key) => buildTomlKeyMatcher(key));
  const lines = text.split(/\r?\n/);
  const kept = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "# codex_m managed") {
      continue;
    }
    if (!line.trimStart().startsWith("#") && matchers.some((matcher) => matcher.test(line))) {
      continue;
    }
    kept.push(line);
  }

  while (kept.length && kept[kept.length - 1] === "") {
    kept.pop();
  }

  return kept.join("\n");
}

function writeManagedTopLevelTomlKeys(text, entries) {
  const keys = Object.keys(entries);
  const cleanedText = stripManagedTomlEntries(text, keys);
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
    "# codex_m managed",
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

function readConfigText(configPath) {
  ensureDir(path.dirname(configPath));
  if (!fs.existsSync(configPath)) {
    return "";
  }
  return fs.readFileSync(configPath, "utf8");
}

function readOfficialConfigText() {
  return readConfigText(OFFICIAL_CONFIG_PATH);
}

function readOfficialCliConfigText() {
  return readConfigText(OFFICIAL_CLI_CONFIG_PATH);
}

function readOfficialCliConfigSeedText() {
  const existing = readOfficialCliConfigText();
  if (existing.trim()) {
    return existing;
  }
  if (pathExists(OFFICIAL_CONFIG_PATH) && getPlainCodexMode() === PLAIN_CODEX_MODE_OFFICIAL) {
    return readOfficialConfigText();
  }
  return "";
}

function getCurrentWorkspaceRestriction(text) {
  const { lines, indexes } = parseTomlTopLevelKeys(text, "forced_chatgpt_workspace_id");
  if (indexes.length !== 1) {
    return null;
  }
  const match = lines[indexes[0]].match(/=\s*"(.*)"\s*$/);
  return match ? match[1] : null;
}

function applyManagedConfigToHome(configPath, workspaceId) {
  ensureDir(path.dirname(configPath));
  backupFileIfExists(configPath, path.basename(configPath) + ".bak");

  const text = writeManagedTopLevelTomlKeys(
    readConfigText(configPath),
    {
      ...MANAGED_CONFIG_KEYS,
      forced_chatgpt_workspace_id: JSON.stringify(workspaceId),
    },
  );
  writeText(configPath, text);
}

function removeManagedWorkspaceRestrictionFromHome(configPath) {
  ensureDir(path.dirname(configPath));
  const updated = writeManagedTopLevelTomlKeys(readConfigText(configPath), MANAGED_CONFIG_KEYS);
  writeText(configPath, updated);
}

function applyManagedConfig(workspaceId) {
  applyManagedConfigToHome(OFFICIAL_CONFIG_PATH, workspaceId);
}

function applyManagedConfigToOfficialCliHome(workspaceId) {
  ensureOfficialCliHomeLayout();
  ensureDir(path.dirname(OFFICIAL_CLI_CONFIG_PATH));
  backupFileIfExists(OFFICIAL_CLI_CONFIG_PATH, path.basename(OFFICIAL_CLI_CONFIG_PATH) + ".bak");
  const text = writeManagedTopLevelTomlKeys(readOfficialCliConfigSeedText(), {
    ...MANAGED_CONFIG_KEYS,
    forced_chatgpt_workspace_id: JSON.stringify(workspaceId),
  });
  writeText(OFFICIAL_CLI_CONFIG_PATH, text);
}

function removeManagedWorkspaceRestriction() {
  removeManagedWorkspaceRestrictionFromHome(OFFICIAL_CONFIG_PATH);
}

function removeManagedWorkspaceRestrictionFromOfficialCliHome() {
  ensureOfficialCliHomeLayout();
  ensureDir(path.dirname(OFFICIAL_CLI_CONFIG_PATH));
  const updated = writeManagedTopLevelTomlKeys(readOfficialCliConfigSeedText(), MANAGED_CONFIG_KEYS);
  writeText(OFFICIAL_CLI_CONFIG_PATH, updated);
}

function detectRunningCodexProcesses() {
  return detectRunningCodexProcessesCore({
    excludePattern: "(?i)codex-manager",
  });
}

function formatProcessSummary(processes) {
  return formatProcessSummaryCore(processes);
}

function assertNoRunningCodexProcesses() {
  return assertNoRunningCodexProcessesCore({
    excludePattern: "(?i)codex-manager",
  });
}

function saveAccountAuth(accountId, authData) {
  ensureDir(authSnapshotDir(accountId));
  writeJson(savedAuthPath(accountId), authData);
}

function saveOfficialApiKeyProfileAuth(profileId, authData) {
  ensureDir(officialApiKeyProfileDir(profileId));
  writeJson(officialApiKeyProfileAuthPath(profileId), authData);
}

function copyFileBackedAuthToPath(sourcePath, destinationPath, missingMessage) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(missingMessage);
  }
  ensureDir(path.dirname(destinationPath));
  backupFileIfExists(destinationPath, path.basename(destinationPath) + ".bak");
  fs.copyFileSync(sourcePath, destinationPath);
}

function copySavedAuthToOfficial(accountId) {
  copyFileBackedAuthToPath(
    savedAuthPath(accountId),
    OFFICIAL_AUTH_PATH,
    `Saved auth is missing for account ${accountId}`,
  );
}

function copySavedAuthToOfficialCliHome(accountId) {
  ensureOfficialCliHomeLayout();
  copyFileBackedAuthToPath(
    savedAuthPath(accountId),
    OFFICIAL_CLI_AUTH_PATH,
    `Saved auth is missing for account ${accountId}`,
  );
}

function copyOfficialApiKeyProfileToOfficial(profileId) {
  copyFileBackedAuthToPath(
    officialApiKeyProfileAuthPath(profileId),
    OFFICIAL_AUTH_PATH,
    `Official API key auth is missing for profile ${profileId}`,
  );
}

function copyOfficialApiKeyProfileToOfficialCliHome(profileId) {
  ensureOfficialCliHomeLayout();
  copyFileBackedAuthToPath(
    officialApiKeyProfileAuthPath(profileId),
    OFFICIAL_CLI_AUTH_PATH,
    `Official API key auth is missing for profile ${profileId}`,
  );
}

function deleteOfficialAuthIfPresent() {
  if (fs.existsSync(OFFICIAL_AUTH_PATH)) {
    backupFileIfExists(OFFICIAL_AUTH_PATH, "auth.json.bak");
    fs.rmSync(OFFICIAL_AUTH_PATH, { force: true });
  }
}

function applyOfficialProfileRefToDesktopHome(state, profileRef) {
  if (profileRef.kind === PROFILE_KIND_CHATGPT) {
    const tuple = requireTuple(state, profileRef.id);
    copySavedAuthToOfficial(getTupleAuthStorageKey(tuple));
    applyManagedConfig(getTupleLoginWorkspaceId(tuple));
    return;
  }

  if (profileRef.kind === PROFILE_KIND_OFFICIAL_API_KEY) {
    const profile = requireOfficialApiKeyProfile(state, profileRef.id);
    copyOfficialApiKeyProfileToOfficial(profile.profile_id);
    removeManagedWorkspaceRestriction();
    return;
  }

  throw new Error(`Unknown official profile kind: ${profileRef.kind}`);
}

async function activateTuple(state, tupleId, { silent = false, skipProcessCheck = false } = {}) {
  const tuple = requireTuple(state, tupleId);
  if (!skipProcessCheck) {
    assertNoRunningCodexProcesses();
  }
  copySavedAuthToOfficialCliHome(getTupleAuthStorageKey(tuple));
  applyManagedConfigToOfficialCliHome(getTupleLoginWorkspaceId(tuple));
  if (getPlainCodexMode() === PLAIN_CODEX_MODE_OFFICIAL) {
    applyOfficialProfileRefToDesktopHome(state, {
      kind: PROFILE_KIND_CHATGPT,
      id: tupleId,
    });
  }
  try {
    syncManagedThreadMetadata({ scope: "recent" });
  } catch (error) {
    if (!silent) {
      console.warn(`Warning: failed to sync recent shared threads: ${error.message}`);
    }
  }
  tuple.last_used_at = isoNow();
  state.active_tuple_id = tupleId;
  state.active_official_profile = {
    kind: PROFILE_KIND_CHATGPT,
    id: tupleId,
  };
  saveState(state);
  if (!silent) {
    console.log(
      `Applied local tuple: ${tuple.alias} | account ${tuple.account_email} | login workspace ${getTupleLoginWorkspaceId(tuple)}`
    );
    if (skipProcessCheck) {
      console.log(
        "Heads-up: other running Codex windows may still use their old in-memory workspace until you restart them."
      );
    }
  }
}

async function activateOfficialApiKeyProfile(
  state,
  profileId,
  { silent = false, skipProcessCheck = false } = {},
) {
  const profile = normalizeOfficialApiKeyProfile(
    state.official_api_key_profiles?.[profileId],
    profileId,
  );
  if (!profile) {
    throw new Error(`Unknown official API key profile: ${profileId}`);
  }
  if (!skipProcessCheck) {
    assertNoRunningCodexProcesses();
  }
  copyOfficialApiKeyProfileToOfficialCliHome(profile.profile_id);
  removeManagedWorkspaceRestrictionFromOfficialCliHome();
  if (getPlainCodexMode() === PLAIN_CODEX_MODE_OFFICIAL) {
    applyOfficialProfileRefToDesktopHome(state, {
      kind: PROFILE_KIND_OFFICIAL_API_KEY,
      id: profile.profile_id,
    });
  }
  try {
    syncManagedThreadMetadata({ scope: "recent" });
  } catch (error) {
    if (!silent) {
      console.warn(`Warning: failed to sync recent shared threads: ${error.message}`);
    }
  }
  profile.last_used_at = isoNow();
  state.official_api_key_profiles[profile.profile_id] = profile;
  state.active_tuple_id = null;
  state.active_official_profile = {
    kind: PROFILE_KIND_OFFICIAL_API_KEY,
    id: profile.profile_id,
  };
  saveState(state);
  if (!silent) {
    console.log(`Applied official API key profile: ${describeOfficialApiKeyProfile(state, profile)}`);
    if (skipProcessCheck) {
      console.log(
        "Heads-up: other running Codex windows may still use their old in-memory auth until you restart them."
      );
    }
  }
}

async function activateOfficialProfileRef(
  state,
  profileRef,
  { silent = false, skipProcessCheck = false } = {},
) {
  if (profileRef.kind === PROFILE_KIND_CHATGPT) {
    await activateTuple(state, profileRef.id, { silent, skipProcessCheck });
    return;
  }
  await activateOfficialApiKeyProfile(state, profileRef.id, { silent, skipProcessCheck });
}

async function setPlainCodexOfficialMode(
  state,
  { silent = false, skipProcessCheck = false } = {},
) {
  if (!skipProcessCheck) {
    assertNoRunningCodexProcesses();
  }

  const activeProfile = getActiveOfficialProfile(state);
  ensureOfficialCliHomeLayout();
  syncDesktopHomeFromSource({
    sourceHome: OFFICIAL_CLI_HOME,
    desktopHome: OFFICIAL_HOME,
    label: "Official CLI home",
  });

  if (activeProfile) {
    try {
      syncManagedThreadMetadata({ scope: "recent" });
    } catch (error) {
      if (!silent) {
        console.warn(`Warning: failed to sync recent shared threads: ${error.message}`);
      }
    }
  } else {
    try {
      syncManagedThreadMetadata({ scope: "recent" });
    } catch (error) {
      if (!silent) {
        console.warn(`Warning: failed to sync recent shared threads: ${error.message}`);
      }
    }
  }

  setPlainCodexModeState(PLAIN_CODEX_MODE_OFFICIAL, {
    source: "codex_m",
    active_official_kind: activeProfile?.kind || null,
    active_official_id: activeProfile?.id || null,
  });

  if (!silent) {
    console.log("codex.exe now makes Desktop follow the official lane managed by codex_m.");
    if (activeProfile) {
      console.log(`Restored official profile: ${getActiveOfficialProfileLabel(state)}`);
    } else {
      console.log("Restored Desktop auth/config from ~/.codex-official.");
    }
    if (skipProcessCheck) {
      console.log(
        "Heads-up: other running Codex windows may still use their old in-memory auth until you restart them.",
      );
    }
  }
}

function removeTupleAndMaybeAccount(state, tupleId) {
  const tuple = requireTuple(state, tupleId);
  delete state.tuples[tupleId];

  const hasRemainingForAccount = Object.values(state.tuples).some(
    (item) => getTupleAuthStorageKey(item) === getTupleAuthStorageKey(tuple),
  );
  if (!hasRemainingForAccount) {
    const dirPath = authSnapshotDir(getTupleAuthStorageKey(tuple));
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  }
}

function removeOfficialApiKeyProfile(state, profileId) {
  const profile = normalizeOfficialApiKeyProfile(
    state.official_api_key_profiles?.[profileId],
    profileId,
  );
  if (!profile) {
    throw new Error(`Unknown official API key profile: ${profileId}`);
  }
  delete state.official_api_key_profiles[profile.profile_id];
  const dirPath = officialApiKeyProfileDir(profile.profile_id);
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
  return profile;
}

function getAllOfficialProfileRefs(state) {
  const tupleRefs = getAllTuples(state).map((tuple) => ({
    kind: PROFILE_KIND_CHATGPT,
    id: tuple.tuple_id,
    alias: tuple.alias,
    created_at: tuple.created_at,
    last_used_at: tuple.last_used_at || null,
  }));
  const apiKeyRefs = getOfficialApiKeyProfiles(state).map((profile) => ({
    kind: PROFILE_KIND_OFFICIAL_API_KEY,
    id: profile.profile_id,
    alias: profile.alias,
    created_at: profile.created_at,
    last_used_at: profile.last_used_at || null,
  }));
  return [...tupleRefs, ...apiKeyRefs].sort((left, right) => {
    const leftTs = Date.parse(left.last_used_at || left.created_at || 0) || 0;
    const rightTs = Date.parse(right.last_used_at || right.created_at || 0) || 0;
    return rightTs - leftTs;
  });
}

async function deleteTuple(state, tupleId, { silent = false, skipProcessCheck = false } = {}) {
  const tuple = requireTuple(state, tupleId);
  const isActive = isTupleCurrentlyActive(state, tupleId);
  if (isActive && !skipProcessCheck) {
    assertNoRunningCodexProcesses();
  }

  removeTupleAndMaybeAccount(state, tupleId);

  if (isActive) {
    const remaining = getAllOfficialProfileRefs(state);
    if (remaining.length) {
      state.active_tuple_id = null;
      state.active_official_profile = null;
      saveState(state);
      await activateOfficialProfileRef(state, remaining[0], {
        silent: true,
        skipProcessCheck,
      });
    } else {
      state.active_tuple_id = null;
      state.active_official_profile = null;
      deleteOfficialAuthIfPresent();
      removeManagedWorkspaceRestriction();
      saveState(state);
    }
  } else {
    saveState(state);
  }

  if (!silent) {
    console.log(`Deleted tuple: ${tuple.alias}`);
  }
}

async function deleteOfficialApiKeyProfile(
  state,
  profileId,
  { silent = false, skipProcessCheck = false } = {},
) {
  const profile = normalizeOfficialApiKeyProfile(
    state.official_api_key_profiles?.[profileId],
    profileId,
  );
  if (!profile) {
    throw new Error(`Unknown official API key profile: ${profileId}`);
  }
  const isActive = isOfficialApiKeyProfileActive(state, profile.profile_id);
  if (isActive && !skipProcessCheck) {
    assertNoRunningCodexProcesses();
  }

  removeOfficialApiKeyProfile(state, profile.profile_id);

  if (isActive) {
    const remaining = getAllOfficialProfileRefs(state);
    if (remaining.length) {
      state.active_tuple_id = null;
      state.active_official_profile = null;
      saveState(state);
      await activateOfficialProfileRef(state, remaining[0], {
        silent: true,
        skipProcessCheck,
      });
    } else {
      state.active_tuple_id = null;
      state.active_official_profile = null;
      deleteOfficialAuthIfPresent();
      removeManagedWorkspaceRestriction();
      saveState(state);
    }
  } else {
    saveState(state);
  }

  if (!silent) {
    console.log(`Deleted official API key profile: ${profile.alias}`);
  }
}

function getOfficialAuthAccountId() {
  if (!fs.existsSync(OFFICIAL_CLI_AUTH_PATH)) {
    return null;
  }
  try {
    const authData = readJson(OFFICIAL_CLI_AUTH_PATH);
    if (detectAuthKind(authData) !== PROFILE_KIND_CHATGPT) {
      return null;
    }
    return extractAuthMeta(authData).account_id || null;
  } catch {
    return null;
  }
}

function getOfficialAuthKind() {
  if (!fs.existsSync(OFFICIAL_CLI_AUTH_PATH)) {
    return null;
  }
  try {
    return detectAuthKind(readJson(OFFICIAL_CLI_AUTH_PATH));
  } catch {
    return null;
  }
}

function getDesktopAuthKind() {
  if (!fs.existsSync(OFFICIAL_AUTH_PATH)) {
    return null;
  }
  try {
    return detectAuthKind(readJson(OFFICIAL_AUTH_PATH));
  } catch {
    return null;
  }
}

function doctorReport(state) {
  const issues = [];
  const warnings = [];
  const activeProfile = getActiveOfficialProfile(state);

  if (!fs.existsSync(path.join(LAUNCHER_DIR, "codex_m.cmd"))) {
    issues.push("Launcher missing: %APPDATA%\\npm\\codex_m.cmd");
  }
  if (!fs.existsSync(path.join(LAUNCHER_DIR, "codex_m.ps1"))) {
    issues.push("Launcher missing: %APPDATA%\\npm\\codex_m.ps1");
  }
  if (!fs.existsSync(path.join(LAUNCHER_DIR, "codex.cmd"))) {
    issues.push("Launcher missing: %APPDATA%\\npm\\codex.cmd");
  }
  if (!fs.existsSync(path.join(LAUNCHER_DIR, "codex.ps1"))) {
    issues.push("Launcher missing: %APPDATA%\\npm\\codex.ps1");
  } else {
    const codexPs1Text = readText(path.join(LAUNCHER_DIR, "codex.ps1"));
    if (!codexPs1Text.includes("codex_m managed official codex CLI wrapper")) {
      issues.push("codex.ps1 is not the managed official CLI wrapper.");
    }
    if (!codexPs1Text.includes("CODEX_HOME") || !codexPs1Text.includes(OFFICIAL_CLI_HOME)) {
      issues.push(`codex.ps1 does not pin CODEX_HOME to ${OFFICIAL_CLI_HOME}.`);
    }
    if (
      !codexPs1Text.includes('model_provider="openai"') ||
      !codexPs1Text.includes('cli_auth_credentials_store="file"')
    ) {
      issues.push(
        "codex.ps1 does not inject the managed official provider/auth overrides for plain codex launches.",
      );
    }
    if (
      !codexPs1Text.includes("Remove-Item Env:OPENAI_API_KEY") ||
      !codexPs1Text.includes("Remove-Item Env:OPENAI_BASE_URL")
    ) {
      issues.push("codex.ps1 does not clear OPENAI_* environment overrides before launching Codex.");
    }
  }
  if (fs.existsSync(path.join(LAUNCHER_DIR, "codex.cmd"))) {
    const codexCmdText = readText(path.join(LAUNCHER_DIR, "codex.cmd"));
    if (
      !codexCmdText.includes("codex.ps1") ||
      !codexCmdText.includes("ExecutionPolicy Bypass")
    ) {
      issues.push("codex.cmd does not delegate to the managed codex.ps1 wrapper.");
    }
  }

  if (process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).trim()) {
    warnings.push(
      "OPENAI_API_KEY is set in the current environment. That can override file-backed official profile switching.",
    );
  }

  for (const tuple of Object.values(state.tuples)) {
    const authPath = savedAuthPath(getTupleAuthStorageKey(tuple));
    if (!fs.existsSync(authPath)) {
      issues.push(`Saved auth missing for tuple ${tuple.tuple_id}`);
      continue;
    }
    try {
      if (detectAuthKind(readJson(authPath)) !== PROFILE_KIND_CHATGPT) {
        issues.push(`Saved auth for tuple ${tuple.tuple_id} is not a ChatGPT auth snapshot.`);
      }
    } catch (error) {
      issues.push(`Saved auth for tuple ${tuple.tuple_id} is invalid: ${error.message || error}`);
    }
  }

  for (const profile of getOfficialApiKeyProfiles(state)) {
    const authPath = officialApiKeyProfileAuthPath(profile.profile_id);
    if (!fs.existsSync(authPath)) {
      issues.push(`Saved auth missing for official API key profile ${profile.profile_id}`);
      continue;
    }
    try {
      if (detectAuthKind(readJson(authPath)) !== PROFILE_KIND_OFFICIAL_API_KEY) {
        issues.push(
          `Saved auth for official API key profile ${profile.profile_id} is not an API key auth snapshot.`,
        );
      }
    } catch (error) {
      issues.push(
        `Saved auth for official API key profile ${profile.profile_id} is invalid: ${error.message || error}`,
      );
    }
  }

  const tuplesByIdentity = new Map();
  for (const tuple of Object.values(state.tuples)) {
    const identityKey = getTupleIdentityKey(tuple);
    if (!identityKey) {
      continue;
    }
    const existing = tuplesByIdentity.get(identityKey) || [];
    existing.push(tuple.tuple_id);
    tuplesByIdentity.set(identityKey, existing);
  }
  for (const [identityKey, tupleIds] of tuplesByIdentity.entries()) {
    if (tupleIds.length > 1) {
      const parsed = JSON.parse(identityKey);
      issues.push(
        `Multiple saved tuples share the same saved snapshot identity (${parsed.account_email || "(unknown email)"} | ${parsed.login_workspace_id}): ${tupleIds.join(", ")}`,
      );
    }
  }

  const configText = readOfficialCliConfigText();
  try {
    const forcedWorkspaceKeys = parseTomlTopLevelKeys(
      configText,
      "forced_chatgpt_workspace_id",
    );
    const authStoreKeys = parseTomlTopLevelKeys(configText, "cli_auth_credentials_store");
    if (forcedWorkspaceKeys.misplacedIndexes.length) {
      issues.push(
        "Official config contains forced_chatgpt_workspace_id outside the TOML top-level section, so Codex will ignore it.",
      );
    }
    if (authStoreKeys.misplacedIndexes.length) {
      issues.push(
        "Official config contains cli_auth_credentials_store outside the TOML top-level section, so Codex will ignore it.",
      );
    }
    if (authStoreKeys.indexes.length === 0) {
      issues.push("Official config does not contain top-level cli_auth_credentials_store.");
    }
  } catch (error) {
    issues.push(String(error.message || error));
  }

  const officialAuthKind = getOfficialAuthKind();
  const officialAccountId = getOfficialAuthAccountId();
  const currentWorkspaceId = getCurrentWorkspaceRestriction(configText);
  const plainCodexMode = getPlainCodexMode();

  if (
    state.active_tuple_id &&
    activeProfile?.kind !== PROFILE_KIND_CHATGPT
  ) {
    issues.push("active_tuple_id should be null unless the active official profile is ChatGPT.");
  }

  if (plainCodexMode === PLAIN_CODEX_MODE_THIRD_PARTY) {
    warnings.push(
      "Desktop is intentionally following the third-party lane right now, so official Desktop auth/config drift checks are relaxed until you run 'codex_m use-codex'.",
    );
  } else if (activeProfile?.kind === PROFILE_KIND_CHATGPT) {
    const activeTuple = activeProfile.record;
    if (officialAuthKind !== PROFILE_KIND_CHATGPT) {
      issues.push("Active official profile is ChatGPT, but ~/.codex/auth.json is not ChatGPT auth.");
    }
    if (officialAccountId && officialAccountId !== getTupleLoginWorkspaceId(activeTuple)) {
      issues.push(
        `Official auth account (${officialAccountId}) does not match active ChatGPT tuple login workspace (${getTupleLoginWorkspaceId(activeTuple)}).`,
      );
    }
    if (!currentWorkspaceId) {
      issues.push("Official config does not contain forced_chatgpt_workspace_id for the active ChatGPT tuple.");
    } else if (currentWorkspaceId !== getTupleLoginWorkspaceId(activeTuple)) {
      issues.push(
        `Official workspace restriction (${currentWorkspaceId}) does not match active ChatGPT tuple login workspace (${getTupleLoginWorkspaceId(activeTuple)}).`,
      );
    }
  } else if (activeProfile?.kind === PROFILE_KIND_OFFICIAL_API_KEY) {
    if (officialAuthKind !== PROFILE_KIND_OFFICIAL_API_KEY) {
      issues.push(
        "Active official profile is an API key profile, but ~/.codex/auth.json is not API key auth.",
      );
    }
    if (currentWorkspaceId) {
      issues.push(
        "Official API key profile is active, but forced_chatgpt_workspace_id is still present in ~/.codex/config.toml.",
      );
    }
  } else if (currentWorkspaceId && officialAuthKind !== PROFILE_KIND_CHATGPT) {
    warnings.push(
      "forced_chatgpt_workspace_id is still present while no ChatGPT tuple is marked active.",
    );
  }

  return { issues, warnings };
}

function latestMetaForTuple(tuple) {
  return extractAuthMeta(readJson(savedAuthPath(getTupleAuthStorageKey(tuple))));
}

function summarizeState(state) {
  const activeProfile = getActiveOfficialProfile(state);
  return {
    chatgpt_tuple_count: getAllTuples(state).length,
    official_api_key_profile_count: getOfficialApiKeyProfiles(state).length,
    active_tuple_id: state.active_tuple_id,
    active_official_profile: activeProfile
      ? {
          kind: activeProfile.kind,
          id: activeProfile.id,
          label: getActiveOfficialProfileLabel(state),
        }
      : null,
    tuples: getAllTuples(state).map((tuple) => ({
      tuple_id: tuple.tuple_id,
      alias: tuple.alias,
      account_email: tuple.account_email,
      account_name: tuple.account_name,
      login_workspace_id: getTupleLoginWorkspaceId(tuple),
      visible_workspace_count: Array.isArray(tuple.visible_workspaces)
        ? tuple.visible_workspaces.length
        : 0,
      is_active: isTupleCurrentlyActive(state, tuple.tuple_id),
      created_at: tuple.created_at,
      last_used_at: tuple.last_used_at || null,
    })),
    official_api_key_profiles: getOfficialApiKeyProfiles(state).map((profile) => ({
      profile_id: profile.profile_id,
      alias: profile.alias,
      masked_key: (() => {
        try {
          return extractOfficialApiKeyMeta(
            readJson(officialApiKeyProfileAuthPath(profile.profile_id)),
          ).masked_key;
        } catch {
          return "(invalid auth)";
        }
      })(),
      is_active: isOfficialApiKeyProfileActive(state, profile.profile_id),
      created_at: profile.created_at,
      last_used_at: profile.last_used_at || null,
    })),
  };
}

function summarizeAccounts(state) {
  const seen = new Map();
  for (const tuple of getAllTuples(state)) {
    if (!seen.has(tuple.account_id)) {
      seen.set(tuple.account_id, {
        account_id: tuple.account_id,
        account_email: tuple.account_email,
        account_name: tuple.account_name,
      });
    }
  }
  return Array.from(seen.values());
}

function getActiveOfficialProfileLabel(state) {
  const active = getActiveOfficialProfile(state);
  if (!active) {
    return "(none)";
  }
  if (active.kind === PROFILE_KIND_CHATGPT) {
    return `${active.record.alias} | ChatGPT | ${getTupleLoginWorkspaceId(active.record)}`;
  }
  const profile = active.record;
  let maskedKey = "(missing)";
  try {
    maskedKey = extractOfficialApiKeyMeta(
      readJson(officialApiKeyProfileAuthPath(profile.profile_id)),
    ).masked_key;
  } catch {
    maskedKey = "(invalid auth)";
  }
  return `${profile.alias} | Official API key | ${maskedKey}`;
}

async function promptLine(question) {
  return promptLineCore(question);
}

async function promptRequired(question, errorLabel) {
  return promptRequiredCore(question, errorLabel);
}

async function promptYesNo(question, defaultValue = false) {
  return promptYesNoCore(question, defaultValue);
}

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function printTupleSummary(state) {
  const tuples = getAllTuples(state);
  const apiKeyProfiles = getOfficialApiKeyProfiles(state);
  const activeId = state.active_tuple_id;
  const currentWorkspace = getCurrentWorkspaceRestriction(readOfficialCliConfigText());
  const officialAccountId = getOfficialAuthAccountId();
  const officialAuthKind = getOfficialAuthKind();

  console.log("Official ChatGPT snapshots:");
  if (!tuples.length) {
    console.log("  (none)");
  } else {
    tuples.forEach((tuple, index) => {
      const marks = [
        tuple.tuple_id === activeId ? "*" : " ",
        getTupleLoginWorkspaceId(tuple) === currentWorkspace ? "@" : " ",
        tuple.account_id === officialAccountId ? "#" : " ",
      ].join("");
      console.log(
        `${String(index + 1).padStart(2, " ")} ${marks} ${tuple.alias} | ${tuple.account_email} | ${formatTupleWorkspaceSummary(tuple)}`,
      );
      console.log(`   tuple_id: ${tuple.tuple_id}`);
    });
  }

  console.log("");
  console.log("Official API key profiles:");
  if (!apiKeyProfiles.length) {
    console.log("  (none)");
  } else {
    apiKeyProfiles.forEach((profile, index) => {
      const marks = [
        isOfficialApiKeyProfileActive(state, profile.profile_id) ? "*" : " ",
        " ",
        officialAuthKind === PROFILE_KIND_OFFICIAL_API_KEY &&
        isOfficialApiKeyProfileActive(state, profile.profile_id)
          ? "#"
          : " ",
      ].join("");
      console.log(
        `${String(index + 1).padStart(2, " ")} ${marks} ${describeOfficialApiKeyProfile(state, profile)}`,
      );
      console.log(`   profile_id: ${profile.profile_id}`);
    });
  }

  console.log("");
  console.log("* active official profile in manager state");
  console.log("@ forced ChatGPT login workspace currently set in ~/.codex/config.toml");
  console.log("# auth currently stored in ~/.codex/auth.json");
}

function printOverview(state) {
  const tuples = getAllTuples(state);
  const currentWorkspace = getCurrentWorkspaceRestriction(readOfficialCliConfigText());
  const processes = detectRunningCodexProcesses();
  const officialAuthKind = getOfficialAuthKind();
  const desktopAuthKind = getDesktopAuthKind();
  const plainCodexMode = getPlainCodexMode();

  console.log("codex_m");
  console.log("");
  console.log(`Saved ChatGPT snapshots: ${tuples.length}`);
  console.log(`Saved official API keys: ${getOfficialApiKeyProfiles(state).length}`);
  console.log(`Active official profile: ${getActiveOfficialProfileLabel(state)}`);
  console.log(`Desktop follow mode: ${plainCodexMode}`);
  console.log(`codex CLI auth kind: ${formatProfileKindLabel(officialAuthKind || "(none)")}`);
  console.log(`Desktop auth kind: ${formatProfileKindLabel(desktopAuthKind || "(none)")}`);
  console.log(`Forced login workspace: ${currentWorkspace || "(not set)"}`);
  console.log(
    `Running Codex CLI processes: ${processes.length ? formatProcessSummary(processes) : "none"}`,
  );
  console.log("");
  printTupleSummary(state);
  console.log("");
  console.log("Commands:");
  console.log("  codex_m switch");
  console.log("  codex_m login");
  console.log("  codex_m add-api-key");
  console.log("  codex_m logout");
  console.log("  codex_m list [--kind chatgpt|official-api-key|all]");
  console.log("  codex_m workspaces [--account-id <id>] [--tuple-id <tuple-id>] [--json]");
  console.log("  codex_m capture");
  console.log("  codex_m import-current [--kind chatgpt|official-api-key]");
  console.log("  codex_m add-workspace");
  console.log("  codex_m activate [--kind chatgpt|official-api-key] <id> [--force]");
  console.log("  codex_m use-codex");
  console.log("  codex_m rename [--kind chatgpt|official-api-key] <id> --alias <manual-name>");
  console.log("  codex_m delete [--kind chatgpt|official-api-key] <id> [--force]");
  console.log("  codex_m doctor");
}

function printDivider() {
  console.log("");
  console.log("------------------------------------------------------------");
  console.log("");
}

class PageSelectPrompt extends Select {
  async left() {
    return this.up();
  }

  async right() {
    return this.down();
  }
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
    if (!choice || choice.role === "heading" || choice.name === "__back__") {
      return this.alert();
    }
    this.manageSubmitMode = "menu";
    return this.submit();
  }

  async submit() {
    if (this.manageSubmitMode === "menu") {
      const choice = this.focused;
      if (!choice || choice.role === "heading") {
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

function getWizardSummaryLines(state) {
  const currentWorkspace = getCurrentWorkspaceRestriction(readOfficialCliConfigText());
  const processes = detectRunningCodexProcesses();
  return [
    "codex_m",
    `Active: ${getActiveOfficialProfileLabel(state)}`,
    `Forced login workspace: ${currentWorkspace || "(not set)"}`,
    `Saved ChatGPT snapshots: ${getAllTuples(state).length}`,
    `Saved official API keys: ${getOfficialApiKeyProfiles(state).length}`,
    `Running Codex CLI: ${processes.length ? formatProcessSummary(processes) : "none"}`,
  ];
}

function buildWizardHeader(state, title, description, extraLines = []) {
  return [
    ...getWizardSummaryLines(state),
    "",
    title,
    description,
    ...extraLines,
  ].join("\n");
}

async function runPrompt(prompt) {
  return runPromptCore(prompt);
}

async function selectChoice({
  title,
  description,
  choices,
  state = loadState(),
  useLeftRight = false,
  initial = 0,
  promptClass = null,
  extraLines = null,
}) {
  const PromptClass = promptClass || (useLeftRight ? PageSelectPrompt : Select);
  return runPrompt(
    new PromptClass({
      name: "value",
      message: `${title}`,
      initial,
      header: buildWizardHeader(
        state,
        title,
        description,
        extraLines ||
          (useLeftRight
            ? ["Keys: Left/Right switch pages | Up/Down also work | Enter open | Esc exit/back"]
            : ["Keys: Up/Down move | Enter confirm | Esc back"]),
      ),
      footer: "",
      choices,
    }),
  );
}

async function promptInputPrompt(message, initial = "") {
  return promptInputPromptCore(message, initial);
}

async function promptSecretPrompt(message) {
  return promptSecretPromptCore(message);
}

async function promptConfirmPrompt(message, initial = false) {
  return promptConfirmPromptCore(message, initial);
}

function parseOptionValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parseProfileKindOption(args, index, flag) {
  return parseProfileKind(parseOptionValue(args, index, flag));
}

async function chooseWorkspace(meta, desiredWorkspaceId = null) {
  if (!meta.organizations.length) {
    throw new Error("The login token does not expose any ChatGPT workspaces.");
  }

  if (desiredWorkspaceId) {
    const match = meta.organizations.find((item) => item.id === desiredWorkspaceId);
    if (!match) {
      throw new Error(`Workspace ${desiredWorkspaceId} is not visible in this login.`);
    }
    return match;
  }

  if (meta.organizations.length === 1) {
    return meta.organizations[0];
  }

  console.log("Available workspaces:");
  meta.organizations.forEach((workspace, index) => {
    const defaultMark = workspace.is_default ? " default" : "";
    console.log(
      `  ${index + 1}. ${workspace.title} | ${workspace.id} | ${workspace.role || "unknown"}${defaultMark}`,
    );
  });

  const answer = await promptRequired(
    "Choose workspace number: ",
    "Workspace selection is required.",
  );
  const parsed = Number(answer);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > meta.organizations.length) {
    throw new Error("Invalid workspace selection.");
  }
  return meta.organizations[parsed - 1];
}

async function chooseTuple(state, purposeLabel) {
  const tuples = getAllTuples(state);
  if (!tuples.length) {
    throw new Error("No saved tuples exist yet.");
  }

  console.log(`Choose a saved workspace to ${purposeLabel}:`);
  tuples.forEach((tuple, index) => {
    const activeMark = tuple.tuple_id === state.active_tuple_id ? "*" : " ";
    console.log(
      `  ${index + 1}. ${activeMark} ${tuple.alias} | ${tuple.account_email} | ${formatTupleWorkspaceSummary(tuple)}`,
    );
  });

  const answer = await promptRequired(
    "Choose tuple number: ",
    "Tuple selection is required.",
  );
  const parsed = Number(answer);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > tuples.length) {
    throw new Error("Invalid tuple selection.");
  }
  return tuples[parsed - 1];
}

async function chooseAccount(state, desiredAccountId = null) {
  const accounts = summarizeAccounts(state);
  if (!accounts.length) {
    throw new Error("No saved accounts exist yet.");
  }

  if (desiredAccountId) {
    const match = accounts.find((item) => item.account_id === desiredAccountId);
    if (!match) {
      throw new Error(`Account ${desiredAccountId} is not saved.`);
    }
    return match;
  }

  if (accounts.length === 1) {
    return accounts[0];
  }

  if (!process.stdin.isTTY) {
    throw new Error("Multiple saved accounts exist. Specify --account-id explicitly.");
  }

  console.log("Available accounts:");
  accounts.forEach((account, index) => {
    console.log(
      `  ${index + 1}. ${account.account_email || "(unknown email)"} | ${account.account_id}`,
    );
  });

  const answer = await promptRequired(
    "Choose account number: ",
    "Account selection is required.",
  );
  const parsed = Number(answer);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > accounts.length) {
    throw new Error("Invalid account selection.");
  }
  return accounts[parsed - 1];
}

async function promptManualWorkspaceName(providedAlias = null) {
  if (providedAlias) {
    return providedAlias.trim();
  }
  return promptRequired(
    "Enter the manual workspace name to display: ",
    "Workspace name is required.",
  );
}

async function promptManualOfficialApiKeyName(providedAlias = null, suggestedAlias = null) {
  if (providedAlias) {
    return providedAlias.trim();
  }
  const answer = await promptLine(
    `Enter the manual official API key profile name${suggestedAlias ? ` [${suggestedAlias}]` : ""}: `,
  );
  if (answer) {
    return answer;
  }
  if (suggestedAlias) {
    return suggestedAlias;
  }
  throw new Error("Official API key profile name is required.");
}

async function promptOfficialApiKeyValue(providedValue = null) {
  if (providedValue) {
    return String(providedValue).trim();
  }
  if (!process.stdin.isTTY) {
    throw new Error("Adding an official API key requires an interactive terminal.");
  }
  const apiKey = await promptSecretPrompt("Official OPENAI_API_KEY:");
  if (!apiKey) {
    throw new Error("API key is required.");
  }
  return apiKey;
}

async function maybeConfirmForce(actionLabel) {
  const processes = detectRunningCodexProcesses();
  if (!processes.length) {
    return false;
  }

  console.log("");
  console.log(`Running Codex CLI processes detected: ${formatProcessSummary(processes)}`);
  console.log("Changing auth/workspace now will affect future codex runs.");
  return promptYesNo(`Force ${actionLabel} anyway?`, false);
}

function ensureForceIfNeeded(force) {
  if (force) {
    return;
  }
  assertNoRunningCodexProcesses();
}

async function maybeActivateTuple(state, tupleId, options) {
  const shouldActivate =
    options.activateNow == null
      ? await promptYesNo("Activate this tuple for normal codex now?", false)
      : options.activateNow;

  if (!shouldActivate) {
    console.log("Saved without activation.");
    return;
  }

  ensureForceIfNeeded(Boolean(options.force));
  await activateTuple(state, tupleId, { skipProcessCheck: Boolean(options.force) });
}

async function maybeActivateOfficialApiKeyProfile(state, profileId, options) {
  const shouldActivate =
    options.activateNow == null
      ? await promptYesNo("Activate this official API key profile for normal codex now?", false)
      : options.activateNow;

  if (!shouldActivate) {
    console.log("Saved without activation.");
    return;
  }

  ensureForceIfNeeded(Boolean(options.force));
  await activateOfficialApiKeyProfile(state, profileId, {
    skipProcessCheck: Boolean(options.force),
  });
}

async function interactiveChooseAccount(state, title = "Accounts") {
  const accounts = summarizeAccounts(state);
  if (!accounts.length) {
    throw new Error("No saved accounts exist yet.");
  }

  const choice = await selectChoice({
    title,
    description: "Choose an account. Enter opens its saved workspaces. Esc goes back.",
    state,
    choices: [
      ...accounts.map((account) => ({
        name: account.account_id,
        message: account.account_email || account.account_id,
        hint: `${account.account_id} | ${account.account_name || "unknown name"}`,
      })),
      {
        name: "__back__",
        message: "Back",
      },
    ],
  });

  if (!choice || choice === "__back__") {
    return null;
  }
  return accounts.find((item) => item.account_id === choice) || null;
}

async function interactiveChooseTupleForAccount(state, accountId, title = "Saved Workspaces") {
  const tuples = getAllTuples(state).filter((tuple) => tuple.account_id === accountId);
  if (!tuples.length) {
    throw new Error("No saved workspaces exist for this account.");
  }

  const choice = await selectChoice({
    title,
    description: "Choose a saved workspace. Enter opens actions for that workspace.",
    state,
    choices: [
      ...tuples.map((tuple) => ({
        name: tuple.tuple_id,
        message: tuple.alias,
        hint: `${formatTupleWorkspaceSummary(tuple)}${tuple.tuple_id === state.active_tuple_id ? " | active" : ""}`,
      })),
      {
        name: "__back__",
        message: "Back",
      },
    ],
  });

  if (!choice || choice === "__back__") {
    return null;
  }
  return tuples.find((item) => item.tuple_id === choice) || null;
}

async function interactiveChooseAnyTuple(state, title = "Saved Workspaces") {
  const tuples = getAllTuples(state);
  if (!tuples.length) {
    throw new Error("No saved tuples exist yet.");
  }

  const choice = await selectChoice({
    title,
    description: "Choose a saved workspace tuple. Enter opens it; Esc goes back.",
    state,
    choices: [
      ...tuples.map((tuple) => ({
        name: tuple.tuple_id,
        message: tuple.alias,
        hint: `${tuple.account_email} | ${formatTupleWorkspaceSummary(tuple)}${tuple.tuple_id === state.active_tuple_id ? " | active" : ""}`,
      })),
      {
        name: "__back__",
        message: "Back",
      },
    ],
  });

  if (!choice || choice === "__back__") {
    return null;
  }
  return tuples.find((item) => item.tuple_id === choice) || null;
}

async function interactiveChooseVisibleWorkspace(meta, {
  title,
  description,
  registeredWorkspaceIds = new Set(),
  allowRegistered = true,
} = {}) {
  if (!meta.organizations.length) {
    throw new Error("The login token does not expose any ChatGPT workspaces.");
  }

  const choices = meta.organizations.map((workspace) => {
    const registered = registeredWorkspaceIds.has(workspace.id);
    return {
      name: workspace.id,
      message: workspace.title,
      hint: `${workspace.id}${registered ? " | registered" : ""}${workspace.is_default ? " | default" : ""}`,
      disabled: !allowRegistered && registered ? "already registered" : false,
    };
  });

  choices.push({ name: "__back__", message: "Back" });

  const choice = await selectChoice({
    title: title || "Choose Workspace",
    description:
      description ||
      "Choose the real ChatGPT workspace. The display name will be entered manually on the next step.",
    choices,
  });

  if (!choice || choice === "__back__") {
    return null;
  }
  return meta.organizations.find((item) => item.id === choice) || null;
}

async function interactivePromptManualName(initialValue = "") {
  const alias = await promptInputPrompt(
    "Manual workspace name (required, not auto-filled):",
    initialValue,
  );
  if (!alias) {
    throw new Error("Workspace name is required.");
  }
  return alias;
}

async function interactiveResolveForce(actionLabel) {
  const processes = detectRunningCodexProcesses();
  if (!processes.length) {
    return { proceed: true, force: false };
  }

  console.log("");
  console.log(`Running Codex CLI detected: ${formatProcessSummary(processes)}`);
  console.log(`This ${actionLabel} updates ~/.codex/auth.json and ~/.codex/config.toml.`);
  console.log(
    "Already-running Codex windows keep their old in-memory workspace until they are restarted."
  );
  const confirmed = await promptConfirmPrompt(
    "Force continue anyway?",
    false,
  );
  return {
    proceed: confirmed,
    force: confirmed,
  };
}

async function interactiveMaybeActivateTuple(state, tupleId) {
  const shouldActivate = await promptConfirmPrompt(
    "Use this saved tuple for normal codex now?",
    false,
  );
  if (!shouldActivate) {
    return false;
  }

  maybeWarnSameRealWorkspace(state, requireTuple(state, tupleId));
  const decision = await interactiveResolveForce("activation");
  if (!decision.proceed) {
    console.log("Activation canceled. Current workspace was not changed.");
    return false;
  }
  await activateTuple(state, tupleId, { skipProcessCheck: decision.force });
  return true;
}

async function interactiveMaybeActivateOfficialApiKeyProfile(state, profileId) {
  const shouldActivate = await promptConfirmPrompt(
    "Use this official API key profile for normal codex now?",
    false,
  );
  if (!shouldActivate) {
    return false;
  }

  const decision = await interactiveResolveForce("activation");
  if (!decision.proceed) {
    console.log("Activation canceled. Current auth was not changed.");
    return false;
  }
  await activateOfficialApiKeyProfile(state, profileId, { skipProcessCheck: decision.force });
  return true;
}

async function interactiveSwitchWorkspace(state) {
  const tuple = await interactiveChooseAnyTuple(state, "Apply Saved Tuple");
  if (!tuple) {
    return false;
  }
  maybeWarnSameRealWorkspace(state, tuple);
  const decision = await interactiveResolveForce("switch");
  if (!decision.proceed) {
    console.log("Switch canceled. Current workspace remains unchanged.");
    return false;
  }
  await activateTuple(state, tuple.tuple_id, { skipProcessCheck: decision.force });
  return true;
}

async function interactiveRegisterTupleFromAuthData(authData, options = {}) {
  const state = loadState();
  const meta = extractAuthMeta(authData);
  if (options.workspaceId) {
    console.log(
      "Visible organization ids from the token are informational only here; codex_m will save the real login workspace id from the auth token."
    );
  }

  const alias = options.alias || (await interactivePromptManualName(""));
  saveAccountAuth(getMetaAuthStorageKey(meta), authData);

  const existing = getAllTuples(state).find(
    (tuple) => getTupleIdentityKey(tuple) === getMetaIdentityKey(meta),
  );
  const tuple = createTupleFromMeta(meta, alias);
  if (existing) {
    tuple.tuple_id = existing.tuple_id;
    tuple.created_at = existing.created_at || tuple.created_at;
    tuple.last_used_at = existing.last_used_at || tuple.last_used_at;
    tuple.workspace_id = existing.workspace_id || tuple.workspace_id;
    tuple.workspace_title = existing.workspace_title || tuple.workspace_title;
    tuple.workspace_role = existing.workspace_role || tuple.workspace_role;
  }

  state.tuples[tuple.tuple_id] = tuple;
  saveState(state);

  await interactiveMaybeActivateTuple(state, tuple.tuple_id);
  return true;
}

async function registerTupleFromAuthData(authData, options = {}) {
  const state = loadState();
  const meta = extractAuthMeta(authData);
  if (options.workspaceId) {
    console.log(
      "Visible organization ids from the token are informational only here; codex_m will save the real login workspace id from the auth token."
    );
  }
  const alias = await promptManualWorkspaceName(options.alias || null);

  saveAccountAuth(getMetaAuthStorageKey(meta), authData);

  const existing = getAllTuples(state).find(
    (tuple) => getTupleIdentityKey(tuple) === getMetaIdentityKey(meta),
  );
  const tuple = createTupleFromMeta(meta, alias);
  if (existing) {
    tuple.tuple_id = existing.tuple_id;
    tuple.created_at = existing.created_at || tuple.created_at;
    tuple.last_used_at = existing.last_used_at || tuple.last_used_at;
    tuple.workspace_id = existing.workspace_id || tuple.workspace_id;
    tuple.workspace_title = existing.workspace_title || tuple.workspace_title;
    tuple.workspace_role = existing.workspace_role || tuple.workspace_role;
  }

  state.tuples[tuple.tuple_id] = tuple;
  saveState(state);

  console.log(`Saved tuple: ${tuple.alias}`);
  console.log(`Tuple id: ${tuple.tuple_id}`);
  await maybeActivateTuple(state, tuple.tuple_id, options);
}

async function interactiveRegisterOfficialApiKeyProfileFromAuthData(authData, options = {}) {
  if (detectAuthKind(authData) !== PROFILE_KIND_OFFICIAL_API_KEY) {
    throw new Error("Expected official API key auth.json data.");
  }

  const state = loadState();
  const meta = extractOfficialApiKeyMeta(authData);
  const profileId = createOfficialApiKeyStorageKey(authData.OPENAI_API_KEY);
  const existing = normalizeOfficialApiKeyProfile(
    state.official_api_key_profiles?.[profileId],
    profileId,
  );
  const suggestedAlias = existing?.alias || `official-api-key-${getOfficialApiKeyProfiles(state).length + 1}`;
  const alias = options.alias || (await promptManualOfficialApiKeyName(null, suggestedAlias));

  saveOfficialApiKeyProfileAuth(profileId, buildOfficialApiKeyAuthData(authData.OPENAI_API_KEY));

  const profile = {
    profile_id: profileId,
    auth_storage_key: profileId,
    alias,
    auth_mode: "apikey",
    key_hash: meta.key_hash,
    created_at: existing?.created_at || isoNow(),
    last_used_at: existing?.last_used_at || null,
  };

  state.official_api_key_profiles[profileId] = profile;
  saveState(state);
  await interactiveMaybeActivateOfficialApiKeyProfile(state, profileId);
  return true;
}

async function registerOfficialApiKeyProfileFromAuthData(authData, options = {}) {
  if (detectAuthKind(authData) !== PROFILE_KIND_OFFICIAL_API_KEY) {
    throw new Error("Expected official API key auth.json data.");
  }

  const state = loadState();
  const meta = extractOfficialApiKeyMeta(authData);
  const profileId = createOfficialApiKeyStorageKey(authData.OPENAI_API_KEY);
  const existing = normalizeOfficialApiKeyProfile(
    state.official_api_key_profiles?.[profileId],
    profileId,
  );
  const suggestedAlias = existing?.alias || `official-api-key-${getOfficialApiKeyProfiles(state).length + 1}`;
  const alias = await promptManualOfficialApiKeyName(options.alias || null, suggestedAlias);

  saveOfficialApiKeyProfileAuth(profileId, buildOfficialApiKeyAuthData(authData.OPENAI_API_KEY));

  const profile = {
    profile_id: profileId,
    auth_storage_key: profileId,
    alias,
    auth_mode: "apikey",
    key_hash: meta.key_hash,
    created_at: existing?.created_at || isoNow(),
    last_used_at: existing?.last_used_at || null,
  };

  state.official_api_key_profiles[profileId] = profile;
  saveState(state);

  console.log(`Saved official API key profile: ${profile.alias}`);
  console.log(`Profile id: ${profile.profile_id}`);
  await maybeActivateOfficialApiKeyProfile(state, profile.profile_id, options);
}

async function handleList(state, args) {
  let json = false;
  let kind = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--kind") {
      kind = parseProfileKindOption(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown list option: ${arg}`);
    }
  }

  const summary = summarizeState(state);
  if (json) {
    if (kind === PROFILE_KIND_CHATGPT) {
      printJson({
        active_official_profile: summary.active_official_profile,
        chatgpt_tuple_count: summary.chatgpt_tuple_count,
        tuples: summary.tuples,
      });
      return;
    }
    if (kind === PROFILE_KIND_OFFICIAL_API_KEY) {
      printJson({
        active_official_profile: summary.active_official_profile,
        official_api_key_profile_count: summary.official_api_key_profile_count,
        official_api_key_profiles: summary.official_api_key_profiles,
      });
      return;
    }
    printJson(summary);
    return;
  }

  if (!kind) {
    printTupleSummary(state);
    return;
  }

  if (kind === PROFILE_KIND_CHATGPT) {
    console.log("Official ChatGPT snapshots:");
    if (!summary.tuples.length) {
      console.log("  (none)");
      return;
    }
    summary.tuples.forEach((tuple, index) => {
      console.log(
        `${String(index + 1).padStart(2, " ")} ${tuple.is_active ? "*" : " "} ${tuple.alias} | ${tuple.account_email} | login ${tuple.login_workspace_id}`,
      );
      console.log(`   tuple_id: ${tuple.tuple_id}`);
    });
    return;
  }

  console.log("Official API key profiles:");
  if (!summary.official_api_key_profiles.length) {
    console.log("  (none)");
    return;
  }
  summary.official_api_key_profiles.forEach((profile, index) => {
    console.log(
      `${String(index + 1).padStart(2, " ")} ${profile.is_active ? "*" : " "} ${profile.alias} | ${profile.masked_key}`,
    );
    console.log(`   profile_id: ${profile.profile_id}`);
  });
}

async function handleWorkspaces(state, args) {
  let accountId = null;
  let tupleId = null;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--account-id") {
      accountId = parseOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--tuple-id") {
      tupleId = parseOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown workspaces option: ${arg}`);
    }
  }

  const matches = tupleId
    ? [requireTuple(state, tupleId)]
    : getAllTuples(state).filter((tuple) => !accountId || tuple.account_id === accountId);
  if (!matches.length) {
    throw new Error(accountId ? `Account ${accountId} is not saved.` : "No saved tuples exist yet.");
  }

  let tuple = null;
  if (matches.length === 1) {
    tuple = matches[0];
  } else if (!process.stdin.isTTY) {
    if (accountId) {
      throw new Error(
        `Multiple saved tuples share login workspace ${accountId}. Specify --tuple-id explicitly.`,
      );
    }
    throw new Error("Multiple saved tuples exist. Specify --tuple-id explicitly.");
  } else {
    console.log("Saved tuples:");
    matches.forEach((item, matchIndex) => {
      console.log(
        `  ${matchIndex + 1}. ${item.alias} | ${item.account_email || "(unknown email)"} | ${formatTupleWorkspaceSummary(item)}`,
      );
      console.log(`     tuple_id: ${item.tuple_id}`);
    });
    const answer = await promptRequired(
      "Choose tuple number: ",
      "Tuple selection is required.",
    );
    const parsed = Number(answer);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > matches.length) {
      throw new Error("Invalid tuple selection.");
    }
    tuple = matches[parsed - 1];
  }

  const meta = latestMetaForTuple(tuple);
  const payload = meta.organizations.map((workspace) => ({
    workspace_id: workspace.id,
    official_title: workspace.title,
    role: workspace.role || "",
    is_default: Boolean(workspace.is_default),
  }));

  if (json) {
    printJson({
      tuple_id: tuple.tuple_id,
      account_id: tuple.account_id,
      account_email: tuple.account_email,
      login_workspace_id: meta.login_workspace_id || tuple.account_id,
      visible_org_hints: payload,
    });
    return;
  }

  console.log(`Account: ${tuple.account_email || tuple.account_id}`);
  console.log(`Real login workspace id: ${meta.login_workspace_id || tuple.account_id}`);
  console.log("Visible org hints in this login snapshot:");
  payload.forEach((workspace, index) => {
    const marks = [workspace.is_default ? "default" : ""].filter(Boolean).join(", ");
    console.log(
      `${index + 1}. ${workspace.official_title} | ${workspace.workspace_id}${marks ? ` | ${marks}` : ""}`,
    );
  });
}

async function handleCapture(args) {
  let workspaceId = null;
  let alias = null;
  let activateNow = null;
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--workspace-id") {
      workspaceId = parseOptionValue(args, index, arg);
      index += 1;
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
      throw new Error(`Unknown capture option: ${arg}`);
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const captureHome = path.join(TMP_DIR, `capture-${timestamp}`);
  ensureDir(captureHome);

  console.log("Starting codex login in a temporary CODEX_HOME:");
  console.log(captureHome);
  console.log("");

  runFreshOfficialLogin(captureHome);

  const authPath = path.join(captureHome, "auth.json");
  if (!fs.existsSync(authPath)) {
    throw new Error("Login completed without creating auth.json in the temporary CODEX_HOME.");
  }

  await registerTupleFromAuthData(readJson(authPath), {
    workspaceId,
    alias,
    activateNow,
    force,
  });
}

async function handleImportCurrent(args) {
  let workspaceId = null;
  let alias = null;
  let activateNow = null;
  let force = false;
  let kind = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--workspace-id") {
      workspaceId = parseOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--alias") {
      alias = parseOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--activate") {
      activateNow = true;
    } else if (arg === "--no-activate") {
      activateNow = false;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--kind") {
      kind = parseProfileKindOption(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown import-current option: ${arg}`);
    }
  }

  if (!fs.existsSync(OFFICIAL_CLI_AUTH_PATH)) {
    throw new Error(`Official CLI auth.json is missing at ${OFFICIAL_CLI_AUTH_PATH}`);
  }

  const authData = readJson(OFFICIAL_CLI_AUTH_PATH);
  const detectedKind = detectAuthKind(authData);
  const effectiveKind = kind || detectedKind;
  if (kind && kind !== detectedKind) {
    throw new Error(
      `Current official auth is ${formatProfileKindLabel(detectedKind)}, not ${formatProfileKindLabel(kind)}.`,
    );
  }

  if (effectiveKind === PROFILE_KIND_CHATGPT) {
    await registerTupleFromAuthData(authData, {
      workspaceId,
      alias,
      activateNow,
      force,
    });
    return;
  }

  if (workspaceId) {
    throw new Error("--workspace-id only applies to ChatGPT snapshots.");
  }

  await registerOfficialApiKeyProfileFromAuthData(authData, {
    alias,
    activateNow,
    force,
  });
}

async function handleAddApiKey(args) {
  let alias = null;
  let activateNow = null;
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--alias") {
      alias = parseOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--activate") {
      activateNow = true;
    } else if (arg === "--no-activate") {
      activateNow = false;
    } else if (arg === "--force") {
      force = true;
    } else {
      throw new Error(`Unknown add-api-key option: ${arg}`);
    }
  }

  const apiKey = await promptOfficialApiKeyValue();
  await registerOfficialApiKeyProfileFromAuthData(buildOfficialApiKeyAuthData(apiKey), {
    alias,
    activateNow,
    force,
  });
}

async function handleAddWorkspace(state, args) {
  void state;
  void args;
  throw new Error(
    "add-workspace is disabled. Run Login again from the real ChatGPT workspace you want, then import/capture that login snapshot."
  );
}

async function handleActivate(state, args) {
  let recordId = null;
  let kind = null;
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--kind") {
      kind = parseProfileKindOption(args, index, arg);
      index += 1;
    } else if (arg === "--force") {
      force = true;
    } else if (!recordId) {
      recordId = arg;
    } else {
      throw new Error(`Unknown activate option: ${arg}`);
    }
  }

  if (!recordId) {
    throw new Error(
      "Usage: codex_m activate [--kind chatgpt|official-api-key] <id> [--force]",
    );
  }

  const profileRef = resolveOfficialProfileRef(state, recordId, kind);
  if (profileRef.kind === PROFILE_KIND_CHATGPT) {
    maybeWarnSameRealWorkspace(state, profileRef.record);
    await activateTuple(state, profileRef.id, { skipProcessCheck: force });
    return;
  }

  await activateOfficialApiKeyProfile(state, profileRef.id, { skipProcessCheck: force });
}

async function handleUseCodex(state, args) {
  let force = false;

  for (const arg of args) {
    if (arg === "--force") {
      force = true;
    } else {
      throw new Error(`Unknown use-codex option: ${arg}`);
    }
  }

  if (!force && process.stdin.isTTY) {
    const decision = await interactiveResolveForce("codex.exe restore");
    if (!decision.proceed) {
      console.log("codex.exe restore canceled.");
      return;
    }
    force = decision.force;
  }

  await setPlainCodexOfficialMode(state, { skipProcessCheck: force });
}

async function handleRename(state, args) {
  let recordId = null;
  let kind = null;
  let alias = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--kind") {
      kind = parseProfileKindOption(args, index, arg);
      index += 1;
    } else if (arg === "--alias") {
      alias = parseOptionValue(args, index, arg);
      index += 1;
    } else if (!recordId) {
      recordId = arg;
    } else {
      throw new Error(`Unknown rename option: ${arg}`);
    }
  }

  if (!recordId) {
    throw new Error(
      "Usage: codex_m rename [--kind chatgpt|official-api-key] <id> --alias <manual-name>",
    );
  }

  const profileRef = resolveOfficialProfileRef(state, recordId, kind);
  if (!alias) {
    alias =
      profileRef.kind === PROFILE_KIND_CHATGPT
        ? await promptManualWorkspaceName(null)
        : await promptManualOfficialApiKeyName(null, profileRef.record.alias);
  }

  if (profileRef.kind === PROFILE_KIND_CHATGPT) {
    renameTupleAlias(state, profileRef.id, alias);
    console.log(`Renamed ChatGPT tuple to: ${alias}`);
    return;
  }

  renameOfficialApiKeyProfileAlias(state, profileRef.id, alias);
  console.log(`Renamed official API key profile to: ${alias}`);
}

async function handleDelete(state, args) {
  let recordId = null;
  let kind = null;
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--kind") {
      kind = parseProfileKindOption(args, index, arg);
      index += 1;
    } else if (arg === "--force") {
      force = true;
    } else if (!recordId) {
      recordId = arg;
    } else {
      throw new Error(`Unknown delete option: ${arg}`);
    }
  }

  if (!recordId) {
    throw new Error(
      "Usage: codex_m delete [--kind chatgpt|official-api-key] <id> [--force]",
    );
  }

  const profileRef = resolveOfficialProfileRef(state, recordId, kind);
  const confirmed =
    profileRef.kind === PROFILE_KIND_CHATGPT
      ? await promptYesNo(
          `Delete '${profileRef.record.alias}' (${profileRef.record.account_email} | ${formatTupleWorkspaceSummary(profileRef.record)})?`,
          false,
        )
      : await promptYesNo(
          `Delete official API key profile '${profileRef.record.alias}'?`,
          false,
        );
  if (!confirmed) {
    console.log("Delete canceled.");
    return;
  }

  if (profileRef.kind === PROFILE_KIND_CHATGPT) {
    await deleteTuple(state, profileRef.id, { skipProcessCheck: force });
    return;
  }

  await deleteOfficialApiKeyProfile(state, profileRef.id, { skipProcessCheck: force });
}

async function handleDoctor(state) {
  const { issues, warnings } = doctorReport(state);
  if (!issues.length) {
    console.log("No blocking issues found for the official lane.");
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

async function handleSyncThreads(state, args) {
  let force = false;
  let scope = "recent";

  for (const arg of args) {
    if (arg === "--force") {
      force = true;
    } else if (arg === "--all") {
      scope = "all";
    } else if (arg === "--recent") {
      scope = "recent";
    } else {
      throw new Error(`Unknown sync-threads option: ${arg}`);
    }
  }

  if (!force) {
    assertNoRunningCodexProcesses();
  }

  const results = syncManagedThreadMetadata({ scope });
  results.forEach((result) => {
    if (result.error) {
      console.log(`Failed to sync shared thread metadata into ${result.targetHome}: ${result.error}`);
      return;
    }
    if (result.mirrored_from) {
      console.log(`Mirrored thread metadata into ${result.targetHome} from ${result.mirrored_from} after a direct sync failure.`);
      return;
    }
    console.log(`Synced ${result.upserted} shared thread metadata row(s) into ${result.targetHome} using scope=${scope}.`);
  });
}

async function handleLogin(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: codex_m login [--import-current] [--with-api-key]");
    return;
  }

  let importCurrent = false;
  let withApiKey = false;
  for (const arg of args) {
    if (arg === "--import-current") {
      importCurrent = true;
    } else if (arg === "--with-api-key") {
      withApiKey = true;
    } else {
      throw new Error(`Unknown login option: ${arg}`);
    }
  }

  if (importCurrent) {
    await handleImportCurrent([]);
    return;
  }

  if (withApiKey) {
    await handleAddApiKey([]);
    return;
  }

  if (process.stdin.isTTY) {
    await runLoginPage();
    return;
  }

  throw new Error(
    "Use 'codex_m login --import-current', 'codex_m login --with-api-key', or run 'codex_m login' in an interactive terminal.",
  );
}

async function handleLogout(state, args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: codex_m logout [<tuple-id>] [--force]");
    return;
  }

  let tupleId = args[0] || null;
  let force = false;

  for (let index = tupleId ? 1 : 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--force") {
      force = true;
    } else if (!tupleId) {
      tupleId = arg;
    } else {
      throw new Error(`Unknown logout option: ${arg}`);
    }
  }

  if (!tupleId) {
    if (!process.stdin.isTTY) {
      throw new Error("Usage: codex_m logout <tuple-id> [--force]");
    }
    const tuple = await interactiveChooseAnyTuple(state, "Logout Workspace");
    if (!tuple) {
      return;
    }
    tupleId = tuple.tuple_id;
  }

  await handleDelete(state, [tupleId, ...(force ? ["--force"] : [])]);
}

async function handleSwitch(state, args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: codex_m switch [<tuple-id>] [--force]");
    return;
  }

  let tupleId = null;
  let force = false;

  for (const arg of args) {
    if (arg === "--force") {
      force = true;
    } else if (!tupleId) {
      tupleId = arg;
    } else {
      throw new Error(`Unknown switch option: ${arg}`);
    }
  }

  if (!tupleId) {
    if (!process.stdin.isTTY) {
      throw new Error("Usage: codex_m switch <tuple-id> [--force]");
    }
    const tuple = await interactiveChooseAnyTuple(state, "Apply Saved Tuple");
    if (!tuple) {
      return;
    }
    tupleId = tuple.tuple_id;
  }

  if (!force && process.stdin.isTTY) {
    const decision = await interactiveResolveForce("switch");
    if (!decision.proceed) {
      console.log("Switch canceled. Current workspace remains unchanged.");
      return;
    }
    force = decision.force;
  }

  await activateTuple(state, tupleId, { skipProcessCheck: force });
}

async function runWorkspaceDetailPage(tupleId) {
  while (true) {
    const state = loadState();
    const tuple = state.tuples[tupleId];
    if (!tuple) {
      return;
    }

    const activeWorkspace = getCurrentWorkspaceRestriction(readOfficialConfigText());
    const choice = await selectChoice({
      title: "Workspace Detail",
      description: "Choose what to do with this saved workspace.",
      state,
      choices: [
        {
          name: "activate",
          message: "Use now",
          hint:
            tuple.tuple_id === state.active_tuple_id
              ? "currently active locally"
              : formatTupleWorkspaceSummary(tuple),
        },
        {
          name: "rename",
          message: "Rename manual name",
          hint: tuple.alias,
        },
        {
          name: "logout",
          message: "Logout this workspace",
          hint: "remove only this saved (account, workspace)",
        },
        {
          name: "back",
          message: "Back",
          hint: `configured workspace hint: ${activeWorkspace || "(not set)"}`,
        },
      ],
    });

    if (!choice || choice === "back") {
      return;
    }

    if (choice === "activate") {
      maybeWarnSameRealWorkspace(state, tuple);
      const decision = await interactiveResolveForce("activation");
      if (!decision.proceed) {
        console.log("Activation canceled. Current workspace was not changed.");
        continue;
      }
      await activateTuple(state, tupleId, { skipProcessCheck: decision.force });
    } else if (choice === "rename") {
      const alias = await interactivePromptManualName(tuple.alias);
      renameTupleAlias(state, tupleId, alias);
    } else if (choice === "logout") {
      const confirmed = await promptConfirmPrompt(
        `Logout saved workspace '${tuple.alias}'?`,
        false,
      );
      if (!confirmed) {
        continue;
      }
      const decision =
        tuple.tuple_id === state.active_tuple_id
          ? await interactiveResolveForce("logout")
          : { proceed: true, force: false };
      if (!decision.proceed) {
        console.log("Logout canceled. Current workspace remains saved and unchanged.");
        continue;
      }
      await deleteTuple(state, tupleId, { skipProcessCheck: decision.force });
      return;
    }
  }
}

function buildManageChoices(state) {
  const choices = getAllTuples(state).map((tuple) => ({
    name: tuple.tuple_id,
    message: tuple.alias,
    hint: `${tuple.account_email || "(unknown email)"} | ${formatTupleWorkspaceSummary(tuple)}${tuple.tuple_id === state.active_tuple_id ? " | active" : ""}`,
  }));

  choices.push({
    name: "__back__",
    message: "Back",
  });

  return choices;
}

function buildOfficialApiKeyManageChoices(state) {
  const choices = getOfficialApiKeyProfiles(state).map((profile) => ({
    name: profile.profile_id,
    message: profile.alias,
    hint: (() => {
      try {
        return `${extractOfficialApiKeyMeta(
          readJson(officialApiKeyProfileAuthPath(profile.profile_id)),
        ).masked_key}${isOfficialApiKeyProfileActive(state, profile.profile_id) ? " | active" : ""}`;
      } catch {
        return `invalid auth${isOfficialApiKeyProfileActive(state, profile.profile_id) ? " | active" : ""}`;
      }
    })(),
  }));

  choices.push({
    name: "__back__",
    message: "Back",
  });

  return choices;
}

async function runManageActionsMenu(tupleId) {
  while (true) {
    const state = loadState();
    const tuple = state.tuples[tupleId];
    if (!tuple) {
      return;
    }

    const choice = await selectChoice({
      title: "Workspace Actions",
      description: `${tuple.alias} | Tab from Account Manage opens this menu.`,
      state,
      choices: [
        {
          name: "rename",
          message: "Rename",
          hint: tuple.alias,
        },
        {
          name: "logout",
          message: "Logout",
          hint: "remove only this saved workspace",
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
      const alias = await interactivePromptManualName(tuple.alias);
      renameTupleAlias(state, tupleId, alias);
      continue;
    }

    if (choice === "logout") {
      const confirmed = await promptConfirmPrompt(`Logout '${tuple.alias}'?`, false);
      if (!confirmed) {
        continue;
      }
      const decision =
        tuple.tuple_id === state.active_tuple_id
          ? await interactiveResolveForce("logout")
          : { proceed: true, force: false };
      if (!decision.proceed) {
        console.log("Logout canceled. Current workspace remains saved and unchanged.");
        continue;
      }
      await deleteTuple(state, tupleId, { skipProcessCheck: decision.force });
      return;
    }
  }
}

async function runOfficialApiKeyActionsMenu(profileId) {
  while (true) {
    const state = loadState();
    const profile = normalizeOfficialApiKeyProfile(
      state.official_api_key_profiles?.[profileId],
      profileId,
    );
    if (!profile) {
      return;
    }

    const choice = await selectChoice({
      title: "API Key Actions",
      description: `${profile.alias} | Tab from API Key Manage opens this menu.`,
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
          hint: "remove only this saved official API key profile",
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
        (await promptInputPrompt("Official API key profile name:", profile.alias)) || profile.alias;
      renameOfficialApiKeyProfileAlias(state, profileId, alias);
      continue;
    }

    if (choice === "delete") {
      const confirmed = await promptConfirmPrompt(
        `Delete official API key profile '${profile.alias}'?`,
        false,
      );
      if (!confirmed) {
        continue;
      }
      const decision =
        isOfficialApiKeyProfileActive(state, profileId)
          ? await interactiveResolveForce("delete")
          : { proceed: true, force: false };
      if (!decision.proceed) {
        console.log("Delete canceled. Current auth remains unchanged.");
        continue;
      }
      await deleteOfficialApiKeyProfile(state, profileId, { skipProcessCheck: decision.force });
      return;
    }
  }
}

async function runManageChatGptPage() {
  while (true) {
    const state = loadState();
    const selected = await selectChoice({
      title: "Account Manage",
      description: "Manage saved official ChatGPT snapshots. Enter applies locally. Tab opens Rename or Logout.",
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

    const tuple = requireTuple(loadState(), selected);
    if (isTupleCurrentlyActive(loadState(), tuple.tuple_id)) {
      console.log(`Already using '${tuple.alias}'.`);
      continue;
    }
    maybeWarnSameRealWorkspace(loadState(), tuple);
    const decision = await interactiveResolveForce("switch");
    if (!decision.proceed) {
      console.log("Switch canceled. Current workspace remains unchanged.");
      continue;
    }
    await activateTuple(loadState(), tuple.tuple_id, { skipProcessCheck: decision.force });
    return;
  }
}

async function runManageOfficialApiKeysPage() {
  while (true) {
    const state = loadState();
    const selected = await selectChoice({
      title: "API Key Manage",
      description: "Manage saved official API key profiles. Enter applies locally. Tab opens Rename or Delete.",
      state,
      promptClass: ManageSelectPrompt,
      extraLines: ["Keys: Up/Down move | Enter apply locally | Tab more actions | Esc back"],
      choices: buildOfficialApiKeyManageChoices(state),
    });

    if (!selected || selected === "__back__") {
      return;
    }

    if (typeof selected === "object" && selected.mode === "menu") {
      await runOfficialApiKeyActionsMenu(selected.recordId);
      continue;
    }

    const profile = requireOfficialApiKeyProfile(loadState(), selected);
    if (isOfficialApiKeyProfileActive(loadState(), profile.profile_id)) {
      console.log(`Already using '${profile.alias}'.`);
      continue;
    }

    const decision = await interactiveResolveForce("switch");
    if (!decision.proceed) {
      console.log("Switch canceled. Current auth remains unchanged.");
      continue;
    }
    await activateOfficialApiKeyProfile(loadState(), profile.profile_id, {
      skipProcessCheck: decision.force,
    });
    return;
  }
}

async function runAccountWorkspacesPage(accountId) {
  while (true) {
    const state = loadState();
    const account = summarizeAccounts(state).find((item) => item.account_id === accountId);
    if (!account) {
      return;
    }

    const tuples = getAllTuples(state).filter((tuple) => tuple.account_id === accountId);
    const meta = latestMetaForTuple(tuples[0]);

    const choice = await selectChoice({
      title: "Account Workspaces",
      description: `${account.account_email || account.account_id} | Enter opens saved tuple actions.`,
      state,
      choices: [
        ...tuples.map((tuple) => ({
          name: tuple.tuple_id,
          message: tuple.alias,
          hint: `${formatTupleWorkspaceSummary(tuple)}${tuple.tuple_id === state.active_tuple_id ? " | active" : ""}`,
        })),
        {
          name: "show_visible",
          message: "Show visible org hints from token",
          hint: "informational only; not direct switch targets",
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

    if (choice === "show_visible") {
      await selectChoice({
        title: "Visible Org Hints",
        description: "These org ids come from the login token and are informational only. Esc returns.",
        state,
        choices: [
          ...meta.organizations.map((workspace) => ({
            name: `info_${workspace.id}`,
            message: workspace.title,
            hint: workspace.id,
          })),
          {
            name: "back",
            message: "Back",
          },
        ],
      });
      continue;
    }

    await runWorkspaceDetailPage(choice);
  }
}

async function runOverviewPage() {
  while (true) {
    const state = loadState();
    const choice = await selectChoice({
      title: "Home",
      description: "Manage official ChatGPT snapshots and official API key profiles. codex.exe only changes which official lane Desktop follows.",
      state,
      choices: [
        {
          name: "login",
          message: "Login",
          hint: "save either an official ChatGPT snapshot or an official API key profile",
        },
        {
          name: "account_manage",
          message: "Account Manage",
          hint: `${getAllTuples(state).length} saved ChatGPT snapshots`,
        },
        {
          name: "api_key_manage",
          message: "API Key Manage",
          hint: `${getOfficialApiKeyProfiles(state).length} saved official API key profiles`,
        },
        {
          name: "use_codex",
          message: "codex.exe",
          hint: "make Desktop follow the official identity currently managed by codex_m",
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

    if (choice === "account_manage") {
      await runManageChatGptPage();
      continue;
    }

    if (choice === "api_key_manage") {
      await runManageOfficialApiKeysPage();
      continue;
    }

    const decision = await interactiveResolveForce("codex.exe restore");
    if (!decision.proceed) {
      console.log("codex.exe restore canceled.");
      continue;
    }
    await setPlainCodexOfficialMode(loadState(), { skipProcessCheck: decision.force });
    return;
  }
}

async function runAccountsPage() {
  while (true) {
    const state = loadState();
    const account = await interactiveChooseAccount(state, "Accounts");
    if (!account) {
      return;
    }
    await runAccountWorkspacesPage(account.account_id);
  }
}

async function runLoginPage() {
  while (true) {
    const state = loadState();
    const officialAuthKind = getOfficialAuthKind();
    const choice = await selectChoice({
      title: "Login",
      description:
        "Choose whether to save an official ChatGPT login snapshot or an official API key profile.",
      state,
      initial: 0,
      choices: [
        {
          name: "fresh_login",
          message: "Start ChatGPT login now",
          hint: "runs codex login in a temporary CODEX_HOME, then asks for the workspace name",
        },
        {
          name: "import_current_chatgpt",
          message: "Use current signed-in Codex",
          hint: "if the official codex CLI is already logged in, save that login and ask for the workspace name",
        },
        {
          name: "add_api_key",
          message: "Add official API key now",
          hint: "save a file-backed official OPENAI_API_KEY profile for normal codex",
        },
        {
          name: "import_current_api_key",
          message: "Import current official API key",
          hint:
            officialAuthKind === PROFILE_KIND_OFFICIAL_API_KEY
                  ? "current official codex CLI auth is already in API key mode"
                  : "requires the official codex CLI auth to already be in API key mode",
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

    if (choice === "fresh_login") {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const captureHome = path.join(TMP_DIR, `capture-${timestamp}`);
      ensureDir(captureHome);

      console.log("");
      console.log("Starting codex login in a temporary CODEX_HOME:");
      console.log(captureHome);
      console.log("");

      runFreshOfficialLogin(captureHome);

      const authPath = path.join(captureHome, "auth.json");
      if (!fs.existsSync(authPath)) {
        throw new Error("Login completed without creating auth.json in the temporary CODEX_HOME.");
      }
      await interactiveRegisterTupleFromAuthData(readJson(authPath));
      continue;
    }

    if (choice === "import_current_chatgpt") {
      if (!fs.existsSync(OFFICIAL_CLI_AUTH_PATH)) {
        throw new Error(`Official CLI auth.json is missing at ${OFFICIAL_CLI_AUTH_PATH}`);
      }
      if (detectAuthKind(readJson(OFFICIAL_CLI_AUTH_PATH)) !== PROFILE_KIND_CHATGPT) {
        throw new Error(
          "Current official auth is not a ChatGPT login snapshot. Choose 'Import current official API key' instead.",
        );
      }
      await interactiveRegisterTupleFromAuthData(readJson(OFFICIAL_CLI_AUTH_PATH));
      continue;
    }

    if (choice === "add_api_key") {
      const apiKey = await promptOfficialApiKeyValue();
      await interactiveRegisterOfficialApiKeyProfileFromAuthData(
        buildOfficialApiKeyAuthData(apiKey),
      );
      continue;
    }

    if (choice === "import_current_api_key") {
      if (!fs.existsSync(OFFICIAL_CLI_AUTH_PATH)) {
        throw new Error(`Official CLI auth.json is missing at ${OFFICIAL_CLI_AUTH_PATH}`);
      }
      const authData = readJson(OFFICIAL_CLI_AUTH_PATH);
      if (detectAuthKind(authData) !== PROFILE_KIND_OFFICIAL_API_KEY) {
        throw new Error(
          "Current official auth is not in API key mode. Choose 'Use current signed-in Codex' for ChatGPT logins instead.",
        );
      }
      await interactiveRegisterOfficialApiKeyProfileFromAuthData(authData);
    }
  }
}

async function runDoctorPage() {
  while (true) {
    const state = loadState();
    const { issues, warnings } = doctorReport(state);
    const lines = [
      ...issues.map((issue, index) => ({
        name: `issue_${index}`,
        message: issue,
        hint: "issue",
      })),
      ...warnings.map((warning, index) => ({
        name: `warning_${index}`,
        message: warning,
        hint: "warning",
      })),
    ];
    const choice = await selectChoice({
      title: "Doctor",
      description: issues.length
        ? `Found ${issues.length} issue(s) and ${warnings.length} warning(s). Enter to rerun or Esc to go back.`
        : warnings.length
          ? `No blocking issues. Found ${warnings.length} warning(s). Enter to rerun or Esc to go back.`
          : "No blocking issues found for the official lane. Enter to rerun or Esc to go back.",
      state,
      choices: [
        ...(lines.length
          ? lines
          : [
              {
                name: "healthy",
                message: "No blocking issues found for the official lane",
                hint: "healthy",
              },
            ]),
        {
          name: "rerun",
          message: "Rerun doctor",
        },
        {
          name: "back",
          message: "Back to page selector",
        },
      ],
    });

    if (!choice || choice === "back") {
      return;
    }

    if (choice === "rerun") {
      continue;
    }
  }
}

async function runHelpPage() {
  const state = loadState();
  await selectChoice({
    title: "Help",
    description: "Use Home for the common official-lane flow: login, account manage, API key manage, and Desktop follow-mode restore. Esc returns.",
    state,
    choices: [
      {
        name: "home",
        message: "Home page gives direct official ChatGPT and official API key entry points",
        hint: "recommended starting point",
      },
      {
        name: "keys",
        message: "Keys: Up/Down move | Enter open | Esc back",
        hint: "navigation",
      },
      {
        name: "manual_name",
        message: "ChatGPT workspace names and official API key profile names are always manual",
        hint: "auto metadata is only a hint",
      },
      {
        name: "logout_scope",
        message: "Logout deletes one saved ChatGPT tuple; Delete removes one saved API key profile",
        hint: "not the whole account or all keys",
      },
      {
        name: "back",
        message: "Back to page selector",
      },
    ],
  });
}

async function runInteractiveWizard() {
  await runOverviewPage();
}

function printHelp() {
  console.log(`codex_m

Stable CLI manager for official Codex identities on Windows.

Usage:
  codex_m
  codex_m menu
  codex_m switch [<tuple-id>] [--force]
  codex_m login [--import-current] [--with-api-key]
  codex_m add-api-key [--alias <manual-name>] [--activate|--no-activate] [--force]
  codex_m logout [<tuple-id>] [--force]
  codex_m list [--kind chatgpt|official-api-key|all] [--json]
  codex_m workspaces [--account-id <id>] [--tuple-id <tuple-id>] [--json]
  codex_m capture [--workspace-id <id>] [--alias <manual-name>] [--activate|--no-activate] [--force]
  codex_m import-current [--kind chatgpt|official-api-key] [--workspace-id <id>] [--alias <manual-name>] [--activate|--no-activate] [--force]
  codex_m add-workspace
  codex_m activate [--kind chatgpt|official-api-key] <id> [--force]
  codex_m use-codex [--force]
  codex_m sync-threads [--all] [--force]
  codex_m rename [--kind chatgpt|official-api-key] <id> --alias <manual-name>
  codex_m delete [--kind chatgpt|official-api-key] <id> [--force]
  codex_m doctor

Notes:
  - Running plain 'codex_m' opens a simple Home page with Login, Account Manage, API Key Manage, codex.exe, and Quit.
  - codex_m manages both official ChatGPT snapshots and official API key profiles.
  - The codex CLI command always stays on the official lane managed by codex_m.
  - The codex.exe action makes Desktop follow the official lane; it does not replace the launcher or swap the whole home.
  - Account Manage applies saved official ChatGPT snapshots; API Key Manage applies saved official API key profiles.
  - In Account Manage or API Key Manage, Enter applies the selected saved profile and Tab opens Rename/Delete or Logout actions for that section.
  - ChatGPT workspace display names and official API key profile names are always manual.
  - Use 'codex_m workspaces' to inspect visible organization ids from a saved login snapshot. They are informational hints only.
  - Codex enforces the real login workspace via the token's 'chatgpt_account_id', not via organizations[].id.
  - codex_m preserves distinct (email, real login workspace) snapshots and only compacts exact duplicates.
  - Official API key profiles are stored as file-backed auth.json snapshots under ~/.codex-manager/official-api-keys/.
  - 'add-workspace' is disabled because codex_m can only save a real login snapshot returned by Codex.
  - 'logout' removes only the selected saved ChatGPT tuple.
  - --force allows activation/deletion even when another Codex CLI process is running.
`);
}

async function handleCommand(args) {
  const state = loadState();
  const [command, ...rest] = args;

  if (!command) {
    if (process.stdin.isTTY) {
      await runInteractiveWizard();
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
    await runInteractiveWizard();
    return;
  }

  if (command === "list") {
    await handleList(state, rest);
    return;
  }

  if (command === "workspaces") {
    await handleWorkspaces(state, rest);
    return;
  }

  if (command === "capture") {
    await handleCapture(rest);
    return;
  }

  if (command === "import-current") {
    await handleImportCurrent(rest);
    return;
  }

  if (command === "add-api-key") {
    await handleAddApiKey(rest);
    return;
  }

  if (command === "add-workspace") {
    await handleAddWorkspace(state, rest);
    return;
  }

  if (command === "login") {
    await handleLogin(rest);
    return;
  }

  if (command === "switch") {
    await handleSwitch(state, rest);
    return;
  }

  if (command === "logout") {
    await handleLogout(state, rest);
    return;
  }

  if (command === "activate") {
    await handleActivate(state, rest);
    return;
  }

  if (command === "use-codex") {
    await handleUseCodex(state, rest);
    return;
  }

  if (command === "sync-threads") {
    await handleSyncThreads(state, rest);
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
