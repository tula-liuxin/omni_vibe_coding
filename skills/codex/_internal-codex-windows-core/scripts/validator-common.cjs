"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function pathExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function readJsonIfExists(filePath) {
  if (!pathExists(filePath)) {
    return null;
  }
  try {
    return readJson(filePath);
  } catch {
    return null;
  }
}

function readPlainCodexModeState(managerHome) {
  const filePath = path.join(managerHome, "plain-codex-mode.json");
  const parsed = readJsonIfExists(filePath);
  return parsed && typeof parsed === "object" ? parsed : null;
}

function userHome() {
  return os.homedir();
}

function launcherDir() {
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(userHome(), "AppData", "Roaming"), "npm")
    : path.join(userHome(), ".local", "bin");
}

function officialHome() {
  return path.join(userHome(), ".codex");
}

function officialCliHome() {
  return path.join(userHome(), ".codex-official");
}

function sharedSubstrateHome() {
  return path.join(userHome(), ".codex-shared");
}

const sharedDirectoryNames = [
  "sessions",
  "archived_sessions",
  "skills",
  "memories",
  "rules",
  "vendor_imports",
];

const sharedFileNames = ["session_index.jsonl"];

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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTopLevelValues(text, key) {
  const matcher = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*(.+)$`);
  const values = [];
  let currentTable = null;

  for (const rawLine of String(text || "").split(/\r?\n/)) {
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
      values.push(match[1].trim());
    }
  }

  return values;
}

function hasTomlSection(text, sectionName) {
  return new RegExp(`^\\s*\\[\\s*${escapeRegExp(sectionName)}\\s*\\]\\s*$`, "m").test(
    String(text || ""),
  );
}

function collectSharedTomlSectionHeaders(substrateHome = sharedSubstrateHome()) {
  const configDir = path.join(substrateHome, "config");
  if (!pathExists(configDir)) {
    return [];
  }
  const headers = [];
  for (const name of fs.readdirSync(configDir).filter((item) => /\.toml$/i.test(item)).sort()) {
    const text = readText(path.join(configDir, name));
    for (const match of text.matchAll(/^\s*\[\s*([^\]]+)\s*\]\s*$/gm)) {
      const header = match[1].trim();
      if (header.startsWith("mcp_servers.") || header.startsWith("projects.")) {
        headers.push(header);
      }
    }
  }
  return [...new Set(headers)];
}

function validateSharedSubstrateLinks(homePath, label, substrateHome, issues, warnings) {
  for (const relativePath of sharedDirectoryNames) {
    const targetPath = path.join(substrateHome, relativePath);
    const linkPath = path.join(homePath, relativePath);
    if (!pathExists(targetPath)) {
      warnings.push(`Shared substrate target does not exist yet: ${targetPath}`);
      continue;
    }
    if (!pathExists(linkPath)) {
      issues.push(`${label} shared path is missing: ${linkPath}`);
      continue;
    }
    if (!pathResolvesTo(linkPath, targetPath)) {
      issues.push(`${label} shared path is not linked to the shared substrate: ${linkPath} -> ${targetPath}`);
    }
  }

  for (const relativePath of sharedFileNames) {
    const targetPath = path.join(substrateHome, relativePath);
    const linkPath = path.join(homePath, relativePath);
    if (!pathExists(targetPath)) {
      warnings.push(`Shared substrate file target does not exist yet: ${targetPath}`);
      continue;
    }
    if (!pathExists(linkPath)) {
      issues.push(`${label} shared file is missing: ${linkPath}`);
      continue;
    }
    if (!filesShareIdentity(linkPath, targetPath)) {
      issues.push(`${label} shared file is not hard-linked to the shared substrate: ${linkPath} -> ${targetPath}`);
    }
  }
}

function normalizeJson(value) {
  return JSON.stringify(value, null, 2);
}

function filesMatch(leftPath, rightPath) {
  if (!pathExists(leftPath) || !pathExists(rightPath)) {
    return false;
  }
  return readText(leftPath) === readText(rightPath);
}

function jsonFilesMatch(leftPath, rightPath) {
  if (!pathExists(leftPath) || !pathExists(rightPath)) {
    return false;
  }
  return normalizeJson(readJson(leftPath)) === normalizeJson(readJson(rightPath));
}

function effectiveOpenAiBaseUrl(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/g, "");
  if (!trimmed) {
    return "";
  }
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

module.exports = {
  collectSharedTomlSectionHeaders,
  effectiveOpenAiBaseUrl,
  filesMatch,
  filesShareIdentity,
  hasTomlSection,
  extractTopLevelValues,
  jsonFilesMatch,
  launcherDir,
  officialCliHome,
  officialHome,
  pathResolvesTo,
  pathExists,
  readJson,
  readJsonIfExists,
  readPlainCodexModeState,
  readText,
  sharedSubstrateHome,
  validateSharedSubstrateLinks,
  userHome,
};
