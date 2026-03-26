#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import readlinePromises from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import enquirer from "enquirer";

const { Select, Input, Confirm } = enquirer;

const VERSION = 2;
const MANAGER_HOME = path.join(os.homedir(), ".codex-manager");
const STATE_PATH = path.join(MANAGER_HOME, "state.json");
const ACCOUNTS_DIR = path.join(MANAGER_HOME, "accounts");
const BACKUPS_DIR = path.join(MANAGER_HOME, "backups");
const TMP_DIR = path.join(MANAGER_HOME, "tmp");

const OFFICIAL_HOME = path.join(os.homedir(), ".codex");
const OFFICIAL_AUTH_PATH = path.join(OFFICIAL_HOME, "auth.json");
const OFFICIAL_CONFIG_PATH = path.join(OFFICIAL_HOME, "config.toml");

const MANAGED_CONFIG_KEYS = {
  cli_auth_credentials_store: '"file"',
};

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

function loadState() {
  ensureDir(MANAGER_HOME);
  ensureDir(ACCOUNTS_DIR);
  ensureDir(BACKUPS_DIR);
  ensureDir(TMP_DIR);

  if (!fs.existsSync(STATE_PATH)) {
    const state = {
      schema_version: VERSION,
      active_tuple_id: null,
      tuples: {},
    };
    writeJson(STATE_PATH, state);
    return state;
  }

  const state = readJson(STATE_PATH);
  if (typeof state !== "object" || state === null) {
    throw new Error(`Invalid state file: ${STATE_PATH}`);
  }
  if (![1, VERSION].includes(state.schema_version)) {
    throw new Error(
      `Unsupported state schema_version ${state.schema_version}; expected ${VERSION}.`,
    );
  }
  if (!state.tuples || typeof state.tuples !== "object") {
    state.tuples = {};
  }
  if (!("active_tuple_id" in state)) {
    state.active_tuple_id = null;
  }
  let changed = false;
  for (const tuple of Object.values(state.tuples)) {
    if (tuple && typeof tuple === "object") {
      if (!tuple.login_workspace_id && tuple.account_id) {
        tuple.login_workspace_id = tuple.account_id;
        changed = true;
      }
      if (!("visible_workspaces" in tuple)) {
        tuple.visible_workspaces = [];
        changed = true;
      }
    }
  }
  if (compactStateToRealLoginWorkspaces(state)) {
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
  if (!authData || authData.auth_mode !== "chatgpt") {
    throw new Error("Only ChatGPT login is supported in codex_m v1.");
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

function accountDir(accountId) {
  return path.join(ACCOUNTS_DIR, accountId);
}

function savedAuthPath(accountId) {
  return path.join(accountDir(accountId), "auth.json");
}

function getTupleLoginWorkspaceId(tuple) {
  return tuple?.login_workspace_id || tuple?.account_id || null;
}

function canonicalTupleIdForLoginWorkspaceId(loginWorkspaceId) {
  return tupleIdFor(loginWorkspaceId, loginWorkspaceId);
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

function compactStateToRealLoginWorkspaces(state) {
  const grouped = new Map();

  for (const tuple of Object.values(state.tuples)) {
    if (!tuple || typeof tuple !== "object") {
      continue;
    }
    const loginWorkspaceId = getTupleLoginWorkspaceId(tuple);
    if (!loginWorkspaceId) {
      continue;
    }
    const list = grouped.get(loginWorkspaceId) || [];
    list.push(tuple);
    grouped.set(loginWorkspaceId, list);
  }

  const nextTuples = {};
  let nextActiveTupleId = null;
  let changed = false;

  for (const [loginWorkspaceId, tuples] of grouped.entries()) {
    const canonical = chooseCanonicalTuple(tuples, state.active_tuple_id);
    const canonicalTupleId = canonicalTupleIdForLoginWorkspaceId(loginWorkspaceId);
    const normalized = {
      ...canonical,
      tuple_id: canonicalTupleId,
      account_id: loginWorkspaceId,
      login_workspace_id: loginWorkspaceId,
      account_email: firstNonEmptyTupleField(tuples, "account_email", canonical.account_email || ""),
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
  const active = state?.active_tuple_id ? state.tuples[state.active_tuple_id] : null;
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
  return {
    tuple_id: canonicalTupleIdForLoginWorkspaceId(meta.login_workspace_id || meta.account_id),
    account_id: meta.account_id,
    login_workspace_id: meta.login_workspace_id || meta.account_id,
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

function readOfficialConfigText() {
  ensureDir(OFFICIAL_HOME);
  if (!fs.existsSync(OFFICIAL_CONFIG_PATH)) {
    return "";
  }
  return fs.readFileSync(OFFICIAL_CONFIG_PATH, "utf8");
}

function getCurrentWorkspaceRestriction(text) {
  const { lines, indexes } = parseTomlTopLevelKeys(text, "forced_chatgpt_workspace_id");
  if (indexes.length !== 1) {
    return null;
  }
  const match = lines[indexes[0]].match(/=\s*"(.*)"\s*$/);
  return match ? match[1] : null;
}

function applyManagedConfig(workspaceId) {
  ensureDir(OFFICIAL_HOME);
  backupFileIfExists(OFFICIAL_CONFIG_PATH, "config.toml.bak");

  const text = writeManagedTopLevelTomlKeys(
    readOfficialConfigText(),
    {
      ...MANAGED_CONFIG_KEYS,
      forced_chatgpt_workspace_id: JSON.stringify(workspaceId),
    },
  );
  writeText(OFFICIAL_CONFIG_PATH, text);
}

function removeManagedWorkspaceRestriction() {
  ensureDir(OFFICIAL_HOME);
  const updated = writeManagedTopLevelTomlKeys(
    readOfficialConfigText(),
    MANAGED_CONFIG_KEYS,
  );
  writeText(OFFICIAL_CONFIG_PATH, updated);
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
    $_.CommandLine -notmatch '(?i)codex-manager'
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

function saveAccountAuth(accountId, authData) {
  ensureDir(accountDir(accountId));
  writeJson(savedAuthPath(accountId), authData);
}

function copySavedAuthToOfficial(accountId) {
  const source = savedAuthPath(accountId);
  if (!fs.existsSync(source)) {
    throw new Error(`Saved auth is missing for account ${accountId}`);
  }
  ensureDir(OFFICIAL_HOME);
  backupFileIfExists(OFFICIAL_AUTH_PATH, "auth.json.bak");
  fs.copyFileSync(source, OFFICIAL_AUTH_PATH);
}

function deleteOfficialAuthIfPresent() {
  if (fs.existsSync(OFFICIAL_AUTH_PATH)) {
    backupFileIfExists(OFFICIAL_AUTH_PATH, "auth.json.bak");
    fs.rmSync(OFFICIAL_AUTH_PATH, { force: true });
  }
}

async function activateTuple(state, tupleId, { silent = false, skipProcessCheck = false } = {}) {
  const tuple = requireTuple(state, tupleId);
  if (!skipProcessCheck) {
    assertNoRunningCodexProcesses();
  }
  copySavedAuthToOfficial(tuple.account_id);
  applyManagedConfig(getTupleLoginWorkspaceId(tuple));
  tuple.last_used_at = isoNow();
  state.active_tuple_id = tupleId;
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

function removeTupleAndMaybeAccount(state, tupleId) {
  const tuple = requireTuple(state, tupleId);
  delete state.tuples[tupleId];

  const hasRemainingForAccount = Object.values(state.tuples).some(
    (item) => item.account_id === tuple.account_id,
  );
  if (!hasRemainingForAccount) {
    const dirPath = accountDir(tuple.account_id);
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  }
}

async function deleteTuple(state, tupleId, { silent = false, skipProcessCheck = false } = {}) {
  const tuple = requireTuple(state, tupleId);
  const isActive = tupleId === state.active_tuple_id;
  if (isActive && !skipProcessCheck) {
    assertNoRunningCodexProcesses();
  }

  removeTupleAndMaybeAccount(state, tupleId);

  if (isActive) {
    const remaining = getAllTuples(state);
    if (remaining.length) {
      state.active_tuple_id = null;
      saveState(state);
      await activateTuple(state, remaining[0].tuple_id, {
        silent: true,
        skipProcessCheck,
      });
    } else {
      state.active_tuple_id = null;
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

function getOfficialAuthAccountId() {
  if (!fs.existsSync(OFFICIAL_AUTH_PATH)) {
    return null;
  }
  try {
    return extractAuthMeta(readJson(OFFICIAL_AUTH_PATH)).account_id || null;
  } catch {
    return null;
  }
}

function doctorReport(state) {
  const issues = [];

  if (!fs.existsSync(path.join(process.env.APPDATA || "", "npm", "codex_m.cmd"))) {
    issues.push("Launcher missing: %APPDATA%\\npm\\codex_m.cmd");
  }
  if (!fs.existsSync(path.join(process.env.APPDATA || "", "npm", "codex_m.ps1"))) {
    issues.push("Launcher missing: %APPDATA%\\npm\\codex_m.ps1");
  }

  for (const tuple of Object.values(state.tuples)) {
    if (!fs.existsSync(savedAuthPath(tuple.account_id))) {
      issues.push(`Saved auth missing for tuple ${tuple.tuple_id}`);
    }
  }

  const tuplesByLoginWorkspace = new Map();
  for (const tuple of Object.values(state.tuples)) {
    const loginWorkspaceId = getTupleLoginWorkspaceId(tuple);
    if (!loginWorkspaceId) {
      continue;
    }
    const existing = tuplesByLoginWorkspace.get(loginWorkspaceId) || [];
    existing.push(tuple.tuple_id);
    tuplesByLoginWorkspace.set(loginWorkspaceId, existing);
  }
  for (const [loginWorkspaceId, tupleIds] of tuplesByLoginWorkspace.entries()) {
    if (tupleIds.length > 1) {
      issues.push(
        `Multiple saved tuples share the same real login workspace id ${loginWorkspaceId}: ${tupleIds.join(", ")}`,
      );
    }
  }

  const configText = readOfficialConfigText();
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
  } catch (error) {
    issues.push(String(error.message || error));
  }

  if (state.active_tuple_id) {
    const active = state.tuples[state.active_tuple_id];
    if (!active) {
      issues.push(`active_tuple_id points to a missing tuple: ${state.active_tuple_id}`);
    } else {
      const officialAccountId = getOfficialAuthAccountId();
      const currentWorkspaceId = getCurrentWorkspaceRestriction(configText);
      if (officialAccountId && officialAccountId !== active.account_id) {
        issues.push(
          `Official auth account (${officialAccountId}) does not match active tuple account (${active.account_id})`,
        );
      }
      if (currentWorkspaceId && currentWorkspaceId !== getTupleLoginWorkspaceId(active)) {
        issues.push(
          `Official workspace restriction (${currentWorkspaceId}) does not match active tuple login workspace (${getTupleLoginWorkspaceId(active)})`,
        );
      }
      if (!currentWorkspaceId) {
        issues.push("Official config does not contain forced_chatgpt_workspace_id");
      }
    }
  }

  return issues;
}

function latestMetaForAccount(accountId) {
  return extractAuthMeta(readJson(savedAuthPath(accountId)));
}

function summarizeState(state) {
  const tuples = getAllTuples(state);
  return {
    tuple_count: tuples.length,
    active_tuple_id: state.active_tuple_id,
    tuples: tuples.map((tuple) => ({
      tuple_id: tuple.tuple_id,
      alias: tuple.alias,
      account_email: tuple.account_email,
      account_name: tuple.account_name,
      login_workspace_id: getTupleLoginWorkspaceId(tuple),
      workspace_title: tuple.workspace_title,
      workspace_id: tuple.workspace_id,
      workspace_role: tuple.workspace_role,
      is_active: tuple.tuple_id === state.active_tuple_id,
      created_at: tuple.created_at,
      last_used_at: tuple.last_used_at || null,
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

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function printTupleSummary(state) {
  const tuples = getAllTuples(state);
  const activeId = state.active_tuple_id;
  const currentWorkspace = getCurrentWorkspaceRestriction(readOfficialConfigText());
  const officialAccountId = getOfficialAuthAccountId();

  if (!tuples.length) {
    console.log("No saved tuples.");
    return;
  }

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
  console.log("");
  console.log("* active tuple in manager state");
  console.log("@ real login workspace currently forced in ~/.codex/config.toml");
  console.log("# account currently stored in ~/.codex/auth.json");
}

function printOverview(state) {
  const tuples = getAllTuples(state);
  const active = state.active_tuple_id ? state.tuples[state.active_tuple_id] : null;
  const currentWorkspace = getCurrentWorkspaceRestriction(readOfficialConfigText());
  const processes = detectRunningCodexProcesses();

  console.log("codex_m");
  console.log("");
  console.log(`Saved tuples: ${tuples.length}`);
  console.log(
    `Active tuple: ${active ? `${active.alias} | ${getTupleLoginWorkspaceId(active)}` : "(none)"}`
  );
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
  console.log("  codex_m logout");
  console.log("  codex_m list");
  console.log("  codex_m workspaces [--account-id <id>] [--json]");
  console.log("  codex_m capture");
  console.log("  codex_m import-current");
  console.log("  codex_m add-workspace");
  console.log("  codex_m activate <tuple-id> [--force]");
  console.log("  codex_m rename <tuple-id> --alias <manual-name>");
  console.log("  codex_m delete <tuple-id> [--force]");
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
      this.value = { mode: "menu", tupleId: choice.name };
      await this.close();
      this.emit("submit", this.value);
      return;
    }

    this.manageSubmitMode = "activate";
    return super.submit();
  }
}

function getWizardSummaryLines(state) {
  const active = state.active_tuple_id ? state.tuples[state.active_tuple_id] : null;
  const currentWorkspace = getCurrentWorkspaceRestriction(readOfficialConfigText());
  const processes = detectRunningCodexProcesses();
  return [
    "codex_m",
    `Active: ${active ? `${active.alias} | ${getTupleLoginWorkspaceId(active)}` : "(none)"}`,
    `Forced login workspace: ${currentWorkspace || "(not set)"}`,
    `Saved tuples: ${getAllTuples(state).length}`,
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
  try {
    return await prompt.run();
  } catch {
    return null;
  }
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

function parseOptionValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
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
  saveAccountAuth(meta.account_id, authData);

  const existing = getAllTuples(state).find(
    (tuple) => getTupleLoginWorkspaceId(tuple) === meta.login_workspace_id,
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

  saveAccountAuth(meta.account_id, authData);

  const existing = getAllTuples(state).find(
    (tuple) => getTupleLoginWorkspaceId(tuple) === meta.login_workspace_id,
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

async function handleList(state, args) {
  const json = args.includes("--json");
  if (json) {
    printJson(summarizeState(state));
    return;
  }
  printTupleSummary(state);
}

async function handleWorkspaces(state, args) {
  let accountId = null;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--account-id") {
      accountId = parseOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown workspaces option: ${arg}`);
    }
  }

  const account = await chooseAccount(state, accountId);
  const meta = latestMetaForAccount(account.account_id);
  const payload = meta.organizations.map((workspace) => ({
    workspace_id: workspace.id,
    official_title: workspace.title,
    role: workspace.role || "",
    is_default: Boolean(workspace.is_default),
  }));

  if (json) {
    printJson({
      account_id: account.account_id,
      account_email: account.account_email,
      login_workspace_id: meta.login_workspace_id || account.account_id,
      visible_org_hints: payload,
    });
    return;
  }

  console.log(`Account: ${account.account_email || account.account_id}`);
  console.log(`Real login workspace id: ${meta.login_workspace_id || account.account_id}`);
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

  const result = spawnSync("codex", ["login"], {
    env: {
      ...process.env,
      CODEX_HOME: captureHome,
    },
    stdio: "inherit",
    shell: true,
  });

  if (result.status !== 0) {
    throw new Error(`codex login exited with status ${result.status ?? "unknown"}.`);
  }

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
      throw new Error(`Unknown import-current option: ${arg}`);
    }
  }

  if (!fs.existsSync(OFFICIAL_AUTH_PATH)) {
    throw new Error(`Official auth.json is missing at ${OFFICIAL_AUTH_PATH}`);
  }

  await registerTupleFromAuthData(readJson(OFFICIAL_AUTH_PATH), {
    workspaceId,
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
  const tupleId = args[0];
  if (!tupleId) {
    throw new Error("Usage: codex_m activate <tuple-id> [--force]");
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

  maybeWarnSameRealWorkspace(state, requireTuple(state, tupleId));
  await activateTuple(state, tupleId, { skipProcessCheck: force });
}

async function handleRename(state, args) {
  const tupleId = args[0];
  if (!tupleId) {
    throw new Error("Usage: codex_m rename <tuple-id> --alias <manual-name>");
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
    alias = await promptManualWorkspaceName(null);
  }

  renameTupleAlias(state, tupleId, alias);
  console.log(`Renamed tuple to: ${alias}`);
}

async function handleDelete(state, args) {
  const tupleId = args[0];
  if (!tupleId) {
    throw new Error("Usage: codex_m delete <tuple-id> [--force]");
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

  const tuple = requireTuple(state, tupleId);
  const confirmed = await promptYesNo(
    `Delete '${tuple.alias}' (${tuple.account_email} | ${formatTupleWorkspaceSummary(tuple)})?`,
    false,
  );
  if (!confirmed) {
    console.log("Delete canceled.");
    return;
  }

  await deleteTuple(state, tupleId, { skipProcessCheck: force });
}

async function handleDoctor(state) {
  const issues = doctorReport(state);
  if (!issues.length) {
    console.log("No obvious issues found.");
    return;
  }
  issues.forEach((issue, index) => {
    console.log(`${index + 1}. ${issue}`);
  });
  process.exitCode = 1;
}

async function handleLogin(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: codex_m login [--import-current]");
    return;
  }

  let importCurrent = false;
  for (const arg of args) {
    if (arg === "--import-current") {
      importCurrent = true;
    } else {
      throw new Error(`Unknown login option: ${arg}`);
    }
  }

  if (importCurrent) {
    await handleImportCurrent([]);
    return;
  }

  if (process.stdin.isTTY) {
    await runLoginPage();
    return;
  }

  throw new Error("Use 'codex_m login --import-current' or run 'codex_m login' in an interactive terminal.");
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
  const accounts = summarizeAccounts(state);
  const choices = [];

  for (const account of accounts) {
    choices.push({
      name: `heading:${account.account_id}`,
      role: "heading",
      message: account.account_email || account.account_id,
      hint: `${account.account_name || "unknown name"} | ${account.account_id}`,
    });

    const tuples = getAllTuples(state).filter((tuple) => tuple.account_id === account.account_id);
    for (const tuple of tuples) {
      choices.push({
        name: tuple.tuple_id,
        message: `  ${tuple.alias}`,
        hint: `${formatTupleWorkspaceSummary(tuple)}${tuple.tuple_id === state.active_tuple_id ? " | active" : ""}`,
      });
    }
  }

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
      description: `${tuple.alias} | Tab from Manage opens this menu.`,
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

async function runManagePage() {
  while (true) {
    const state = loadState();
    const selected = await selectChoice({
      title: "Manage",
      description: "Enter applies the selected saved tuple locally. Tab opens Rename or Logout.",
      state,
      promptClass: ManageSelectPrompt,
      extraLines: ["Keys: Up/Down move | Enter apply locally | Tab more actions | Esc back"],
      choices: buildManageChoices(state),
    });

    if (!selected || selected === "__back__") {
      return;
    }

    if (typeof selected === "object" && selected.mode === "menu") {
      await runManageActionsMenu(selected.tupleId);
      return;
    }

    const tuple = requireTuple(loadState(), selected);
    if (loadState().active_tuple_id === tuple.tuple_id) {
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

async function runAccountWorkspacesPage(accountId) {
  while (true) {
    const state = loadState();
    const account = summarizeAccounts(state).find((item) => item.account_id === accountId);
    if (!account) {
      return;
    }

    const tuples = getAllTuples(state).filter((tuple) => tuple.account_id === accountId);
    const meta = latestMetaForAccount(accountId);

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
      description: "Choose the thing you want to do most often.",
      state,
      choices: [
        {
          name: "login",
          message: "Login",
          hint: "start a real codex login, then enter the manual workspace name",
        },
        {
          name: "manage",
          message: "Manage",
          hint: "see accounts and workspaces; Enter applies locally; Tab opens Rename/Logout",
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
    const choice = await selectChoice({
      title: "Login",
      description:
        "Login saves a real Codex login snapshot. After success, you will enter the manual workspace name.",
      state,
      initial: 0,
      choices: [
        {
          name: "fresh_login",
          message: "Start login now",
          hint: "runs codex login in a temporary CODEX_HOME, then asks for the workspace name",
        },
        {
          name: "import_current",
          message: "Use current signed-in Codex",
          hint: "if ~/.codex is already logged in, save that login and ask for the workspace name",
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

      const result = spawnSync("codex", ["login"], {
        env: {
          ...process.env,
          CODEX_HOME: captureHome,
        },
        stdio: "inherit",
        shell: true,
      });

      if (result.status !== 0) {
        throw new Error(`codex login exited with status ${result.status ?? "unknown"}.`);
      }

      const authPath = path.join(captureHome, "auth.json");
      if (!fs.existsSync(authPath)) {
        throw new Error("Login completed without creating auth.json in the temporary CODEX_HOME.");
      }
      await interactiveRegisterTupleFromAuthData(readJson(authPath));
      continue;
    }

    if (choice === "import_current") {
      if (!fs.existsSync(OFFICIAL_AUTH_PATH)) {
        throw new Error(`Official auth.json is missing at ${OFFICIAL_AUTH_PATH}`);
      }
      await interactiveRegisterTupleFromAuthData(readJson(OFFICIAL_AUTH_PATH));
    }
  }
}

async function runDoctorPage() {
  while (true) {
    const state = loadState();
    const issues = doctorReport(state);
    const choice = await selectChoice({
      title: "Doctor",
      description: issues.length
        ? `Found ${issues.length} issue(s). Enter to rerun or Esc to go back.`
        : "No obvious issues found. Enter to rerun or Esc to go back.",
      state,
      choices: [
        ...(issues.length
          ? issues.map((issue, index) => ({
              name: `issue_${index}`,
              message: issue,
              hint: "issue",
            }))
          : [
              {
                name: "healthy",
                message: "No obvious issues found",
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
    description: "Use Home first for the common flow: switch, login, logout. Esc returns.",
    state,
    choices: [
      {
        name: "home",
        message: "Home page gives the fastest path to switch, login, and logout",
        hint: "recommended starting point",
      },
      {
        name: "keys",
        message: "Keys: Up/Down move | Enter open | Esc back",
        hint: "navigation",
      },
      {
        name: "manual_name",
        message: "Workspace display names are always entered manually",
        hint: "official title is metadata only",
      },
      {
        name: "logout_scope",
        message: "Logout removes only the selected saved workspace tuple",
        hint: "not the whole account",
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

Stable CLI manager for real Codex ChatGPT login snapshots on Windows.

Usage:
  codex_m
  codex_m menu
  codex_m switch [<tuple-id>] [--force]
  codex_m login [--import-current]
  codex_m logout [<tuple-id>] [--force]
  codex_m list [--json]
  codex_m workspaces [--account-id <id>] [--json]
  codex_m capture [--workspace-id <id>] [--alias <manual-name>] [--activate|--no-activate] [--force]
  codex_m import-current [--workspace-id <id>] [--alias <manual-name>] [--activate|--no-activate] [--force]
  codex_m add-workspace
  codex_m activate <tuple-id> [--force]
  codex_m rename <tuple-id> --alias <manual-name>
  codex_m delete <tuple-id> [--force]
  codex_m doctor

Notes:
  - Running plain 'codex_m' opens a simple Home page with Login, Manage, and Quit.
  - In Manage, Enter applies the selected real login snapshot and Tab opens Rename/Logout.
  - Workspace display names are always manual. Official titles are metadata only.
  - Use 'codex_m workspaces' to inspect visible organization ids from a login token. They are informational hints only.
  - Codex enforces the real login workspace via the token's 'chatgpt_account_id', not via organizations[].id.
  - codex_m automatically compacts duplicate saved items that share the same real login workspace id.
  - 'add-workspace' is disabled because codex_m can only save a real login snapshot returned by Codex.
  - 'logout' removes only the selected saved workspace tuple.
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
