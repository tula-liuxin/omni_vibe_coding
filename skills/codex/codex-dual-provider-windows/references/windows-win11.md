# Windows 11

Load this file only for the Windows adapter.

## Current Windows Adapter

- Current manager home: `%USERPROFILE%\.codex3-manager`
- Current third-party home: `%USERPROFILE%\.codex-apikey`
- Current shared Codex home: `%USERPROFILE%\.codex`
- Current official CLI home used by the wrapper: `%USERPROFILE%\.codex-official`
- Current launchers: `%APPDATA%\npm\codex.ps1`, `%APPDATA%\npm\codex.cmd`, `%APPDATA%\npm\codex3_m.ps1`, `%APPDATA%\npm\codex3_m.cmd`, `%APPDATA%\npm\codex3.ps1`, `%APPDATA%\npm\codex3.cmd`

These paths are current Windows implementation details, not cross-platform guarantees.

## Current Sharing Strategy

- `sessions` and `archived_sessions` are directory-junctioned from the third-party home into the shared Codex home.
- `session_index.jsonl` is hard-linked from the third-party home into the shared Codex home.
- `state_5.sqlite*` is not live-shared.
- Thread/sidebar alignment happens through metadata sync/backfill when needed.

## Install Or Update

Run from the skill folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install_windows.ps1
```

## Validate

After install or repair:

```powershell
node scripts/validate_codex3_manager.js
codex3_m doctor
codex3 login status
```

Expected:

- `codex3_m` launchers exist.
- plain `codex` launcher is wrapped to pin `CODEX_HOME` to `%USERPROFILE%\.codex-official`.
- `codex3` wrapper exists.
- third-party auth/config stay under the third-party home.
- shared session targets resolve to the shared Codex home.
- help text and doctor output describe `codex.exe to use` as a Desktop-only bridge label, not a plain `codex` CLI switch.

## Windows Guardrails

- Write text files as UTF-8 without BOM.
- Keep third-party auth isolated from the shared official home.
- Do not hard-link or junction `state_5.sqlite*`.
- Treat `provider` / `mode` as advanced compatibility controls.
