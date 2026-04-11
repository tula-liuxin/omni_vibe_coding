# Troubleshooting

## Switch Looks Successful But Codex Still Uses The Old Workspace

Check these in order:

- the active official `~/.codex/auth.json` really changed
- `forced_chatgpt_workspace_id` is at the TOML top level
- the selected saved item has a different real `chatgpt_account_id`
- there are no already-running Codex windows still using stale in-memory auth

## Duplicate Saved Entries

If two entries share the same real login identity, they are not two real switch targets. Compact them.

## Login Page Semantics

- `Login now` means perform a real login flow now.
- `Use current signed-in Codex` means import the current official login without reauthenticating.

## `Login now` Fails With `Workspace restriction error`

Symptoms:

- the browser URL or terminal output contains `allowed_workspace_id=...`
- Codex prints `Login is restricted to workspace id ...`
- the temporary capture home stays empty because `auth.json` is never created

What this usually means on Windows:

- the fresh login flow was started through the plain `codex` wrapper instead of the upstream CLI entrypoint
- or the login inherited a stale credential carrier instead of using file-backed auth inside the temporary `CODEX_HOME`

Check these in order:

1. Verify `codex_m` is running a managed wrapper and not a stale launcher copy:

```powershell
Select-String -Path "$env:APPDATA\npm\codex.ps1" -Pattern "codex_m managed official codex CLI wrapper",'\.codex-official','model_provider="openai"','cli_auth_credentials_store="file"',"OPENAI_API_KEY","OPENAI_BASE_URL"
node scripts/validate_codex_manager.js
```

2. If the launcher looks correct but `Login now` still fails, reinstall the Windows adapter:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install_windows.ps1
```

3. Probe the raw upstream login path with a temporary home. The authorization URL should not contain `allowed_workspace_id`:

```powershell
$captureHome = Join-Path $env:TEMP ("codex-login-probe-" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Force -Path $captureHome | Out-Null
$env:CODEX_HOME = $captureHome
Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:OPENAI_BASE_URL -ErrorAction SilentlyContinue
node "$env:APPDATA\npm\node_modules\@openai\codex\bin\codex.js" login -c 'model_provider="openai"' -c 'cli_auth_credentials_store="file"'
```

If that probe shows a clean URL while `codex_m` still fails, the installed `codex_m` runtime is stale and needs to be refreshed from the repository source.

## Logout Semantics

Logout removes the saved snapshot. It should not wipe shared session/history/config state.

## Config Placement Bugs

If `forced_chatgpt_workspace_id` is nested under another TOML table, Codex will ignore it.

## Plain `codex` Still Uses A Third-Party Provider On Windows

Check the real launch result, not just the file layout:

```powershell
codex exec --skip-git-repo-check "Write only this exact line: OFFICIAL_VERIFY"
```

Expected in the startup block:

- `provider: openai`
- `model: gpt-5.4` or whatever official model is currently stored in `%USERPROFILE%\.codex-official\config.toml`

If it still shows a third-party provider:

1. Reinstall the Windows adapter:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install_windows.ps1
```

2. Verify the managed wrapper now contains both the home pin and the forced official overrides:

```powershell
Select-String -Path "$env:APPDATA\npm\codex.ps1" -Pattern "\.codex-official",'model_provider="openai"','cli_auth_credentials_store="file"',"OPENAI_API_KEY","OPENAI_BASE_URL"
Select-String -Path "$env:APPDATA\npm\codex.cmd" -Pattern "codex.ps1","ExecutionPolicy Bypass"
node scripts/validate_codex_manager.js
```

Notes:

- On current Windows builds, pinning `CODEX_HOME` alone is not a strong enough guarantee.
- The managed wrapper must also inject the official provider/auth overrides and clear inherited `OPENAI_*` env overrides.
