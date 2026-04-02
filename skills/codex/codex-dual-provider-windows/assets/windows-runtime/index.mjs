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
import { DatabaseSync } from "node:sqlite";
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
const PROVIDER_MODE_COMPAT = "compat";
const PROVIDER_MODE_STABLE_HTTP = "stable_http";
const PROVIDER_MODE_API111 = "api111";
const DEFAULT_STABLE_HTTP_PROVIDER_ID = "sub2api";
const DEFAULT_API111_PROVIDER_ID = "api111";

function resolveManagerHome() {
  const envHome = process.env.CODEX_THIRD_PARTY_MANAGER_HOME;
  if (envHome && String(envHome).trim()) {
    return path.resolve(String(envHome).trim());
  }
  return path.join(os.homedir(), ".codex3-manager");
}

function resolveManagerCommandName() {
  const envCommand = process.env.CODEX_THIRD_PARTY_MANAGER_COMMAND;
  if (envCommand && String(envCommand).trim()) {
    return String(envCommand).trim();
  }
  return "codex3_m";
}

function resolveLauncherDir() {
  const envDir = process.env.CODEX_THIRD_PARTY_LAUNCHER_DIR;
  if (envDir && String(envDir).trim()) {
    return path.resolve(String(envDir).trim());
  }
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "npm")
    : path.join(os.homedir(), ".local", "bin");
}

const MANAGER_HOME = resolveManagerHome();
const MANAGER_COMMAND_NAME = resolveManagerCommandName();
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
const LAUNCHER_DIR = resolveLauncherDir();

const DEFAULT_THIRD_PARTY_HOME = path.join(os.homedir(), ".codex-apikey");
const DEFAULT_SHARED_CODEX_HOME = path.join(os.homedir(), ".codex");
const SHARED_SESSION_RELATIVE_PATHS = ["sessions", "archived_sessions"];
const SHARED_SESSION_INDEX_FILE = "session_index.jsonl";
const OFFICIAL_HOME = path.join(os.homedir(), ".codex");
const OFFICIAL_CLI_HOME = path.join(os.homedir(), ".codex-official");
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
  preferred_auth_method: null,
  requires_openai_auth: null,
  supports_websockets: null,
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

function readRecentSessionIndexEntries(homePath) {
  const entries = [];
  const filePath = path.join(homePath, "session_index.jsonl");
  if (!pathExists(filePath)) {
    return entries;
  }

  const text = readText(filePath);
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line);
      if (parsed?.id) {
        entries.push(parsed);
      }
    } catch {
      // ignore malformed recent-session index lines
    }
  }
  return entries;
}

function findRecentRolloutsById(sharedHome, wantedIds) {
  const found = new Map();
  const wanted = new Set(wantedIds.filter(Boolean));
  if (!wanted.size) {
    return found;
  }

  for (const bucketName of ["sessions", "archived_sessions"]) {
    const root = path.join(sharedHome, bucketName);
    if (!pathExists(root)) {
      continue;
    }

    const stack = [root];
    while (stack.length && found.size < wanted.size) {
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
        if (!rolloutId || !wanted.has(rolloutId)) {
          continue;
        }

        found.set(rolloutId, {
          bucketName,
          root,
          fullPath,
        });
      }
    }
  }

  return found;
}

function toUnixTimestampSeconds(value) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.floor(parsed / 1000);
}

function extractTextContent(content) {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((item) => item?.type === "input_text" || item?.type === "output_text")
    .map((item) => String(item.text || ""))
    .join("\n")
    .trim();
}

