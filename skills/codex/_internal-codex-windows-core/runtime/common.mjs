import fs from "node:fs";
import path from "node:path";

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

export function pathExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

export function readJsonIfExists(filePath) {
  if (!pathExists(filePath)) {
    return null;
  }
  try {
    return readJson(filePath);
  } catch {
    return null;
  }
}

export function safeRealPath(filePath) {
  try {
    return typeof fs.realpathSync.native === "function"
      ? fs.realpathSync.native(filePath)
      : fs.realpathSync(filePath);
  } catch {
    return null;
  }
}

export function moveAsidePath(filePath) {
  if (!pathExists(filePath)) {
    return;
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.renameSync(filePath, `${filePath}.pre-shared-${timestamp}`);
}

export function ensureDirectoryJunction(linkPath, targetPath) {
  ensureDir(targetPath);
  const linkRealPath = safeRealPath(linkPath);
  const targetRealPath = safeRealPath(targetPath);
  if (linkRealPath && targetRealPath && path.resolve(linkRealPath) === path.resolve(targetRealPath)) {
    return;
  }
  moveAsidePath(linkPath);
  fs.symlinkSync(targetPath, linkPath, "junction");
}

export function ensureFileHardLink(linkPath, targetPath) {
  ensureDir(path.dirname(targetPath));
  if (!pathExists(targetPath)) {
    fs.writeFileSync(targetPath, "", "utf8");
  }
  const linkRealPath = safeRealPath(linkPath);
  const targetRealPath = safeRealPath(targetPath);
  if (linkRealPath && targetRealPath && path.resolve(linkRealPath) === path.resolve(targetRealPath)) {
    return;
  }
  moveAsidePath(linkPath);
  fs.linkSync(targetPath, linkPath);
}
