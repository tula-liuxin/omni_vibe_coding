# Troubleshooting

## Quick Checks

Run these first:

```powershell
Get-Command codex,codex3,codex3_m | Format-Table Name,Source,Path -AutoSize
node scripts/validate_codex3_manager.js
codex3 login status
codex3_m use-codex3 --force
codex_m use-codex --force
codex exec --skip-git-repo-check "hello"
codex3 exec --skip-git-repo-check "hello"
```

Expected:

- `codex` reports `provider: openai`.
- `codex3` reports your third-party provider.
- `codex3_m` reports no obvious issues, or only warnings you understand.
- The mirrored third-party `config.toml` under `%userprofile%\\.codex-apikey` contains the tutorial-required provider block.
- `codex3` keeps third-party auth/config under `%userprofile%\\.codex-apikey`.
- `codex3` shares `sessions/` and `archived_sessions/` from the shared Codex home under `%userprofile%\\.codex`.
- `codex3_m use-codex3 --force` is the thing that temporarily bridges plain `codex` into the third-party lane.

## Symptom: `codex3` is slow or keeps showing `Reconnecting...`

Likely cause:

- The current provider mode is `compat`, which keeps provider id compatibility with the built-in `openai` lane but may trigger websocket reconnects on some third-party gateways.

Fix:

1. Switch to the HTTP-stable mode:

```powershell
codex3_m mode set stable-http
```

2. Verify:

```powershell
codex3_m mode show
codex3 exec --skip-git-repo-check "hello"
```

Expected:

- `codex3_m mode show` reports `stable-http`
- `codex3` reports provider `sub2api`
- websocket reconnect noise should reduce or disappear on gateways that do not handle the websocket path well

Tradeoff:

- `stable-http` improves gateway stability, but recent session lists will no longer line up as closely with the built-in `openai` lane.

## Tutorial Mapping Rule

If the provider tutorial shows examples under `%userprofile%\\.codex\\config.toml` and `%userprofile%\\.codex\\auth.json`:

- keep those exact provider values,
- keep third-party auth under `%userprofile%\\.codex-apikey\\auth.json`,
- mirror the provider block under `%userprofile%\\.codex-apikey\\config.toml`,
- run `codex3` with that third-party auth/config while sharing session directories from `%userprofile%\\.codex`,
- use the manager quick action only when you want plain `codex` to follow the third-party lane,
- and leave official `~\\.codex\\auth.json` untouched.

## Symptom: `codex3` does not see sessions created by plain `codex`

Likely cause:

- The shared session junctions under `%userprofile%\\.codex-apikey` were never created or were replaced by a normal directory.

Fix:

1. Re-run the wrapper installer:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install_codex3_wrapper.ps1
```

2. Validate that the third-party home now resolves its session dirs into the shared home:

```powershell
node scripts/validate_codex3_manager.js
```

Expected:

- `%userprofile%\\.codex-apikey\\sessions` resolves to `%userprofile%\\.codex\\sessions`
- `%userprofile%\\.codex-apikey\\archived_sessions` resolves to `%userprofile%\\.codex\\archived_sessions`

## Symptom: `expected value at line 1 column 1`

Likely cause:

- `auth.json` or `config.toml` has UTF-8 BOM.

Fix:

1. Re-run `scripts/install_codex3_wrapper.ps1`.
2. Run `codex3 login` again.

Notes:

- Wrapper and setup script write UTF-8 without BOM.
- This error can appear immediately on `codex3` startup.

## Symptom: 401 from `https://api.openai.com/v1/responses`

Likely cause:

- Third-party route not applied; command is still using official provider path.

Fix:

1. Ensure you started `codex3`, not `codex`.
2. Ensure `codex3.ps1` exists in `%APPDATA%\\npm`.
3. Re-run installer:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install_codex3_wrapper.ps1
```

## Symptom: after running `codex3`, plain `codex` opens the wrong login page or ignores `codex_m` switching

Likely cause:

- The current terminal session still has `CODEX_HOME` pointing at the third-party home.
- In PowerShell this can happen if an older `codex3.ps1` wrapper set `$env:CODEX_HOME` and did not restore it.

Fix:

1. Clear the leaked variable in the current window:

```powershell
Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue
```

2. Or open a fresh terminal window.
3. Re-run the wrapper installer so future `codex3` runs restore `CODEX_HOME` automatically:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install_windows.ps1
```

Quick verify:

```powershell
codex3 login status
Write-Output $env:CODEX_HOME
```

Expected:

- `codex3` still works against the third-party home.
- After the command exits, `CODEX_HOME` in the parent PowerShell session is empty or unchanged from its previous value.

## Symptom: `codex3` uses the official API key or ignores the saved third-party profile

Likely cause:

- The parent shell exports `OPENAI_API_KEY`.
- An older wrapper is still installed and does not clear that variable before launching the child codex process.

Fix:

1. Reinstall the wrapper and manager:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install_windows.ps1
```

2. Verify the wrapper contains the isolation restore logic:

```powershell
Select-String -Path "$env:APPDATA\npm\codex3.ps1" -Pattern "previousCodexHome","previousOpenAiApiKey","Remove-Item Env:OPENAI_API_KEY"
```

## Symptom: `codex3` returns `Failed to parse request body`

Likely cause:

- The wrapper was changed to an experimental shared-home or env-key auth route that your provider gateway does not fully support.

Fix:

1. Reinstall the stable wrapper:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install_codex3_wrapper.ps1 -ForceRewriteConfig
```

2. Verify the third-party config uses file-backed auth again:

```powershell
Select-String -Path "$HOME\\.codex-apikey\\config.toml" -Pattern "requires_openai_auth = true"
```

3. Re-activate the desired profile from `codex3_m`.

## Symptom: 401 from third-party URL with `INVALID_API_KEY`

Likely cause:

- Key invalid, expired, or mismatched with provider account.

Fix:

1. Rotate/generate key in provider dashboard.
2. Run `codex3 login` and paste new key.
3. Verify with `codex3 login status`.

## Symptom: MCP startup warning mentioning `codex_apps`

Likely cause:

- Third-party endpoint does not support app MCP handshake.

Fix:

- Keep `features.apps=false` for the third-party wrapper path.

## Symptom: `model not found` or 404

Likely cause:

- Model name is unsupported by provider.

Fix:

1. Confirm available model name in provider panel.
2. Re-run installer with `-Model <supported-name>`.

## Symptom: TOML parse error (for example unclosed table)

Likely cause:

- Manual edit introduced invalid TOML syntax.

Fix:

1. Re-run installer with `-ForceRewriteConfig`.
2. Reapply only required customizations.

## Safety Reminder

- Keep official and third-party keys separated.
- If any key appears in chat/logs/screenshots, rotate it immediately.
