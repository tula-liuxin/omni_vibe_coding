# Windows 11

Load this file only for the Windows adapter.

## Current Adapter

- Manager home: `%USERPROFILE%\.codex3-manager`
- Third-party home: `%USERPROFILE%\.codex-apikey`
- Shared Codex home: `%USERPROFILE%\.codex`
- Shared substrate home: `%USERPROFILE%\.codex-shared`
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

- `sessions`, `archived_sessions`, `skills`, `memories`, `rules`, and `vendor_imports` are directory-junctioned from both the shared Codex home and the third-party home into `.codex-shared`.
- `session_index.jsonl` is hard-linked from both homes into `.codex-shared`.
- `.codex-shared\config\mcp.toml` and `.codex-shared\config\projects.toml` hold shared MCP servers, MCP OAuth top-level settings, and project config fragments collected from existing homes.
- Generated `codex3` config merges unmanaged shared MCP/project sections while owning and validating the fixed `api111` provider shape.
- If an active Codex/Desktop process prevents relinking `%USERPROFILE%\.codex`, the installer leaves that Desktop/shared-home directory in place and reports a warning; the third-party home must still link to `.codex-shared`.
- `state_5.sqlite*` is not live-shared.
- Thread/sidebar alignment happens through metadata sync/backfill when needed.
- If a currently running Codex process locks an existing shared directory, the installer seeds `.codex-shared` and skips replacing that directory with a junction instead of failing the install. Close running Codex processes and rerun the installer or manager action to complete the junction conversion.
- The generated `codex3` wrapper suppresses repeated shared-link warnings by default; set `CODEX_SHARED_LINK_WARNINGS=1` only when debugging link repair.

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
- legacy shared Codex home and third-party home both resolve shared targets through the shared substrate.
- shared session/skill/memory/rule/vendor targets resolve to `%USERPROFILE%\.codex-shared`.
- unresolved Desktop/shared-home relinks caused by active Codex/Desktop processes are warnings, not auth/provider isolation failures.
- shared MCP/project config sections survive third-party API key profile switching.
- plain `codex` launcher is wrapped to pin `CODEX_HOME` to `%USERPROFILE%\.codex-official`.
- the managed `codex.ps1` wrapper injects the official provider/auth overrides for plain CLI launches, including `model_provider="openai"` and `cli_auth_credentials_store="file"`.
- the generated `codex3` config keeps the fixed `api111` shape.

## Guardrails

- Write text files as UTF-8 without BOM.
- Keep third-party auth isolated from the shared official home.
- Do not hard-link or junction `state_5.sqlite*`.
- Do not let `[model_providers.openai]` or top-level `model_provider = "openai"` remain in the generated `codex3` config.
- Do not re-introduce multi-mode provider branches.
- Do not assume `CODEX_HOME` pinning alone proves plain `codex` isolation; validate the official wrapper overrides too.
