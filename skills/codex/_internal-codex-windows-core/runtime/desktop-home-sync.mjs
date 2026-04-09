import fs from "node:fs";
import path from "node:path";
import { ensureDir, pathExists } from "./common.mjs";

const MIRRORED_FILES = ["auth.json", "config.toml"];

function copyRequiredFile(sourcePath, targetPath, label) {
  if (!pathExists(sourcePath)) {
    throw new Error(`${label} is missing at ${sourcePath}`);
  }
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

export function syncDesktopHomeFromSource({
  sourceHome,
  desktopHome,
  label = "Desktop bridge source",
} = {}) {
  if (!sourceHome || !desktopHome) {
    throw new Error("syncDesktopHomeFromSource requires sourceHome and desktopHome.");
  }

  for (const relativePath of MIRRORED_FILES) {
    copyRequiredFile(
      path.join(sourceHome, relativePath),
      path.join(desktopHome, relativePath),
      `${label} ${relativePath}`,
    );
  }
}
