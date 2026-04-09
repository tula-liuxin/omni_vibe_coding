import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathExists, readText } from "./common.mjs";

export function readRecentSessionIndexEntries(homePath) {
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

export function findRecentRolloutsById(sharedHome, wantedIds) {
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

export function toUnixTimestampSeconds(value) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.floor(parsed / 1000);
}

export function extractTextContent(content) {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((item) => item?.type === "input_text" || item?.type === "output_text")
    .map((item) => String(item.text || ""))
    .join("\n")
    .trim();
}

export function readRolloutPreviewText(rolloutPath, maxBytes = 256 * 1024) {
  const handle = fs.openSync(rolloutPath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(handle, buffer, 0, maxBytes, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    fs.closeSync(handle);
  }
}

export function copyDatabaseWithSidecars(sourceDbPath, destDbPath) {
  fs.copyFileSync(sourceDbPath, destDbPath);
  for (const suffix of ["-wal", "-shm"]) {
    const sourceSidecar = `${sourceDbPath}${suffix}`;
    if (pathExists(sourceSidecar)) {
      fs.copyFileSync(sourceSidecar, `${destDbPath}${suffix}`);
    }
  }
}

export function removeDatabaseSidecars(dbPath) {
  for (const suffix of ["-wal", "-shm"]) {
    const sidecarPath = `${dbPath}${suffix}`;
    if (pathExists(sidecarPath)) {
      fs.rmSync(sidecarPath, { force: true });
    }
  }
}

export function parseThreadRowFromRollout(rolloutPath, fallbackTitle) {
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

export function buildRecentSharedThreadRows(sharedHome, targetHome) {
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

export function buildAllSharedThreadRows(sharedHome, targetHome) {
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

export function syncSharedThreadMetadata(sharedHome, targetHome, { scope = "recent" } = {}) {
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

      return { scanned: rows.length, upserted: rows.length };
    } finally {
      db.close();
    }
  }

  try {
    return applyRows(targetDbPath);
  } catch (error) {
    const tempPath = `${targetDbPath}.sync-copy`;
    copyDatabaseWithSidecars(targetDbPath, tempPath);
    try {
      const result = applyRows(tempPath);
      fs.copyFileSync(tempPath, targetDbPath);
      for (const suffix of ["-wal", "-shm"]) {
        const tempSidecar = `${tempPath}${suffix}`;
        if (pathExists(tempSidecar)) {
          fs.copyFileSync(tempSidecar, `${targetDbPath}${suffix}`);
        }
      }
      return result;
    } finally {
      if (pathExists(tempPath)) {
        fs.rmSync(tempPath, { force: true });
      }
      removeDatabaseSidecars(tempPath);
    }
  }
}
