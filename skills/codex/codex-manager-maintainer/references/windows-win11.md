# Windows 11

Load this file only when the target platform is Windows or when porting the Windows adapter elsewhere.

## Current Windows Adapter

- Current manager home: `%USERPROFILE%\.codex-manager`
- Current Desktop home: `%USERPROFILE%\.codex`
- Current official CLI home used by the wrapper: `%USERPROFILE%\.codex-official`
- Current launchers: `%APPDATA%\npm\codex_m.ps1` and `%APPDATA%\npm\codex_m.cmd`

These paths are the current Windows implementation, not the cross-platform contract.

## Current Sharing Strategy

- `sessions`, `archived_sessions`, `skills`, `memories`, `rules`, and `vendor_imports` are shared from the Desktop home into the current official CLI home.
- `session_index.jsonl` is hard-linked so recent-session discovery stays aligned.
- SQLite sidebar/thread databases are not live-shared.
- When needed, the runtime performs thread metadata sync/backfill instead of direct SQLite sharing.

## Install Or Update

Run from the skill folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install_windows.ps1
```

Optional overrides:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install_windows.ps1 `
  -LauncherDir "$env:APPDATA\npm" `
  -CommandName codex_m
```

## Validate

After install or repair:

```powershell
node scripts/validate_codex_manager.js
codex_m doctor
```

Expected:

- `codex_m` launcher exists.
- runtime files exist under manager home.
- managed config keys remain top-level.
- Home shows official ChatGPT and official API key management.
- `codex.exe` is described as Desktop follow-mode, not launcher replacement.

## Windows Guardrails

- Write text files as UTF-8 without BOM.
- Keep launcher scripts lightweight.
- Patch only managed config keys.
- Do not hard-link or junction live SQLite `state_5.sqlite*` files between homes.
- Do not present `.codex-official` as a permanent cross-platform requirement.
