---
name: codex-dual-provider-windows
description: Configure and maintain a split Codex CLI setup on Windows where official codex remains unchanged, `codex3` keeps third-party auth/config isolated under `~/.codex-apikey`, shares session directories from `~/.codex`, and `codex3_m` can switch between `compat` and `stable-http` provider modes while the managers can optionally steer which login/auth plain `codex.exe` should use. Use when users ask to separate official and third-party accounts, add or update codex3 login behavior, maximize safe session sharing without mixing auth state, switch the login used by `codex.exe`, or troubleshoot provider routing/auth/config-encoding issues.
---

# Codex Dual Provider Windows

## Overview

- Keep official `codex` behavior unchanged.
- Create and maintain a dedicated third-party command (default `codex3`).
- Create and maintain a dedicated third-party manager command `codex3_m`.
- Keep third-party auth and provider metadata under a separate home for `codex3` itself.
- Share `sessions/`, `archived_sessions/`, and `session_index.jsonl` from the official `~/.codex` home into the third-party home.
- Support two third-party provider modes:
  - `compat`: provider id stays aligned with the built-in `openai` lane for better recent-session visibility.
  - `stable-http`: provider id switches to a custom id with websocket support disabled for gateways that reconnect too often.
- Support explicit switching of the login used by plain `codex.exe` without replacing the `codex` launcher.
- Expose a quick `Plain codex -> codex3` action from `codex3_m` that temporarily bridges plain `codex` to the active third-party profile without replacing the launcher.
- When the user provides a provider tutorial, treat that tutorial as the source of truth for the third-party config shape and values.

## Workflow

1. Confirm target values before changes:
   - command name (default `codex3`)
   - third-party home (default `%USERPROFILE%\\.codex-apikey`)
   - shared Codex home for session directories (default `%USERPROFILE%\\.codex`)
   - provider mode (`compat` or `stable-http`)
   - tutorial-provided provider name, base URL, model, review model, reasoning effort, and other required top-of-file settings
2. If the user supplies a screenshot or pasted tutorial, extract the values from that tutorial first.
3. Map the tutorial's provider values onto the split-lane design:
   - third-party auth stays under `%USERPROFILE%\\.codex-apikey`
   - `codex3` itself runs from that third-party home
   - `codex3` shares `sessions/` and `archived_sessions/` from `%USERPROFILE%\\.codex`
   - `compat` is the default when the goal is better recent-session visibility
   - `stable-http` is the recovery path when the gateway keeps disconnecting websocket streams
   - plain `codex` can be temporarily bridged through the managers when the user wants one-command switching
4. Run `scripts/install_windows.ps1` to install or update `codex3_m` and the third-party wrapper.
5. Use `codex3_m` to manage third-party provider settings, mode, and saved API key profiles.
6. Run `<command> login`, paste API key, and press Enter, or activate a saved profile from `codex3_m`.
7. Verify separation:
   - `codex exec --skip-git-repo-check "hello"` should show `provider: openai`.
   - `<command> exec --skip-git-repo-check "hello"` should show third-party provider.
   - `%USERPROFILE%\\.codex-apikey\\sessions` should resolve into `%USERPROFILE%\\.codex\\sessions`.
8. If the task is specifically about switching which login plain `codex.exe` should use, make that intent explicit:
   - official-login switching belongs to `codex_m`
   - temporary third-party bridging belongs to `codex3_m`
   - neither path should imply deleting or relocating the shared official sessions/history tree
9. If validation fails, follow `references/troubleshooting.md`.

## Deterministic Behavior

- Set `CODEX_HOME` to the third-party home in wrapper startup for `codex3`.
- Restore `CODEX_HOME` after the wrapper exits.
- Create directory junctions for `sessions/` and `archived_sessions/` from the third-party home into the shared official home.
- Create a hard link for `session_index.jsonl` so recent-session discovery stays aligned.
- Remove inherited `OPENAI_API_KEY` during third-party child runs, then restore it after exit.
- Force provider routing at runtime with `-c` overrides.
- In `compat` mode, route through the built-in `openai` lane and set `openai_base_url`.
- In `stable-http` mode, route through a custom provider id with `supports_websockets = false`.
- Keep `codex` untouched; only create/update `<command>.ps1` and `<command>.cmd`.
- Keep `codex.exe` login switching separate from `codex3`'s isolated auth/config home so the official and third-party lanes remain understandable.
- Implement `<command> login` to write `auth.json` in the tutorial-compatible `OPENAI_API_KEY` file-backed shape.
- Implement `<command> login status` as local-file check only (no remote dependency).
- Write `auth.json`, `config.toml`, and wrapper scripts as UTF-8 without BOM.
- Ensure the tutorial-required provider block is mirrored under the third-party home for inspection and repair.

## Script Usage

Run from the skill folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install_windows.ps1
```

Common overrides:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install_windows.ps1 `
  -ManagerCommandName codex3_m `
  -ThirdPartyCommandName codex3
```

If the tutorial changes, update the installed provider settings with `codex3_m provider set ...` or `codex3_m mode set ...` so future upgrades stay aligned with the tutorial instead of old hardcoded defaults.

## Resources

- `scripts/install_windows.ps1`: Install/update `codex3_m` plus the third-party wrapper and plain-codex bridge behavior.
- `scripts/install_codex3_wrapper.ps1`: Install/update the third-party launcher for `codex3`, including shared session junctions.
- `scripts/validate_codex3_manager.js`: Validate `codex3_m`, the wrapper, plain-codex bridge state, and third-party auth placement.
- `assets/windows-runtime/`: Machine-local runtime for `codex3_m`.
- `references/troubleshooting.md`: Diagnose common split-setup failures quickly.

## Guardrails

- Do not replace or modify the existing `codex` launcher.
- Do not store third-party key in official `~\\.codex` path.
- Do not let `codex3` or `codex3_m` rewrite official `~\\.codex/auth.json` or official manager state.
- Do not describe `codex.exe` login switching as a full shared-home replacement when the actual intent is to swap auth locally.
- Do not rewrite `codex3` into a full shared-home auth path; keep auth/config isolated even when session directories are shared.
- Do not prefer `compat` mode blindly when the gateway is known to close websocket streams before `response.completed`; switch to `stable-http`.
- Do not silently ignore a user-supplied tutorial when its values differ from the current defaults; update the installer/runtime to match the tutorial instead.
- If a key is exposed in chat or logs, rotate it and rerun `<command> login`.
