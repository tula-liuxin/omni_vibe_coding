import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureDir,
  ensureDirectoryJunction,
  ensureFileHardLink,
  pathExists,
  readText,
  safeRealPath,
  writeText,
} from "./common.mjs";

export const SHARED_DIRECTORIES = [
  "sessions",
  "archived_sessions",
  "skills",
  "memories",
  "rules",
  "vendor_imports",
];

export const SHARED_FILES = ["session_index.jsonl"];

export const FORBIDDEN_LIVE_SHARED_SQLITE_PATTERNS = [
  /^state_5\.sqlite(?:-.+)?$/i,
  /^state_5\.sqlite-(?:shm|wal)$/i,
  /^logs_.*\.sqlite(?:-.+)?$/i,
  /^logs_.*\.sqlite-(?:shm|wal)$/i,
];

export function defaultSharedSubstrateHome() {
  return path.join(os.homedir(), ".codex-shared");
}

export function sharedConfigDir(sharedSubstrateHome = defaultSharedSubstrateHome()) {
  return path.join(sharedSubstrateHome, "config");
}

export function sharedConfigPath(name, sharedSubstrateHome = defaultSharedSubstrateHome()) {
  return path.join(sharedConfigDir(sharedSubstrateHome), name);
}

export function ensureSharedSubstrateLayout(sharedSubstrateHome = defaultSharedSubstrateHome()) {
  ensureDir(sharedSubstrateHome);
  ensureDir(sharedConfigDir(sharedSubstrateHome));
  for (const relativePath of SHARED_DIRECTORIES) {
    ensureDir(path.join(sharedSubstrateHome, relativePath));
  }
  for (const relativePath of SHARED_FILES) {
    const filePath = path.join(sharedSubstrateHome, relativePath);
    ensureDir(path.dirname(filePath));
    if (!pathExists(filePath)) {
      fs.writeFileSync(filePath, "", "utf8");
    }
  }
}

export function seedSharedSubstrateFromHome(sourceHome, sharedSubstrateHome = defaultSharedSubstrateHome()) {
  ensureSharedSubstrateLayout(sharedSubstrateHome);
  if (!sourceHome || !pathExists(sourceHome)) {
    return;
  }

  for (const relativePath of SHARED_DIRECTORIES) {
    const sourcePath = path.join(sourceHome, relativePath);
    const targetPath = path.join(sharedSubstrateHome, relativePath);
    if (!pathExists(sourcePath)) {
      continue;
    }
    try {
      ensureDir(targetPath);
      fs.cpSync(sourcePath, targetPath, { recursive: true, force: false, errorOnExist: false });
    } catch {
      // Best-effort seeding only; linking happens below and must remain deterministic.
    }
  }

  for (const relativePath of SHARED_FILES) {
    const sourcePath = path.join(sourceHome, relativePath);
    const targetPath = path.join(sharedSubstrateHome, relativePath);
    if (!pathExists(sourcePath) || (pathExists(targetPath) && fs.statSync(targetPath).size > 0)) {
      continue;
    }
    try {
      fs.copyFileSync(sourcePath, targetPath);
    } catch {
      // Best-effort seeding only.
    }
  }
}

export function ensureHomeUsesSharedSubstrate(targetHome, sharedSubstrateHome = defaultSharedSubstrateHome()) {
  ensureSharedSubstrateLayout(sharedSubstrateHome);
  ensureDir(targetHome);
  for (const relativePath of SHARED_DIRECTORIES) {
    ensureDirectoryJunction(
      path.join(targetHome, relativePath),
      path.join(sharedSubstrateHome, relativePath),
    );
  }
  for (const relativePath of SHARED_FILES) {
    ensureFileHardLink(
      path.join(targetHome, relativePath),
      path.join(sharedSubstrateHome, relativePath),
    );
  }
}

