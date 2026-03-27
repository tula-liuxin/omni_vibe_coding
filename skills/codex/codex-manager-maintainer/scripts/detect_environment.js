#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

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

function commandVersion(command) {
  const result =
    process.platform === "win32"
      ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `${command} --version`], {
          encoding: "utf8",
        })
      : spawnSync(command, ["--version"], {
          encoding: "utf8",
        });

  if (result.error) {
    return {
      ok: false,
      error: result.error.message,
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      status: result.status,
      error: (result.stderr || result.stdout || "").trim() || `Exited with ${result.status}`,
    };
  }

  const version = (result.stdout || result.stderr || "").trim().split(/\r?\n/)[0] || null;
  return {
    ok: true,
    version,
  };
}

function safeJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function pathExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

const homeDir = os.homedir();
const managerHome = resolveManagerHome();
const officialHome = resolveOfficialHome();
const launcherDir =
  process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), "npm")
    : path.join(homeDir, ".local", "bin");

const launcherPaths =
  process.platform === "win32"
    ? {
        ps1: path.join(launcherDir, "codex_m.ps1"),
        cmd: path.join(launcherDir, "codex_m.cmd"),
      }
    : {
        sh: path.join(launcherDir, "codex_m"),
      };

const statePath = path.join(managerHome, "state.json");
const state = safeJson(statePath);
const tupleCount = state && state.tuples && typeof state.tuples === "object"
  ? Object.keys(state.tuples).length
  : 0;

const report = {
  platform: process.platform,
  release: os.release(),
  arch: process.arch,
  shell: process.env.SHELL || process.env.ComSpec || null,
  terminal: process.env.TERM_PROGRAM || process.env.WT_SESSION || null,
  paths: {
    homeDir,
    officialHome,
    officialAuthPath: path.join(officialHome, "auth.json"),
    officialConfigPath: path.join(officialHome, "config.toml"),
    managerHome,
    managerEntryPath: path.join(managerHome, "index.mjs"),
    managerStatePath: statePath,
    launcherDir,
    launcherPaths,
  },
  installed: {
    codexHomeExists: pathExists(officialHome),
    officialAuthExists: pathExists(path.join(officialHome, "auth.json")),
    officialConfigExists: pathExists(path.join(officialHome, "config.toml")),
    managerHomeExists: pathExists(managerHome),
    managerEntryExists: pathExists(path.join(managerHome, "index.mjs")),
    managerPackageExists: pathExists(path.join(managerHome, "package.json")),
    launcherExists: Object.fromEntries(
      Object.entries(launcherPaths).map(([name, filePath]) => [name, pathExists(filePath)]),
    ),
  },
  state: {
    exists: pathExists(statePath),
    schemaVersion: state && typeof state === "object" ? state.schema_version ?? null : null,
    activeTupleId: state && typeof state === "object" ? state.active_tuple_id ?? null : null,
    tupleCount,
  },
  commands: {
    node: commandVersion("node"),
    npm: commandVersion("npm"),
    codex: commandVersion("codex"),
  },
};

console.log(JSON.stringify(report, null, 2));
