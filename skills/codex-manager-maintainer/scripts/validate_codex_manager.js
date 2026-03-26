#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function resolveManagerHome() {
  if (process.env.CODEX_MANAGER_HOME) {
    return path.resolve(process.env.CODEX_MANAGER_HOME);
  }
  return path.join(os.homedir(), ".codex-manager");
}

function resolveOfficialHome() {
  if (process.env.CODEX_HOME && path.isAbsolute(process.env.CODEX_HOME)) {
    return process.env.CODEX_HOME;
  }
  return path.join(os.homedir(), ".codex");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function inspectManagedKey(text, key) {
  const topLevelLines = [];
  const nestedLines = [];
  let currentTable = null;
  const matcher = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (/^\[\[.*\]\]$/.test(line) || /^\[.*\]$/.test(line)) {
      currentTable = line;
      continue;
    }
    if (matcher.test(line)) {
      const lineNumber = index + 1;
      if (currentTable === null) {
        topLevelLines.push(lineNumber);
      } else {
        nestedLines.push({ line: lineNumber, table: currentTable });
      }
    }
  }

  return {
    topLevelLines,
    nestedLines,
  };
}

function extractTopLevelValue(text, key) {
  const matcher = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(.+)$`);
  let currentTable = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (/^\[\[.*\]\]$/.test(line) || /^\[.*\]$/.test(line)) {
      currentTable = line;
      continue;
    }
    if (currentTable !== null) {
      continue;
    }
    const match = line.match(matcher);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

function pathExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

const jsonMode = process.argv.includes("--json");
const managerHome = resolveManagerHome();
const officialHome = resolveOfficialHome();
const launcherDir =
  process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "npm")
    : path.join(os.homedir(), ".local", "bin");

const issues = [];
const warnings = [];

const runtimeFiles = [
  path.join(managerHome, "index.mjs"),
  path.join(managerHome, "package.json"),
  path.join(managerHome, "package-lock.json"),
];

for (const runtimeFile of runtimeFiles) {
  if (!pathExists(runtimeFile)) {
    issues.push(`Missing runtime file: ${runtimeFile}`);
  }
}

if (process.platform === "win32") {
  for (const launcherFile of [
    path.join(launcherDir, "codex_m.ps1"),
    path.join(launcherDir, "codex_m.cmd"),
  ]) {
    if (!pathExists(launcherFile)) {
      issues.push(`Missing launcher: ${launcherFile}`);
    }
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

if (state && (typeof state !== "object" || state === null || typeof state.tuples !== "object")) {
  issues.push(`State file has an unexpected shape: ${statePath}`);
}

if (state && state.active_tuple_id && !state.tuples?.[state.active_tuple_id]) {
  issues.push(`Active tuple id is missing from state: ${state.active_tuple_id}`);
}

if (state && state.tuples && typeof state.tuples === "object") {
  for (const tuple of Object.values(state.tuples)) {
    if (!tuple || typeof tuple !== "object") {
      issues.push("State contains a non-object tuple entry.");
      continue;
    }
    if (!tuple.account_id) {
      issues.push(`Tuple is missing account_id: ${tuple.tuple_id || "<unknown>"}`);
      continue;
    }
    const authCopyPath = path.join(managerHome, "accounts", tuple.account_id, "auth.json");
    if (!pathExists(authCopyPath)) {
      issues.push(`Missing saved auth copy for ${tuple.tuple_id}: ${authCopyPath}`);
      continue;
    }
    try {
      const authCopy = readJson(authCopyPath);
      const accountId = authCopy?.tokens?.account_id || null;
      if (!accountId) {
        issues.push(`Saved auth copy missing tokens.account_id: ${authCopyPath}`);
      } else if (tuple.login_workspace_id && tuple.login_workspace_id !== accountId) {
        issues.push(
          `Saved auth copy account id does not match tuple login identity for ${tuple.tuple_id}`,
        );
      }
    } catch (error) {
      issues.push(`Invalid saved auth copy JSON: ${authCopyPath} (${error.message})`);
    }
  }
}

const configPath = path.join(officialHome, "config.toml");
if (pathExists(configPath)) {
  const configText = readText(configPath);
  for (const key of ["cli_auth_credentials_store", "forced_chatgpt_workspace_id"]) {
    const inspection = inspectManagedKey(configText, key);
    if (inspection.topLevelLines.length > 1) {
      issues.push(
        `Duplicate top-level ${key} entries at lines ${inspection.topLevelLines.join(", ")}`,
      );
    }
    if (inspection.nestedLines.length > 0) {
      const locations = inspection.nestedLines
        .map((item) => `${item.table} line ${item.line}`)
        .join(", ");
      issues.push(`${key} is nested instead of top-level: ${locations}`);
    }
  }

  const authStoreValue = extractTopLevelValue(configText, "cli_auth_credentials_store");
  if (authStoreValue === null) {
    issues.push("Official config does not define top-level cli_auth_credentials_store");
  } else if (authStoreValue !== '"file"') {
    issues.push(`cli_auth_credentials_store should be \"file\", found ${authStoreValue}`);
  }

  if (state?.active_tuple_id) {
    const forcedValue = extractTopLevelValue(configText, "forced_chatgpt_workspace_id");
    if (forcedValue === null) {
      issues.push("Official config does not define top-level forced_chatgpt_workspace_id");
    }
  }
} else {
  warnings.push(`Official config not found: ${configPath}`);
}

const officialAuthPath = path.join(officialHome, "auth.json");
if (state?.active_tuple_id && pathExists(officialAuthPath)) {
  try {
    const officialAuth = readJson(officialAuthPath);
    const officialAccountId = officialAuth?.tokens?.account_id || null;
    const activeTuple = state.tuples[state.active_tuple_id];
    if (
      activeTuple &&
      activeTuple.login_workspace_id &&
      officialAccountId &&
      activeTuple.login_workspace_id !== officialAccountId
    ) {
      issues.push(
        `Official auth account id ${officialAccountId} does not match active tuple ${activeTuple.tuple_id}`,
      );
    }
  } catch (error) {
    issues.push(`Invalid official auth JSON: ${officialAuthPath} (${error.message})`);
  }
} else if (state?.active_tuple_id && !pathExists(officialAuthPath)) {
  issues.push(`Active tuple exists but official auth is missing: ${officialAuthPath}`);
}

const payload = {
  ok: issues.length === 0,
  issues,
  warnings,
  paths: {
    managerHome,
    officialHome,
    launcherDir,
  },
};

if (jsonMode) {
  console.log(JSON.stringify(payload, null, 2));
} else if (issues.length === 0) {
  console.log("No obvious issues found.");
  for (const warning of warnings) {
    console.log(`Warning: ${warning}`);
  }
} else {
  console.log("Issues found:");
  for (const issue of issues) {
    console.log(`- ${issue}`);
  }
  for (const warning of warnings) {
    console.log(`Warning: ${warning}`);
  }
}

process.exit(issues.length === 0 ? 0 : 1);
