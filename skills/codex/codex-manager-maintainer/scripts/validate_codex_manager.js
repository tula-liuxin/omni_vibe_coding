#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const PROFILE_KIND_CHATGPT = "chatgpt";
const PROFILE_KIND_OFFICIAL_API_KEY = "official_api_key";

function resolveManagerHome() {
  if (process.env.CODEX_MANAGER_HOME) {
    return path.resolve(process.env.CODEX_MANAGER_HOME);
  }
  return path.join(os.homedir(), ".codex-manager");
}

function resolveOfficialHome() {
  return path.join(os.homedir(), ".codex");
}

function resolveEffectiveCodexHome() {
  if (process.env.CODEX_HOME && path.isAbsolute(process.env.CODEX_HOME)) {
    return process.env.CODEX_HOME;
  }
  return resolveOfficialHome();
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function pathExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
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

function normalizeAccountEmail(email) {
  return String(email || "").trim().toLowerCase();
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

function getTupleLoginWorkspaceId(tuple) {
  return tuple?.login_workspace_id || tuple?.account_id || null;
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

function normalizeOfficialApiKeyProfile(profile, profileId) {
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

function extractChatGptAccountId(authData) {
  if (!authData?.tokens?.id_token) {
    return null;
  }
  try {
    const payload = decodeJwtPayload(authData.tokens.id_token);
    const auth = payload["https://api.openai.com/auth"] || {};
    return auth.chatgpt_account_id || authData?.tokens?.account_id || null;
  } catch {
    return authData?.tokens?.account_id || null;
  }
}

function getEnvironmentOpenAiApiKeyWarnings() {
  const warnings = [];

  if (process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).trim()) {
    warnings.push(
      "OPENAI_API_KEY is set in the current process environment. This can override file-backed official profile switching.",
    );
  }

  if (process.platform !== "win32") {
    return warnings;
  }

  const script = `
$user = [Environment]::GetEnvironmentVariable("OPENAI_API_KEY", "User")
$machine = [Environment]::GetEnvironmentVariable("OPENAI_API_KEY", "Machine")
[PSCustomObject]@{
  user = -not [string]::IsNullOrWhiteSpace($user)
  machine = -not [string]::IsNullOrWhiteSpace($machine)
} | ConvertTo-Json -Compress
`;

  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0 || !result.stdout.trim()) {
    return warnings;
  }

  try {
    const parsed = JSON.parse(result.stdout.trim());
    if (parsed.user) {
      warnings.push(
        "OPENAI_API_KEY is set at Windows User scope. This can override file-backed official profile switching in new shells.",
      );
    }
    if (parsed.machine) {
      warnings.push(
        "OPENAI_API_KEY is set at Windows Machine scope. This can override file-backed official profile switching in new shells.",
      );
    }
  } catch {
    return warnings;
  }

  return warnings;
}

const jsonMode = process.argv.includes("--json");
const managerHome = resolveManagerHome();
const officialHome = resolveOfficialHome();
const effectiveCodexHome = resolveEffectiveCodexHome();
const launcherDir =
  process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "npm")
    : path.join(os.homedir(), ".local", "bin");

const issues = [];
const warnings = [...getEnvironmentOpenAiApiKeyWarnings()];

if (path.resolve(effectiveCodexHome) !== path.resolve(officialHome)) {
  warnings.push(
    `Current process CODEX_HOME points to ${effectiveCodexHome}, but codex_m validates the official home at ${officialHome}.`,
  );
}

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
    if (state && typeof state === "object") {
      if (!state.tuples || typeof state.tuples !== "object") {
        state.tuples = {};
      }
      if (!state.official_api_key_profiles || typeof state.official_api_key_profiles !== "object") {
        state.official_api_key_profiles = {};
      }
      if (!("active_official_profile" in state)) {
        state.active_official_profile = state.active_tuple_id
          ? {
              kind: PROFILE_KIND_CHATGPT,
              id: state.active_tuple_id,
            }
          : null;
      }
    }
  } catch (error) {
    issues.push(`Invalid state JSON: ${statePath} (${error.message})`);
  }
} else {
  warnings.push(`State file not found: ${statePath}`);
}

