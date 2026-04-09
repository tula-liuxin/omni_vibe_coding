import process from "node:process";
import { spawnSync } from "node:child_process";

export function detectRunningCodexProcesses({ excludePattern } = {}) {
  if (process.platform !== "win32") {
    return [];
  }

  const exclusionClause =
    excludePattern && String(excludePattern).trim()
      ? ` -and $_.CommandLine -notmatch '${String(excludePattern).replace(/'/g, "''")}'`
      : "";

  const psScript = `
$me = ${process.pid};
$items = Get-CimInstance Win32_Process |
  Where-Object {
    $_.ProcessId -ne $me -and
    $_.CommandLine -and (
      $_.CommandLine -match '(?i)AppData\\\\Roaming\\\\npm\\\\node_modules\\\\@openai\\\\codex' -or
      $_.CommandLine -match '(?i)codex-win32-x64'
    )${exclusionClause}
  } |
  Select-Object ProcessId, Name, CommandLine;
$items | ConvertTo-Json -Compress
`;

  const result = spawnSync("powershell", ["-NoProfile", "-Command", psScript], {
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }

  const parsed = JSON.parse(result.stdout.trim());
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function formatProcessSummary(processes) {
  if (!processes.length) {
    return "none";
  }
  return processes.map((item) => `${item.Name}(${item.ProcessId})`).join(", ");
}

export function assertNoRunningCodexProcesses(options = {}) {
  const processes = detectRunningCodexProcesses(options);
  if (!processes.length) {
    return;
  }
  throw new Error(
    `Running Codex CLI process detected: ${formatProcessSummary(processes)}. Close it first or rerun with --force.`,
  );
}
