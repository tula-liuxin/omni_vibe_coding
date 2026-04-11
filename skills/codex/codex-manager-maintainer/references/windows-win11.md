# Windows 11

Load this file only when the target platform is Windows or when porting the Windows adapter elsewhere.

## Current Windows Adapter

- Current manager home: `%USERPROFILE%\.codex-manager`
- Current Desktop home: `%USERPROFILE%\.codex`
- Current official CLI home used by the wrapper: `%USERPROFILE%\.codex-official`
- Current launchers: `%APPDATA%\npm\codex_m.ps1`, `%APPDATA%\npm\codex_m.cmd`, `%APPDATA%\npm\codex.ps1`, and `%APPDATA%\npm\codex.cmd`

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
- plain `codex` launcher is wrapped to pin `CODEX_HOME` to `%USERPROFILE%\.codex-official`.
- the managed `codex.ps1` wrapper injects the official provider/auth overrides for plain CLI launches, including `model_provider="openai"` and `cli_auth_credentials_store="file"`.
- the managed `codex.ps1` wrapper clears inherited `OPENAI_API_KEY` and `OPENAI_BASE_URL` before launching the child Codex process.
- runtime files exist under manager home.
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
- Do not present `.codex-official` as a permanent cross-platform requirement.
- Do not claim Desktop-only follow-mode unless the plain `codex` wrapper still points at `.codex-official`.
- Do not treat `CODEX_HOME` pinning by itself as sufficient proof that plain `codex` is isolated; the launcher must also force the official provider/auth overrides.
- Do not route temporary login capture through the managed plain `codex` wrapper on Windows; call the upstream CLI entrypoint directly with explicit official overrides.