function splitToml(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const topLevel = [];
  const sections = [];
  let current = null;

  for (const line of lines) {
    const sectionMatch = line.match(/^\s*(\[\[?[^\]]+\]?\])\s*$/);
    if (sectionMatch) {
      current = {
        header: sectionMatch[1].replace(/^\[\[?|\]\]?$/g, "").trim(),
        lines: [line],
      };
      sections.push(current);
      continue;
    }
    if (current) {
      current.lines.push(line);
    } else {
      topLevel.push(line);
    }
  }

  return { topLevel, sections };
}

function topLevelKey(line) {
  const match = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=/);
  return match ? match[1] : null;
}

function keepTopLevelLines(lines, managedKeys, keyOrder) {
  const output = [];
  for (const line of lines) {
    const key = topLevelKey(line);
    if (key && managedKeys.has(key)) {
      continue;
    }
    if (key) {
      if (keyOrder.has(key)) {
        const existingIndex = output.findIndex((item) => topLevelKey(item) === key);
        if (existingIndex >= 0) {
          output.splice(existingIndex, 1);
        }
      }
      keyOrder.add(key);
    }
    output.push(line);
  }
  return output;
}

function isManagedSection(header, managedSectionHeaders, managedSectionPrefixes) {
  if (managedSectionHeaders.has(header)) {
    return true;
  }
  return [...managedSectionPrefixes].some((prefix) => header === prefix || header.startsWith(`${prefix}.`));
}

export function mergeCodexConfig({
  existingText = "",
  generatedText = "",
  sharedTexts = [],
  managedTopLevelKeys = [],
  managedSectionHeaders = [],
  managedSectionPrefixes = [],
} = {}) {
  const managedKeys = new Set(managedTopLevelKeys);
  const managedHeaders = new Set(managedSectionHeaders);
  const managedPrefixes = new Set(managedSectionPrefixes);
  const generated = splitToml(generatedText);
  const sourceTexts = [existingText, ...sharedTexts].filter((text) => String(text || "").trim());
  const keyOrder = new Set();
  const topLevel = [];
  const sections = new Map();

  for (const line of generated.topLevel) {
    const key = topLevelKey(line);
    if (key) {
      keyOrder.add(key);
    }
    topLevel.push(line);
  }

  for (const text of sourceTexts) {
    const parsed = splitToml(text);
    topLevel.push(...keepTopLevelLines(parsed.topLevel, managedKeys, keyOrder));
    for (const section of parsed.sections) {
      if (isManagedSection(section.header, managedHeaders, managedPrefixes)) {
        continue;
      }
      sections.set(section.header, section.lines);
    }
  }

  for (const section of generated.sections) {
    sections.set(section.header, section.lines);
  }

  const rendered = [
    ...trimTrailingBlankLines(topLevel),
    "",
    ...[...sections.values()].flatMap((lines) => [...trimTrailingBlankLines(lines), ""]),
  ];
  return `${trimTrailingBlankLines(rendered).join("\n")}\n`;
}

function trimTrailingBlankLines(lines) {
  const copy = [...lines];
  while (copy.length && !String(copy[copy.length - 1]).trim()) {
    copy.pop();
  }
  return copy;
}

export function collectTomlSections(text, predicate) {
  const parsed = splitToml(text);
  return parsed.sections
    .filter((section) => predicate(section.header))
    .map((section) => trimTrailingBlankLines(section.lines).join("\n"))
    .filter(Boolean);
}

export function collectTopLevelAssignments(text, predicate) {
  const parsed = splitToml(text);
  return parsed.topLevel
    .map((line) => ({ key: topLevelKey(line), line }))
    .filter((item) => item.key && predicate(item.key))
    .map((item) => item.line);
}