function readRolloutPreviewText(rolloutPath, maxBytes = 256 * 1024) {
  const handle = fs.openSync(rolloutPath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(handle, buffer, 0, maxBytes, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    fs.closeSync(handle);
  }
}

function copyDatabaseWithSidecars(sourceDbPath, destDbPath) {
  fs.copyFileSync(sourceDbPath, destDbPath);
  for (const suffix of ["-wal", "-shm"]) {
    const sourceSidecar = `${sourceDbPath}${suffix}`;
    if (pathExists(sourceSidecar)) {
      fs.copyFileSync(sourceSidecar, `${destDbPath}${suffix}`);
    }
  }
}

function removeDatabaseSidecars(dbPath) {
  for (const suffix of ["-wal", "-shm"]) {
    const sidecarPath = `${dbPath}${suffix}`;
    if (pathExists(sidecarPath)) {
      fs.rmSync(sidecarPath, { force: true });
    }
  }
}

function parseThreadRowFromRollout(rolloutPath, fallbackTitle) {
  const text = readRolloutPreviewText(rolloutPath);
  const lines = text.split(/\r?\n/);

  let sessionMeta = null;
  let turnContext = null;
  let firstUserMessage = "";

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (!sessionMeta && parsed.type === "session_meta") {
      sessionMeta = parsed.payload || null;
      continue;
    }

    if (!turnContext && parsed.type === "turn_context") {
      turnContext = parsed.payload || null;
      continue;
    }

    if (!firstUserMessage && parsed.type === "response_item" && parsed.payload?.role === "user") {
      firstUserMessage = extractTextContent(parsed.payload.content);
    }

    if (sessionMeta && turnContext && firstUserMessage) {
      break;
    }
  }

  const createdAtIso = sessionMeta?.timestamp || null;
  return {
    id: sessionMeta?.id || null,
    created_at: toUnixTimestampSeconds(createdAtIso),
    updated_at: toUnixTimestampSeconds(createdAtIso),
    source: String(sessionMeta?.source || "cli"),
    model_provider: String(sessionMeta?.model_provider || ""),
    cwd: String(sessionMeta?.cwd || turnContext?.cwd || ""),
    title: fallbackTitle || firstUserMessage || sessionMeta?.id || path.basename(rolloutPath),
    sandbox_policy: JSON.stringify(turnContext?.sandbox_policy || { type: "workspace-write" }),
    approval_mode: String(turnContext?.approval_policy || "on-request"),
    tokens_used: 0,
    has_user_event: firstUserMessage ? 1 : 0,
    archived: 0,
    archived_at: null,
    git_sha: sessionMeta?.git?.sha || null,
    git_branch: sessionMeta?.git?.branch || null,
    git_origin_url: sessionMeta?.git?.origin_url || null,
    cli_version: String(sessionMeta?.cli_version || ""),
    first_user_message: firstUserMessage || "",
    agent_nickname: null,
    agent_role: null,
    memory_mode: String(turnContext?.memory_mode || "enabled"),
    model: turnContext?.model || null,
    reasoning_effort: turnContext?.effort || null,
  };
}

function buildRecentSharedThreadRows(sharedHome, targetHome) {
  const indexEntries = readRecentSessionIndexEntries(sharedHome);
  const found = findRecentRolloutsById(
    sharedHome,
    indexEntries.map((entry) => entry.id),
  );
  const rows = [];

  for (const entry of indexEntries) {
    const located = found.get(entry.id);
    if (!located) {
      continue;
    }

    const row = parseThreadRowFromRollout(located.fullPath, entry.thread_name || "");
    if (!row.id) {
      continue;
    }

    row.archived = located.bucketName === "archived_sessions" ? 1 : 0;
    row.archived_at = row.archived ? row.updated_at : null;
    row.updated_at = Math.max(row.updated_at, toUnixTimestampSeconds(entry.updated_at || ""));
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
  const indexEntries = readRecentSessionIndexEntries(sharedHome);
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

        const row = parseThreadRowFromRollout(fullPath, indexEntry?.thread_name || "");
        if (!row.id) {
          continue;
        }

        row.archived = bucketName === "archived_sessions" ? 1 : 0;
        row.archived_at = row.archived ? row.updated_at : null;
        row.updated_at = Math.max(row.updated_at, toUnixTimestampSeconds(indexEntry?.updated_at || ""));
        row.title = indexEntry?.thread_name || row.title;
        row.rollout_path = path.join(targetHome, bucketName, path.relative(root, fullPath));
        rows.push(row);
      }
    }
  }

  return rows;
}