if (
  state &&
  (typeof state !== "object" ||
    state === null ||
    typeof state.tuples !== "object" ||
    typeof state.official_api_key_profiles !== "object")
) {
  issues.push(`State file has an unexpected shape: ${statePath}`);
}

if (
  state &&
  state.active_tuple_id &&
  state.active_official_profile &&
  state.active_official_profile.kind !== PROFILE_KIND_CHATGPT
) {
  issues.push("active_tuple_id should be null unless active_official_profile.kind is chatgpt.");
}

if (
  state &&
  state.active_official_profile?.kind === PROFILE_KIND_CHATGPT &&
  !state.tuples?.[state.active_official_profile.id]
) {
  issues.push(
    `Active ChatGPT profile id is missing from state.tuples: ${state.active_official_profile.id}`,
  );
}

if (
  state &&
  state.active_official_profile?.kind === PROFILE_KIND_OFFICIAL_API_KEY &&
  !state.official_api_key_profiles?.[state.active_official_profile.id]
) {
  issues.push(
    `Active official API key profile id is missing from state.official_api_key_profiles: ${state.active_official_profile.id}`,
  );
}

if (state && state.tuples && typeof state.tuples === "object") {
  const tuplesByIdentity = new Map();
  for (const tuple of Object.values(state.tuples)) {
    if (!tuple || typeof tuple !== "object") {
      issues.push("State contains a non-object tuple entry.");
      continue;
    }
    if (!tuple.account_id) {
      issues.push(`Tuple is missing account_id: ${tuple.tuple_id || "<unknown>"}`);
      continue;
    }
    const identityKey = getTupleIdentityKey(tuple);
    if (identityKey) {
      const existing = tuplesByIdentity.get(identityKey) || [];
      existing.push(tuple.tuple_id || "<unknown>");
      tuplesByIdentity.set(identityKey, existing);
    }

    const authStorageKey = getTupleAuthStorageKey(tuple);
    const authCopyPath = path.join(managerHome, "accounts", authStorageKey, "auth.json");
    const legacyAuthCopyPath = path.join(managerHome, "accounts", tuple.account_id, "auth.json");
    const resolvedAuthCopyPath = pathExists(authCopyPath)
      ? authCopyPath
      : pathExists(legacyAuthCopyPath)
        ? legacyAuthCopyPath
        : authCopyPath;

    if (!pathExists(resolvedAuthCopyPath)) {
      issues.push(`Missing saved auth copy for ${tuple.tuple_id}: ${authCopyPath}`);
      continue;
    }
    if (resolvedAuthCopyPath !== authCopyPath) {
      warnings.push(
        `Tuple ${tuple.tuple_id} still uses legacy saved auth path and will be migrated on next codex_m run: ${legacyAuthCopyPath}`,
      );
    }
    try {
      const authCopy = readJson(resolvedAuthCopyPath);
      if (detectAuthKind(authCopy) !== PROFILE_KIND_CHATGPT) {
        issues.push(`Saved auth copy is not ChatGPT auth for tuple ${tuple.tuple_id}`);
      }
      const accountId = extractChatGptAccountId(authCopy);
      if (!accountId) {
        issues.push(`Saved auth copy missing ChatGPT account id: ${resolvedAuthCopyPath}`);
      } else if (tuple.login_workspace_id && tuple.login_workspace_id !== accountId) {
        issues.push(
          `Saved auth copy account id does not match tuple login identity for ${tuple.tuple_id}`,
        );
      }
    } catch (error) {
      issues.push(`Invalid saved auth copy JSON: ${resolvedAuthCopyPath} (${error.message})`);
    }
  }

  for (const [identityKey, tupleIds] of tuplesByIdentity.entries()) {
    if (tupleIds.length > 1) {
      const parsed = JSON.parse(identityKey);
      issues.push(
        `Duplicate saved snapshot identity (${parsed.account_email || "(unknown email)"} | ${parsed.login_workspace_id}): ${tupleIds.join(", ")}`,
      );
    }
  }
}

