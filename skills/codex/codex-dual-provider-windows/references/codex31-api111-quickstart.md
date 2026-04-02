# codex31 API111 Quickstart

This is the safest way to reproduce the newer third-party lane on another Windows machine without touching an existing `codex3` setup.

## What it creates

- `codex31`
- `codex31_m`
- `%USERPROFILE%\.codex31-manager`
- `%USERPROFILE%\.codex-apikey-api111`

It does not overwrite:

- `codex3`
- `codex3_m`
- `%USERPROFILE%\.codex3-manager`
- `%USERPROFILE%\.codex-apikey`

## Prerequisites

- Official `codex` CLI already works in PowerShell
- `node` and `npm` are on `PATH`
- `%APPDATA%\npm` is on `PATH`

## Install on another computer

1. Clone or copy this repo to any local path.
2. Copy the skill folder into Codex custom skills.
3. Install or repair `codex_m` first so the plain `codex` launcher is pinned to `~/.codex-official`.
4. Run the one-shot installer for the parallel `api111` lane.

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

## Log in

```powershell
codex31 login
```

Paste the new provider API key when prompted.

## Verify

```powershell
codex31 login status
codex31_m provider show
codex3_m provider show
node "$HOME\.codex\skills\custom\codex-manager-maintainer\scripts\validate_codex_manager.js"
```

Expected:

- `codex31_m provider show` reports:
  - command `codex31`
  - mode `api111`
  - provider `api111`
  - base URL `https://api.xcode.best/v1`
  - model `gpt-5-codex`
  - preferred auth `apikey`
- `validate_codex_manager.js` reports that plain `codex` is pinned to `~/.codex-official`
- `codex3_m provider show` still reports the older `codex3` lane

## Recovery

If `codex31` needs to be removed, delete only the parallel lane files:

- `%USERPROFILE%\.codex31-manager`
- `%USERPROFILE%\.codex-apikey-api111`
- `%APPDATA%\npm\codex31.ps1`
- `%APPDATA%\npm\codex31.cmd`
- `%APPDATA%\npm\codex31_m.ps1`
- `%APPDATA%\npm\codex31_m.cmd`

That leaves the original `codex3` lane untouched.