function syncSharedThreadMetadata(sharedHome, targetHome, { scope = "recent" } = {}) {
  const targetDbPath = path.join(targetHome, "state_5.sqlite");
  if (!pathExists(targetDbPath)) {
    return { scanned: 0, upserted: 0, skipped: "missing_state_db" };
  }

  const rows =
    scope === "all"
      ? buildAllSharedThreadRows(sharedHome, targetHome)
      : buildRecentSharedThreadRows(sharedHome, targetHome);
  if (!rows.length) {
    return { scanned: 0, upserted: 0, skipped: "no_recent_threads" };
  }

  function applyRows(dbPath) {
    const db = new DatabaseSync(dbPath);
    try {
      const columns = db.prepare(`PRAGMA table_info("threads")`).all().map((row) => row.name);
      if (!columns.length) {
        return { scanned: rows.length, upserted: 0, skipped: "missing_threads_table" };
      }

      const usableColumns = columns.filter((name) =>
        rows.some((row) => Object.hasOwn(row, name)),
      );
      const placeholders = usableColumns.map(() => "?").join(", ");
      const updateClause = usableColumns
        .filter((name) => name !== "id")
        .map((name) => `${name} = excluded.${name}`)
        .join(", ");

      const sql = `
        INSERT INTO threads (${usableColumns.join(", ")})
        VALUES (${placeholders})
        ON CONFLICT(id) DO UPDATE SET ${updateClause}
      `;
      const statement = db.prepare(sql);

      db.exec("BEGIN");
      try {
        for (const row of rows) {
          statement.run(
            ...usableColumns.map((name) => (Object.hasOwn(row, name) ? row[name] : null)),
          );
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      return { scanned: rows.length, upserted: rows.length, scope };
    } finally {
      db.close();
    }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-thread-sync-"));
  const tmpDbPath = path.join(tmpDir, "state_5.sqlite");
  try {
    copyDatabaseWithSidecars(targetDbPath, tmpDbPath);
    const result = applyRows(tmpDbPath);
    removeDatabaseSidecars(targetDbPath);
    fs.copyFileSync(tmpDbPath, targetDbPath);
    return {
      ...result,
      repaired_from_copy: true,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function getManagedThreadSyncTargets(provider) {
  return Array.from(
    new Set([provider.third_party_home, provider.shared_codex_home, OFFICIAL_CLI_HOME]),
  );
}

function syncManagedThreadMetadata(provider, { scope = "recent" } = {}) {
  const results = [];
  for (const targetHome of getManagedThreadSyncTargets(provider)) {
    try {
      results.push({
        targetHome,
        ...syncSharedThreadMetadata(provider.shared_codex_home, targetHome, { scope }),
      });
    } catch (error) {
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
  if (normalized === PROVIDER_MODE_STABLE_HTTP) {
    return PROVIDER_MODE_STABLE_HTTP;
  }
  if (normalized === PROVIDER_MODE_API111) {
    return PROVIDER_MODE_API111;
  }
  return PROVIDER_MODE_COMPAT;
}

function providerModeCliLabel(mode) {
  const normalized = normalizeProviderMode(mode);
  if (normalized === PROVIDER_MODE_STABLE_HTTP) {
    return "stable-http";
  }
  if (normalized === PROVIDER_MODE_API111) {
    return "api111";
  }
  return "compat";
}

function getModeDefaults(mode) {
  switch (normalizeProviderMode(mode)) {
    case PROVIDER_MODE_STABLE_HTTP:
      return {
        provider_name: DEFAULT_STABLE_HTTP_PROVIDER_ID,
        base_url: "https://sub.aimizy.com",
        model: "gpt-5.4",
        review_model: "gpt-5.4",
        model_reasoning_effort: "xhigh",
        preferred_auth_method: null,
        requires_openai_auth: true,
        supports_websockets: false,
      };
    case PROVIDER_MODE_API111:
      return {
        provider_name: DEFAULT_API111_PROVIDER_ID,
        base_url: "https://api.xcode.best/v1",
        model: "gpt-5-codex",
        review_model: null,
        model_reasoning_effort: "high",
        preferred_auth_method: "apikey",
        requires_openai_auth: null,
        supports_websockets: null,
      };
    default:
      return {
        provider_name: "openai",
        base_url: "https://sub.aimizy.com",
        model: "gpt-5.4",
        review_model: "gpt-5.4",
        model_reasoning_effort: "xhigh",
        preferred_auth_method: null,
        requires_openai_auth: null,
        supports_websockets: null,
      };
  }
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizeOptionalString(value) {
  if (value == null) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed || null;
}

function normalizeOptionalBoolean(value) {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return null;
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
  const modeDefaults = getModeDefaults(mode);
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
      normalizeOptionalString(provider.provider_name) || modeDefaults.provider_name,
    base_url:
      (normalizeOptionalString(provider.base_url) || modeDefaults.base_url).replace(/\/+$/, ""),
    model:
      normalizeOptionalString(provider.model) || modeDefaults.model,
    review_model:
      hasOwn(provider, "review_model")
        ? normalizeOptionalString(provider.review_model)
        : modeDefaults.review_model,
    model_reasoning_effort:
      normalizeOptionalString(provider.model_reasoning_effort) ||
      modeDefaults.model_reasoning_effort,
    preferred_auth_method:
      hasOwn(provider, "preferred_auth_method")
        ? normalizeOptionalString(provider.preferred_auth_method)
        : modeDefaults.preferred_auth_method,
    requires_openai_auth:
      hasOwn(provider, "requires_openai_auth")
        ? normalizeOptionalBoolean(provider.requires_openai_auth)
        : modeDefaults.requires_openai_auth,
    supports_websockets:
      hasOwn(provider, "supports_websockets")
        ? normalizeOptionalBoolean(provider.supports_websockets)
        : modeDefaults.supports_websockets,
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

function sharedSessionIndexLinkPath(provider) {
  return path.join(provider.third_party_home, SHARED_SESSION_INDEX_FILE);
}

function sharedSessionIndexTargetPath(provider) {
  return path.join(provider.shared_codex_home, SHARED_SESSION_INDEX_FILE);
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
  const lines = ['cli_auth_credentials_store = "file"'];

  if (usesBuiltInOpenAiProvider(provider)) {
    lines.push(
      'model_provider = "openai"',
      `openai_base_url = "${effectiveOpenAiBaseUrl(provider)}"`,
    );
  } else {
    lines.push(`model_provider = "${provider.provider_name}"`);
  }

  lines.push(`model = "${provider.model}"`);
  if (provider.review_model) {
    lines.push(`review_model = "${provider.review_model}"`);
  }
  lines.push(`model_reasoning_effort = "${provider.model_reasoning_effort}"`);
  lines.push("disable_response_storage = true");
  if (provider.preferred_auth_method) {
    lines.push(`preferred_auth_method = "${provider.preferred_auth_method}"`);
  }
  lines.push('network_access = "enabled"');
  lines.push("windows_wsl_setup_acknowledged = true");
  lines.push(`model_context_window = ${provider.model_context_window}`);
  lines.push(`model_auto_compact_token_limit = ${provider.model_auto_compact_token_limit}`);

  if (!usesBuiltInOpenAiProvider(provider)) {
    lines.push("");
    lines.push(`[model_providers.${provider.provider_name}]`);
    lines.push(`name = "${provider.provider_name}"`);
    lines.push(`base_url = "${provider.base_url}"`);
    lines.push('wire_api = "responses"');
    if (provider.requires_openai_auth != null) {
      lines.push(`requires_openai_auth = ${provider.requires_openai_auth ? "true" : "false"}`);
    }
    if (provider.supports_websockets != null) {
      lines.push(`supports_websockets = ${provider.supports_websockets ? "true" : "false"}`);
    }
  }

  lines.push("", "[features]", "apps = false", "");
  const text = lines.join("\n");

  ensureDir(provider.third_party_home);
  backupFileIfExists(thirdPartyConfigPath(provider), "codex3-config.toml.bak");
  writeText(thirdPartyConfigPath(provider), text);
}

function buildPlainCodexThirdPartyTopLevelEntries(provider) {
  const entries = {
    cli_auth_credentials_store: '"file"',
    model_provider: JSON.stringify(provider.provider_name),
    model: JSON.stringify(provider.model),
    model_reasoning_effort: JSON.stringify(provider.model_reasoning_effort),
    disable_response_storage: "true",
    network_access: '"enabled"',
    windows_wsl_setup_acknowledged: "true",
    model_context_window: String(provider.model_context_window),
    model_auto_compact_token_limit: String(provider.model_auto_compact_token_limit),
  };
  if (provider.review_model) {
    entries.review_model = JSON.stringify(provider.review_model);
  }
  if (provider.preferred_auth_method) {
    entries.preferred_auth_method = JSON.stringify(provider.preferred_auth_method);
  }
  if (usesBuiltInOpenAiProvider(provider)) {
    entries.openai_base_url = JSON.stringify(effectiveOpenAiBaseUrl(provider));
  }
  return entries;
}

function buildPlainCodexThirdPartyProviderTableEntries(provider) {
  if (usesBuiltInOpenAiProvider(provider)) {
    return null;
  }
  const entries = {
    name: JSON.stringify(provider.provider_name),
    base_url: JSON.stringify(provider.base_url),
    wire_api: JSON.stringify("responses"),
  };
  if (provider.requires_openai_auth != null) {
    entries.requires_openai_auth = provider.requires_openai_auth ? "true" : "false";
  }
  if (provider.supports_websockets != null) {
    entries.supports_websockets = provider.supports_websockets ? "true" : "false";
  }
  return entries;
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
    `model_providers.${DEFAULT_API111_PROVIDER_ID}`,
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
    "-GlobalBinDir",
    LAUNCHER_DIR,
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
    "-ModelReasoningEffort",
    provider.model_reasoning_effort,
    "-ModelContextWindow",
    String(provider.model_context_window),
    "-ModelAutoCompactTokenLimit",
    String(provider.model_auto_compact_token_limit),
  ];

  if (provider.review_model) {
    args.push("-ReviewModel", provider.review_model);
  }
  if (provider.preferred_auth_method) {
    args.push("-PreferredAuthMethod", provider.preferred_auth_method);
  }
  if (provider.requires_openai_auth != null) {
    args.push("-RequiresOpenAiAuth", String(provider.requires_openai_auth));
  }
  if (provider.supports_websockets != null) {
    args.push("-SupportsWebsockets", String(provider.supports_websockets));
  }

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
  try {
    syncManagedThreadMetadata(provider, { scope: "recent" });
  } catch (error) {
    if (!silent) {
      console.warn(`Warning: failed to sync recent shared threads: ${error.message}`);
    }
  }

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
      `No active third-party profile is selected. Use Manage first so ${MANAGER_COMMAND_NAME} knows which profile plain codex should follow.`,
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
    source: MANAGER_COMMAND_NAME,
    provider_name: provider.provider_name,
    provider_base_url: provider.base_url,
    active_profile_id: activeProfileId,
  });

  if (!silent) {
    const profile = requireProfile(state, activeProfileId);
    console.log(
      `Plain codex now follows ${provider.command_name} using third-party profile: ${profile.alias} | ${readSavedProfileMaskedKey(profile.profile_id)}`,
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
    path.join(LAUNCHER_DIR, `${MANAGER_COMMAND_NAME}.ps1`),
    path.join(LAUNCHER_DIR, `${MANAGER_COMMAND_NAME}.cmd`),
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
    const requiredSnippets = ['cli_auth_credentials_store = "file"'];
    if (usesBuiltInOpenAiProvider(provider)) {
      requiredSnippets.push(
        'model_provider = "openai"',
        `openai_base_url = "${effectiveOpenAiBaseUrl(provider)}"`,
      );
    } else {
      requiredSnippets.push(
        `model_provider = "${provider.provider_name}"`,
        `base_url = "${provider.base_url}"`,
      );
    }
    requiredSnippets.push(
      `model = "${provider.model}"`,
      `model_reasoning_effort = "${provider.model_reasoning_effort}"`,
      `model_context_window = ${provider.model_context_window}`,
      `model_auto_compact_token_limit = ${provider.model_auto_compact_token_limit}`,
    );
    if (provider.review_model) {
      requiredSnippets.push(`review_model = "${provider.review_model}"`);
    }
    if (provider.preferred_auth_method) {
      requiredSnippets.push(`preferred_auth_method = "${provider.preferred_auth_method}"`);
    }
    if (!usesBuiltInOpenAiProvider(provider) && provider.requires_openai_auth != null) {
      requiredSnippets.push(
        `requires_openai_auth = ${provider.requires_openai_auth ? "true" : "false"}`,
      );
    }
    if (!usesBuiltInOpenAiProvider(provider) && provider.supports_websockets != null) {
      requiredSnippets.push(
        `supports_websockets = ${provider.supports_websockets ? "true" : "false"}`,
      );
    }
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
    MANAGER_COMMAND_NAME,
    `Command: ${provider.command_name}`,
    `Mode: ${providerModeCliLabel(provider.mode)}`,
    `Provider: ${provider.provider_name} | ${provider.base_url}`,
    `Model: ${provider.model} | review ${provider.review_model || "(none)"}`,
    `Active profile: ${activeProfile ? `${activeProfile.alias} | ${readSavedProfileMaskedKey(activeProfile.profile_id)}` : "(none)"}`,
    `Saved third-party API key profiles: ${getProfiles(state).length}`,
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
      ? await promptYesNo(`Activate this third-party profile for ${normalizeProvider(state.provider).command_name} now?`, true)
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
    `Use this third-party API key profile for ${normalizeProvider(state.provider).command_name} now?`,
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
  console.log(MANAGER_COMMAND_NAME);
  console.log("");
  console.log(`Command: ${provider.command_name}`);
  console.log(`Third-party home: ${provider.third_party_home}`);
  console.log(`Shared Codex home: ${provider.shared_codex_home}`);
  console.log(`Provider: ${provider.provider_name} | ${provider.base_url}`);
  console.log(`Model: ${provider.model} | review ${provider.review_model || "(none)"}`);
  console.log(`Plain codex mode: ${plainCodexMode}`);
  console.log(`Saved profiles: ${getProfiles(state).length}`);
  console.log(
    `Active profile: ${state.active_profile_id ? `${requireProfile(state, state.active_profile_id).alias} | ${readSavedProfileMaskedKey(state.active_profile_id)}` : "(none)"}`,
  );
  console.log("");
  printProfileSummary(state);
  console.log("");
  console.log("Commands:");
  console.log(`  ${MANAGER_COMMAND_NAME} login`);
  console.log(`  ${MANAGER_COMMAND_NAME} list`);
  console.log(`  ${MANAGER_COMMAND_NAME} activate <profile-id> [--force]`);
  console.log(`  ${MANAGER_COMMAND_NAME} rename <profile-id> --alias <manual-name>`);
  console.log(`  ${MANAGER_COMMAND_NAME} delete <profile-id> [--force]`);
  console.log(`  ${MANAGER_COMMAND_NAME} use-codex3 [--force]`);
  console.log(`  ${MANAGER_COMMAND_NAME} sync-threads [--all] [--force]`);
  console.log(`  ${MANAGER_COMMAND_NAME} mode show`);
  console.log(`  ${MANAGER_COMMAND_NAME} mode set <compat|stable-http|api111>`);
  console.log(`  ${MANAGER_COMMAND_NAME} provider show`);
  console.log(`  ${MANAGER_COMMAND_NAME} provider set`);
  console.log(`  ${MANAGER_COMMAND_NAME} doctor`);
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
      description: "Enter applies the selected third-party API key profile locally. Tab opens Rename or Delete.",
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
      title: "Provider (Advanced)",
      description: `Inspect or update the third-party provider settings and shared session home used by ${provider.command_name}. Saved API key profiles remain the primary identity model.`,
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
              : providerModeCliLabel(provider.mode) === "stable-http"
                ? "stable-http | disable websocket path"
                : "api111 | tutorial-matched custom provider",
        },
        {
          name: "set",
          message: "Edit provider settings",
          hint: `${provider.command_name} | ${provider.model}`,
        },
        {
          name: "reinstall",
          message: `Reinstall ${provider.command_name} wrapper`,
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
        title: "Advanced Provider Settings",
        description: "Esc returns.",
        state,
        choices: [
          { name: "command", message: `Command: ${provider.command_name}`, hint: "wrapper command" },
          { name: "mode", message: `Mode: ${providerModeCliLabel(provider.mode)}`, hint: "compat or stable-http" },
          { name: "home", message: `Third-party home: ${provider.third_party_home}`, hint: "stores third-party auth and provider mirror config" },
          { name: "shared_home", message: `Shared Codex home: ${provider.shared_codex_home}`, hint: "sessions, archived_sessions, and session_index.jsonl are shared from here" },
          { name: "provider", message: `Provider: ${provider.provider_name}`, hint: "derived from mode" },
          { name: "url", message: `Base URL: ${provider.base_url}`, hint: "OpenAI-compatible endpoint" },
          { name: "model", message: `Model: ${provider.model}`, hint: "default model" },
          { name: "review_model", message: `Review model: ${provider.review_model || "(none)"}`, hint: "tutorial review_model" },
          { name: "auth_method", message: `Preferred auth method: ${provider.preferred_auth_method || "(none)"}`, hint: "tutorial preferred_auth_method" },
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
          "Choose the provider shape written into the third-party config and wrapper overrides. Compat aligns with openai for visibility, stable-http disables websocket routing, and api111 matches the newer tutorial.",
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
            name: PROVIDER_MODE_API111,
            message: "api111",
            hint: "matches the newer tutorial shape with provider id api111 and preferred_auth_method=apikey",
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
      (await promptInputPrompt("Review model:", provider.review_model || "")) || provider.review_model;
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
      description: "Save a third-party API key profile while keeping auth isolated and sharing only the default session metadata targets.",
      state,
      choices: [
        {
          name: "add",
          message: "Add third-party API key now",
          hint: `prompts for API key and saves it under ${MANAGER_HOME}`,
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
      description: "Manage third-party API key profiles for codex3. codex CLI stays official; codex.exe only changes which lane Desktop follows.",
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
          hint: "switch, rename, or delete saved third-party API key profiles",
        },
        {
          name: "provider",
          message: "Provider (Advanced)",
          hint: `edit shared wrapper/provider settings for ${normalizeProvider(state.provider).command_name}`,
        },
        {
          name: "use_codex3",
          message: `Plain codex -> ${normalizeProvider(state.provider).command_name}`,
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
      const decision = await interactiveResolveForce("codex.exe bridge");
      if (!decision.proceed) {
        console.log("codex.exe bridge canceled.");
        continue;
      }
      await setPlainCodexThirdPartyMode(loadState(), { skipProcessCheck: decision.force });
      return;
    }
    await runProviderPage();
  }
}

function printHelp() {
  const provider = normalizeProvider(loadState().provider);
  console.log(`${MANAGER_COMMAND_NAME}

Machine-local manager for isolated ${provider.command_name} auth plus shared session directories on Windows.

Usage:
  ${MANAGER_COMMAND_NAME}
  ${MANAGER_COMMAND_NAME} menu
  ${MANAGER_COMMAND_NAME} login [--import-current] [--alias <manual-name>] [--activate|--no-activate] [--force]
  ${MANAGER_COMMAND_NAME} list [--json]
  ${MANAGER_COMMAND_NAME} activate <profile-id> [--force]
  ${MANAGER_COMMAND_NAME} rename <profile-id> --alias <manual-name>
  ${MANAGER_COMMAND_NAME} delete <profile-id> [--force]
  ${MANAGER_COMMAND_NAME} use-codex3 [--force]
  ${MANAGER_COMMAND_NAME} sync-threads [--all] [--force]
  ${MANAGER_COMMAND_NAME} mode show
  ${MANAGER_COMMAND_NAME} mode set <compat|stable-http|api111>
  ${MANAGER_COMMAND_NAME} provider show [--json]
  ${MANAGER_COMMAND_NAME} provider set [--mode <compat|stable-http|api111>] [--command-name <name>] [--third-party-home <path>] [--shared-codex-home <path>] [--provider-name <name>] [--base-url <url>] [--model <name>] [--review-model <name>] [--preferred-auth-method <name>] [--requires-openai-auth <true|false>] [--supports-websockets <true|false>] [--model-reasoning-effort <name>] [--model-context-window <n>] [--model-auto-compact-token-limit <n>]
  ${MANAGER_COMMAND_NAME} doctor

Notes:
  - Running plain '${MANAGER_COMMAND_NAME}' opens a Home page with Login, Manage, Provider (Advanced), Plain codex -> ${provider.command_name}, and Quit.
  - ${MANAGER_COMMAND_NAME} manages saved third-party API key profiles first; provider and mode settings are advanced compatibility tools.
  - ${provider.command_name} always uses the isolated third-party home managed by ${MANAGER_COMMAND_NAME}.
  - Plain codex follow-mode does not replace the launcher or swap the whole home.
  - The default shared targets are sessions, archived_sessions, and session_index.jsonl.
  - compat mode keeps third-party auth outside ~/.codex and aligns provider id with the built-in openai lane for better recent-session visibility.
  - stable-http mode uses a custom provider id with supports_websockets=false for gateways that reconnect too often.
  - api111 mode matches the newer tutorial shape with provider id api111 and preferred_auth_method=apikey.
  - The provider mirror config lives under ${provider.third_party_home}\\config.toml by default and records the tutorial values applied to ${provider.command_name}.
  - Saved third-party API key profiles live under ${MANAGER_HOME}\\profiles\\.
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
      `Use '${MANAGER_COMMAND_NAME} login --import-current' or run '${MANAGER_COMMAND_NAME} login' in an interactive terminal.`,
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
    throw new Error(`Usage: ${MANAGER_COMMAND_NAME} activate <profile-id> [--force]`);
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
    const decision = await interactiveResolveForce("codex.exe bridge");
    if (!decision.proceed) {
      console.log("codex.exe bridge canceled.");
      return;
    }
    force = decision.force;
  }

  await setPlainCodexThirdPartyMode(state, { skipProcessCheck: force });
}

async function handleRename(state, args) {
  const profileId = args[0];
  if (!profileId) {
    throw new Error(`Usage: ${MANAGER_COMMAND_NAME} rename <profile-id> --alias <manual-name>`);
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
    throw new Error(`Usage: ${MANAGER_COMMAND_NAME} delete <profile-id> [--force]`);
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
  console.log(`Review model     : ${provider.review_model || "(none)"}`);
  console.log(`Preferred auth   : ${provider.preferred_auth_method || "(none)"}`);
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
  const providedKeys = new Set();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--command-name") {
      next.command_name = parseOptionValue(args, index, arg);
      providedKeys.add("command_name");
      index += 1;
    } else if (arg === "--mode") {
      next.mode = normalizeProviderMode(parseOptionValue(args, index, arg));
      providedKeys.add("mode");
      index += 1;
    } else if (arg === "--third-party-home") {
      next.third_party_home = parseOptionValue(args, index, arg);
      providedKeys.add("third_party_home");
      index += 1;
    } else if (arg === "--shared-codex-home") {
      next.shared_codex_home = parseOptionValue(args, index, arg);
      providedKeys.add("shared_codex_home");
      index += 1;
    } else if (arg === "--provider-name") {
      next.provider_name = parseOptionValue(args, index, arg);
      providedKeys.add("provider_name");
      index += 1;
    } else if (arg === "--base-url") {
      next.base_url = parseOptionValue(args, index, arg);
      providedKeys.add("base_url");
      index += 1;
    } else if (arg === "--model") {
      next.model = parseOptionValue(args, index, arg);
      providedKeys.add("model");
      index += 1;
    } else if (arg === "--review-model") {
      next.review_model = parseOptionValue(args, index, arg);
      providedKeys.add("review_model");
      index += 1;
    } else if (arg === "--preferred-auth-method") {
      next.preferred_auth_method = parseOptionValue(args, index, arg);
      providedKeys.add("preferred_auth_method");
      index += 1;
    } else if (arg === "--requires-openai-auth") {
      next.requires_openai_auth = parseOptionValue(args, index, arg);
      providedKeys.add("requires_openai_auth");
      index += 1;
    } else if (arg === "--supports-websockets") {
      next.supports_websockets = parseOptionValue(args, index, arg);
      providedKeys.add("supports_websockets");
      index += 1;
    } else if (arg === "--model-reasoning-effort") {
      next.model_reasoning_effort = parseOptionValue(args, index, arg);
      providedKeys.add("model_reasoning_effort");
      index += 1;
    } else if (arg === "--model-context-window") {
      next.model_context_window = parseOptionValue(args, index, arg);
      providedKeys.add("model_context_window");
      index += 1;
    } else if (arg === "--model-auto-compact-token-limit") {
      next.model_auto_compact_token_limit = parseOptionValue(args, index, arg);
      providedKeys.add("model_auto_compact_token_limit");
      index += 1;
    } else {
      throw new Error(`Unknown provider set option: ${arg}`);
    }
  }

  if (providedKeys.has("mode")) {
    for (const resetKey of [
      "provider_name",
      "base_url",
      "model",
      "review_model",
      "preferred_auth_method",
      "requires_openai_auth",
      "supports_websockets",
      "model_reasoning_effort",
    ]) {
      if (!providedKeys.has(resetKey)) {
        delete next[resetKey];
      }
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
      throw new Error(`Usage: ${MANAGER_COMMAND_NAME} mode set <compat|stable-http|api111>`);
    }
    await handleProviderSet(["--mode", modeArg]);
    return;
  }
  throw new Error(`Unknown mode subcommand: ${subcommand}`);
}

async function handleDoctor(state) {
  const { issues, warnings } = doctorReport(state);
  if (!issues.length) {
    console.log("No blocking issues found for the third-party lane.");
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

  const sessionIndexTargetPath = sharedSessionIndexTargetPath(provider);
  const sessionIndexLinkPath = sharedSessionIndexLinkPath(provider);
  if (!fs.existsSync(sessionIndexTargetPath)) {
    warnings.push(`Shared session index target does not exist yet: ${sessionIndexTargetPath}`);
  } else if (!fs.existsSync(sessionIndexLinkPath)) {
    issues.push(`Shared session index is missing from third-party home: ${sessionIndexLinkPath}`);
  } else if (!filesShareIdentity(sessionIndexLinkPath, sessionIndexTargetPath)) {
    issues.push(
      `Shared session index is not hard-linked to the shared Codex home: ${sessionIndexLinkPath} -> ${sessionIndexTargetPath}`,
    );
  }

  if (!force) {
    assertNoRunningCodexProcesses();
  }

  const provider = normalizeProvider(state.provider);
  const results = syncManagedThreadMetadata(provider, { scope });
  results.forEach((result) => {
    if (result.error) {
      console.log(`Failed to sync shared thread metadata into ${result.targetHome}: ${result.error}`);
      return;
    }
    console.log(`Synced ${result.upserted} shared thread metadata row(s) into ${result.targetHome} using scope=${scope}.`);
  });
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