if (state && state.official_api_key_profiles && typeof state.official_api_key_profiles === "object") {
  for (const [profileId, rawProfile] of Object.entries(state.official_api_key_profiles)) {
    const profile = normalizeOfficialApiKeyProfile(rawProfile, profileId);
    if (!profile) {
      issues.push(`Invalid official API key profile entry: ${profileId}`);
      continue;
    }
    const authPath = path.join(managerHome, "official-api-keys", profile.profile_id, "auth.json");
    if (!pathExists(authPath)) {
      issues.push(`Missing saved auth copy for official API key profile ${profile.profile_id}: ${authPath}`);
      continue;
    }
    try {
      const authCopy = readJson(authPath);
      if (detectAuthKind(authCopy) !== PROFILE_KIND_OFFICIAL_API_KEY) {
        issues.push(`Saved auth copy is not API key auth for official profile ${profile.profile_id}`);
      }
    } catch (error) {
      issues.push(`Invalid saved API key auth JSON: ${authPath} (${error.message})`);
    }
  }
}

const configPath = path.join(officialHome, "config.toml");
let forcedValue = null;
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
    issues.push(`cli_auth_credentials_store should be "file", found ${authStoreValue}`);
  }

  forcedValue = extractTopLevelValue(configText, "forced_chatgpt_workspace_id");
} else {
  warnings.push(`Official config not found: ${configPath}`);
}

const officialAuthPath = path.join(officialHome, "auth.json");
let officialAuthKind = null;
let officialAuthAccountId = null;
if (pathExists(officialAuthPath)) {
  try {
    const officialAuth = readJson(officialAuthPath);
    officialAuthKind = detectAuthKind(officialAuth);
    officialAuthAccountId =
      officialAuthKind === PROFILE_KIND_CHATGPT ? extractChatGptAccountId(officialAuth) : null;
  } catch (error) {
    issues.push(`Invalid official auth JSON: ${officialAuthPath} (${error.message})`);
  }
}

if (state?.active_official_profile?.kind === PROFILE_KIND_CHATGPT) {
  const activeTuple = state.tuples[state.active_official_profile.id];
  if (!activeTuple) {
    issues.push(`Active ChatGPT tuple missing: ${state.active_official_profile.id}`);
  } else {
    if (!pathExists(officialAuthPath)) {
      issues.push(`Active ChatGPT tuple exists but official auth is missing: ${officialAuthPath}`);
    } else if (officialAuthKind !== PROFILE_KIND_CHATGPT) {
      issues.push("Active official profile is ChatGPT, but official auth is not ChatGPT auth.");
    }

    if (
      activeTuple.login_workspace_id &&
      officialAuthAccountId &&
      activeTuple.login_workspace_id !== officialAuthAccountId
    ) {
      issues.push(
        `Official auth account id ${officialAuthAccountId} does not match active ChatGPT tuple ${activeTuple.tuple_id}`,
      );
    }

    if (forcedValue === null) {
      issues.push("Official config does not define top-level forced_chatgpt_workspace_id");
    } else if (forcedValue !== `"${activeTuple.login_workspace_id}"`) {
      issues.push(
        `forced_chatgpt_workspace_id ${forcedValue} does not match active ChatGPT tuple ${activeTuple.login_workspace_id}`,
      );
    }
  }
} else if (state?.active_official_profile?.kind === PROFILE_KIND_OFFICIAL_API_KEY) {
  if (!pathExists(officialAuthPath)) {
    issues.push(`Active official API key profile exists but official auth is missing: ${officialAuthPath}`);
  } else if (officialAuthKind !== PROFILE_KIND_OFFICIAL_API_KEY) {
    issues.push("Active official profile is an API key profile, but official auth is not API key auth.");
  }

  if (forcedValue !== null) {
    issues.push(
      "Active official API key profile still has forced_chatgpt_workspace_id in official config.",
    );
  }
} else {
  if (forcedValue !== null && officialAuthKind !== PROFILE_KIND_CHATGPT) {
    warnings.push(
      "forced_chatgpt_workspace_id is still present in official config while no ChatGPT tuple is marked active.",
    );
  }
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
