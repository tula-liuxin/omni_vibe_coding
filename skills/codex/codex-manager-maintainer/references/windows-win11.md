# Windows 11

Load this file only when the target platform is Windows or when porting the Windows adapter elsewhere.

## Current Windows Adapter

- Current manager home: `%USERPROFILE%\.codex-manager`
- Current Desktop home: `%USERPROFILE%\.codex`
- Current official CLI home used by the wrapper: `%USERPROFILE%\.codex-official`
- Current shared substrate home: `%USERPROFILE%\.codex-shared`
- Current launchers: `%APPDATA%\npm\codex_m.ps1`, `%APPDATA%\npm\codex_m.cmd`, `%APPDATA%\npm\codex.ps1`, and `%APPDATA%\npm\codex.cmd`

These paths are the current Windows implementation, not the cross-platform contract.

## Current Sharing Strategy

- `sessions`, `archived_sessions`, `skills`, `memories`, `rules`, and `vendor_imports` are directory-junctioned from both the Desktop home and official CLI home into `.codex-shared`.
- `session_index.jsonl` is hard-linked from both homes into `.codex-shared` so recent-session discovery stays aligned.
- `.codex-shared\config\mcp.toml` and `.codex-shared\config\projects.toml` hold unmanaged shared MCP servers, MCP OAuth top-level settings, and project config fragments that are merged into official generated configs.
- Official generated configs strip `api111` provider ownership while preserving shared MCP/project sections.
- If an active Codex/Desktop process prevents relinking `%USERPROFILE%\.codex`, the adapter leaves that Desktop directory in place and reports a warning; the official CLI home must still link to `.codex-shared`.
- SQLite sidebar/thread databases are not live-shared.
- When needed, the runtime performs thread metadata sync/backfill instead of direct SQLite sharing.
- If an active Codex process locks `sessions` or `skills`, conversion to `.codex-shared` junctions may be deferred. The runtime should seed shared content first, skip destructive replacement, and let validation report the remaining link repair after processes are closed.

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
- plain `codex` launcher is wrapped to pin `CODEX_HOME` to `%USERPROFILE%\.codex-official`.
- the managed `codex.ps1` wrapper injects the official provider/auth overrides for plain CLI launches, including `model_provider="openai"` and `cli_auth_credentials_store="file"`.
- the managed `codex.ps1` wrapper clears inherited `OPENAI_API_KEY` and `OPENAI_BASE_URL` before launching the child Codex process.
- runtime files exist under manager home.
- Desktop and official CLI shared targets resolve to `%USERPROFILE%\.codex-shared`.
- unresolved Desktop relinks caused by active Codex/Desktop processes are warnings, not official auth/provider isolation failures.
- shared MCP/project config sections survive official account/API key switching.
- managed config keys remain top-level.
- Home shows official ChatGPT and official API key management.
- `codex.exe` is described as Desktop follow-mode, not launcher replacement.
- `Login` uses the upstream `@openai/codex/bin/codex.js` entrypoint for temporary capture flows instead of recursively going through the managed plain `codex` wrapper.
- temporary capture login clears inherited `OPENAI_API_KEY` and `OPENAI_BASE_URL` and forces `cli_auth_credentials_store="file"` so the authorization URL does not inherit a stale `allowed_workspace_id`.

## Windows Guardrails

- Write text files as UTF-8 without BOM.
- Keep launcher scripts lightweight.
- Patch only managed config keys.
- Do not hard-link or junction live SQLite `state_5.sqlite*` files between homes.
- Do not let `model_provider = "api111"` or `[model_providers.api111]` remain in official configs.
- Do not present `.codex-official` as a permanent cross-platform requirement.
- Do not claim Desktop-only follow-mode unless the plain `codex` wrapper still points at `.codex-official`.
- Do not treat `CODEX_HOME` pinning by itself as sufficient proof that plain `codex` is isolated; the launcher must also force the official provider/auth overrides.
- Do not route temporary login capture through the managed plain `codex` wrapper on Windows; call the upstream CLI entrypoint directly with explicit official overrides.
