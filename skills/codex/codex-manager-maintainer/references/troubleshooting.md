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
