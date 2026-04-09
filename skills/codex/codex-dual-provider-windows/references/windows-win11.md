# Windows 11

Load this file only for the Windows adapter.

## Current Adapter

- Manager home: `%USERPROFILE%\.codex3-manager`
- Third-party home: `%USERPROFILE%\.codex-apikey`
- Shared Codex home: `%USERPROFILE%\.codex`
- Official CLI home used by the plain `codex` wrapper: `%USERPROFILE%\.codex-official`
- Launchers:
  - `%APPDATA%\npm\codex.ps1`
  - `%APPDATA%\npm\codex.cmd`
  - `%APPDATA%\npm\codex3.ps1`
  - `%APPDATA%\npm\codex3.cmd`
  - `%APPDATA%\npm\codex3_m.ps1`
  - `%APPDATA%\npm\codex3_m.cmd`

These paths are Windows implementation details, not cross-platform guarantees.

## Fixed Third-Party Shape

- Provider id: `api111`
- Base URL default: `https://api.xcode.best/v1`
- Auth method: `apikey`
- Auth carrier: `auth.json` with `cli_auth_credentials_store = "file"`
- Wire API: `responses`

## Sharing Strategy

- `sessions` and `archived_sessions` are directory-junctioned from the third-party home into the shared Codex home.
- `session_index.jsonl` is hard-linked from the third-party home into the shared Codex home.
- `state_5.sqlite*` is not live-shared.
- Thread/sidebar alignment happens through metadata sync/backfill when needed.

## Install Or Update

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install_windows.ps1
```

## Validate

```powershell
node scripts/validate_codex3_manager.js
codex3_m doctor
codex3 login status
```

Expected:

- `codex3_m` launchers exist.
- `codex3` wrapper exists.
- third-party auth/config stay under the third-party home.
- shared session targets resolve to the shared Codex home.
- plain `codex` launcher is wrapped to pin `CODEX_HOME` to `%USERPROFILE%\.codex-official`.
- the managed `codex.ps1` wrapper injects the official provider/auth overrides for plain CLI launches, including `model_provider="openai"` and `cli_auth_credentials_store="file"`.
- the generated `codex3` config keeps the fixed `api111` shape.

## Guardrails

- Write text files as UTF-8 without BOM.
- Keep third-party auth isolated from the shared official home.
- Do not hard-link or junction `state_5.sqlite*`.
- Do not re-introduce multi-mode provider branches.
- Do not assume `CODEX_HOME` pinning alone proves plain `codex` isolation; validate the official wrapper overrides too.
