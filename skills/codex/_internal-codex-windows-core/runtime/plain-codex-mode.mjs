import { readJsonIfExists, writeJson } from "./common.mjs";

export const PLAIN_CODEX_MODE_OFFICIAL = "official";
export const PLAIN_CODEX_MODE_THIRD_PARTY = "third_party";

export function readPlainCodexModeState(filePath) {
  const parsed = readJsonIfExists(filePath);
  return parsed && typeof parsed === "object" ? parsed : null;
}

export function getPlainCodexMode(filePath) {
  const state = readPlainCodexModeState(filePath);
  return state?.mode === PLAIN_CODEX_MODE_THIRD_PARTY
    ? PLAIN_CODEX_MODE_THIRD_PARTY
    : PLAIN_CODEX_MODE_OFFICIAL;
}

export function setPlainCodexModeState(filePath, mode, extra = {}) {
  writeJson(filePath, {
    mode:
      mode === PLAIN_CODEX_MODE_THIRD_PARTY
        ? PLAIN_CODEX_MODE_THIRD_PARTY
        : PLAIN_CODEX_MODE_OFFICIAL,
    updated_at: new Date().toISOString(),
    ...extra,
  });
}