export function seedSharedConfigFromHomes(
  homes,
  sharedSubstrateHome = defaultSharedSubstrateHome(),
) {
  ensureSharedSubstrateLayout(sharedSubstrateHome);
  const mcpPath = sharedConfigPath("mcp.toml", sharedSubstrateHome);
  const projectsPath = sharedConfigPath("projects.toml", sharedSubstrateHome);
  const mcpTopLevelLines = [];
  const mcpSections = [];
  const projectSections = [];

  for (const home of homes.filter(Boolean)) {
    const configPath = path.join(home, "config.toml");
    if (!pathExists(configPath)) {
      continue;
    }
    const text = readText(configPath);
    mcpTopLevelLines.push(
      ...collectTopLevelAssignments(text, (key) => key.startsWith("mcp_oauth_")),
    );
    mcpSections.push(...collectTomlSections(text, (header) => header.startsWith("mcp_servers.")));
    projectSections.push(...collectTomlSections(text, (header) => header.startsWith("projects.")));
  }

  if (mcpTopLevelLines.length || mcpSections.length || pathExists(mcpPath)) {
    const existingText = pathExists(mcpPath) ? readText(mcpPath) : "";
    const existingTopLevel = collectTopLevelAssignments(existingText, (key) => key.startsWith("mcp_oauth_"));
    const existing = pathExists(mcpPath)
      ? collectTomlSections(existingText, (header) => header.startsWith("mcp_servers."))
      : [];
    const mergedTopLevel = dedupeAssignments([...existingTopLevel, ...mcpTopLevelLines]);
    const merged = dedupeBlocks([...existing, ...mcpSections]);
    if (mergedTopLevel.length || merged.length) {
      writeText(mcpPath, `${[mergedTopLevel.join("\n"), merged.join("\n\n")].filter(Boolean).join("\n\n")}\n`);
    }
  }
  if (projectSections.length || pathExists(projectsPath)) {
    const existing = pathExists(projectsPath)
      ? collectTomlSections(readText(projectsPath), (header) => header.startsWith("projects."))
      : [];
    const merged = dedupeBlocks([...existing, ...projectSections]);
    if (merged.length) {
      writeText(projectsPath, `${merged.join("\n\n")}\n`);
    }
  }
}

function dedupeBlocks(blocks) {
  const seen = new Map();
  for (const block of blocks) {
    const header = block.match(/^\s*(\[\[?[^\]]+\]?\])/m)?.[1] || block;
    seen.set(header, block);
  }
  return [...seen.values()];
}

function dedupeAssignments(lines) {
  const seen = new Map();
  for (const line of lines) {
    const key = topLevelKey(line);
    if (key) {
      seen.set(key, line);
    }
  }
  return [...seen.values()];
}

export function readSharedConfigTexts(sharedSubstrateHome = defaultSharedSubstrateHome()) {
  const dir = sharedConfigDir(sharedSubstrateHome);
  if (!pathExists(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((name) => /\.toml$/i.test(name))
    .sort()
    .map((name) => readText(path.join(dir, name)));
}

export function validateSharedSubstrateLinks(targetHome, sharedSubstrateHome = defaultSharedSubstrateHome()) {
  const issues = [];
  const warnings = [];
  for (const relativePath of SHARED_DIRECTORIES) {
    const linkPath = path.join(targetHome, relativePath);
    const targetPath = path.join(sharedSubstrateHome, relativePath);
    if (!pathExists(targetPath)) {
      warnings.push(`Shared substrate target does not exist yet: ${targetPath}`);
      continue;
    }
    const linkRealPath = safeRealPath(linkPath);
    const targetRealPath = safeRealPath(targetPath);
    if (!linkRealPath || !targetRealPath || path.resolve(linkRealPath) !== path.resolve(targetRealPath)) {
      issues.push(`Shared directory is not linked to substrate: ${linkPath} -> ${targetPath}`);
    }
  }
  for (const relativePath of SHARED_FILES) {
    const linkPath = path.join(targetHome, relativePath);
    const targetPath = path.join(sharedSubstrateHome, relativePath);
    if (!pathExists(targetPath)) {
      warnings.push(`Shared substrate file target does not exist yet: ${targetPath}`);
      continue;
    }
    try {
      const left = fs.statSync(linkPath);
      const right = fs.statSync(targetPath);
      if (left.dev !== right.dev || left.ino !== right.ino) {
        issues.push(`Shared file is not hard-linked to substrate: ${linkPath} -> ${targetPath}`);
      }
    } catch {
      issues.push(`Shared file is missing from target home: ${linkPath}`);
    }
  }
  return { issues, warnings };
}
