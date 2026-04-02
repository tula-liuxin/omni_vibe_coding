# codex31 API111 Quickstart

This is the minimal Windows path that reproduced the split setup cleanly on another machine.

## Goal

Keep three lanes separate:

- plain `codex` stays official
- `codex31` uses the newer `api111` tutorial shape
- `codex31_m` may make Desktop `codex.exe` follow `codex31` without switching plain `codex`

## What this creates

- `codex31`
- `codex31_m`
- `%USERPROFILE%\.codex31-manager`
- `%USERPROFILE%\.codex-apikey-api111`

It does not overwrite the older `codex3` lane.

## Prerequisites

- Official `codex` already works in PowerShell
- `node` and `npm` are on `PATH`
- `%APPDATA%\npm` is on `PATH`

## Golden Path

1. Copy the two skills into `%USERPROFILE%\.codex\skills\custom`.
2. Install `codex_m` first.
3. Install the parallel `codex31` lane.
4. Run `codex31 login`.
5. Verify both lanes with real commands, not just file inspection.

```powershell
$repo = 'D:\workspace\omni_vibe_coding'
$skillRoot = Join-Path $HOME '.codex\skills\custom'

New-Item -ItemType Directory -Force -Path $skillRoot | Out-Null

Copy-Item -Recurse -Force `
  (Join-Path $repo 'skills\codex\codex-manager-maintainer') `
  (Join-Path $skillRoot 'codex-manager-maintainer')

Copy-Item -Recurse -Force `
  (Join-Path $repo 'skills\codex\codex-dual-provider-windows') `
  (Join-Path $skillRoot 'codex-dual-provider-windows')

powershell -NoProfile -ExecutionPolicy Bypass -File `
  "$HOME\.codex\skills\custom\codex-manager-maintainer\scripts\install_windows.ps1" `
  -SkillRoot "$HOME\.codex\skills\custom\codex-manager-maintainer"

powershell -NoProfile -ExecutionPolicy Bypass -File `
  "$HOME\.codex\skills\custom\codex-dual-provider-windows\scripts\install_codex31_api111_windows.ps1" `
  -SkillRoot "$HOME\.codex\skills\custom\codex-dual-provider-windows"
```

Then log in:

```powershell
codex31 login
```

## Core Verification

Run these exact checks:

```powershell
codex31_m provider show
node "$HOME\.codex\skills\custom\codex-manager-maintainer\scripts\validate_codex_manager.js"
codex exec --skip-git-repo-check "Write only this exact line: OFFICIAL_VERIFY"
codex31 exec --skip-git-repo-check "Write only this exact line: THIRD_PARTY_VERIFY"
```

Expected:

- `codex31_m provider show` reports:
  - command `codex31`
  - mode `api111`
  - provider `api111`
  - base URL `https://api.xcode.best/v1`
  - model `gpt-5-codex`
  - preferred auth `apikey`
- `validate_codex_manager.js` reports no blocking issues for the official lane
- the plain `codex exec` startup block reports `provider: openai`
- the `codex31 exec` startup block reports `provider: api111`

## Desktop Follow-Mode Check

If you use `codex31_m` -> `codex.exe to use`, verify the key isolation again afterward:

```powershell
codex exec --skip-git-repo-check "Write only this exact line: OFFICIAL_VERIFY_AFTER_DESKTOP_SWITCH"
```

Expected:

- plain `codex` still reports `provider: openai`

That is the key invariant. If this check fails, the Windows official wrapper is incomplete and should be repaired with `codex_m`.

## Recovery

To remove only the parallel lane, delete:

- `%USERPROFILE%\.codex31-manager`
- `%USERPROFILE%\.codex-apikey-api111`
- `%APPDATA%\npm\codex31.ps1`
- `%APPDATA%\npm\codex31.cmd`
- `%APPDATA%\npm\codex31_m.ps1`
- `%APPDATA%\npm\codex31_m.cmd`
