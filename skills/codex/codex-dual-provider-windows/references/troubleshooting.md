# Troubleshooting

## Quick Checks

```powershell
Get-Command codex,codex3,codex3_m | Format-Table Name,Source,Path -AutoSize
node scripts/validate_codex3_manager.js
codex3 login status
codex3_m use-codex3 --force
codex_m use-codex --force
```

Expected:

- `codex` stays on the official lane.
- `codex3` stays on the third-party lane.
- `codex3_m` reports no blocking issues, or only warnings you understand.
- the mirrored third-party `config.toml` under `%USERPROFILE%\.codex-apikey` keeps the fixed `api111` block.
- `codex3` keeps third-party auth/config under `%USERPROFILE%\.codex-apikey`.

## Symptom: `codex3` returns 401 against `https://api.xcode.best/v1/responses`

Likely cause:

- The token is valid, but local `codex3` is not reading it from `auth.json`.
- Old wrapper/config content is missing `cli_auth_credentials_store = "file"`.
- A long-running Codex process is still using stale in-memory auth/config.

Fix:

1. Reinstall the Windows adapter:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install_windows.ps1
```

2. Rewrite the live config through the manager:

```powershell
codex3_m config set --command-name codex3 --third-party-home "$HOME\.codex-apikey" --shared-codex-home "$HOME\.codex" --base-url "https://api.xcode.best/v1" --model "gpt-5.4" --model-reasoning-effort high --model-context-window 1000000 --model-auto-compact-token-limit 900000
```

3. Close the currently reconnecting `codex3`/Codex windows and start a fresh run.

Verify:

```powershell
Get-Content "$HOME\.codex-apikey\config.toml"
Select-String -Path "$env:APPDATA\npm\codex3.ps1" -Pattern 'cli_auth_credentials_store','preferred_auth_method','model_provider','wire_api'
```

Expected:

- `config.toml` contains `cli_auth_credentials_store = "file"`.
- `codex3.ps1` forces `cli_auth_credentials_store="file"` and the `api111` provider block.

## Symptom: `codex.exe to use` also changes the plain `codex` CLI

Likely cause:

- The managed plain `codex` launcher is missing or incomplete.

Fix:

```powershell
powershell -ExecutionPolicy Bypass -File "$HOME\.codex\skills\custom\codex-manager-maintainer\scripts\install_windows.ps1"
node "$HOME\.codex\skills\custom\codex-manager-maintainer\scripts\validate_codex_manager.js"
```

Expected:

- `codex.ps1` mentions `.codex-official`, `model_provider="openai"`, and `cli_auth_credentials_store="file"`.
- plain `codex` stays official after `codex3_m use-codex3 --force`.

## Symptom: `codex3` does not see sessions created by plain `codex`

Likely cause:

- The shared session junctions or hard link were replaced by normal files/directories.

Fix:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install_codex3_wrapper.ps1
node scripts/validate_codex3_manager.js
```

Expected:

- `%USERPROFILE%\.codex-apikey\sessions` resolves to `%USERPROFILE%\.codex\sessions`
- `%USERPROFILE%\.codex-apikey\archived_sessions` resolves to `%USERPROFILE%\.codex\archived_sessions`
- `%USERPROFILE%\.codex-apikey\session_index.jsonl` is hard-linked to `%USERPROFILE%\.codex\session_index.jsonl`
