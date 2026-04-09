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
  effectiveOpenAiBaseUrl,
  filesMatch,
  jsonFilesMatch,
  launcherDir,
  officialCliHome,
  officialHome,
  pathExists,
  readJson,
  readJsonIfExists,
  readPlainCodexModeState,
  readText,
  userHome,
};
