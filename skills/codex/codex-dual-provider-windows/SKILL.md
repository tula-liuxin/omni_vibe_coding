---
name: codex-dual-provider-windows
description: Configure and maintain a split Codex CLI setup on Windows where official codex remains unchanged and a dedicated command (default codex3) uses a third-party OpenAI-compatible provider while reusing shared Codex state and keeping third-party API key handling separate. Use when users ask to separate official and third-party accounts, add or update codex3 login behavior, or troubleshoot provider routing/auth/config-encoding issues.
---

# Codex Dual Provider Windows

## Overview

- Keep official `codex` behavior unchanged.
- Create and maintain a dedicated third-party command (default `codex3`).
- Create and maintain a dedicated third-party manager command `codex3_m`.
- Keep third-party auth and provider metadata under a separate home, while reusing a shared Codex runtime home by default.
- When the user provides a provider tutorial, treat that tutorial as the source of truth for the third-party config shape and values.

## Workflow

1. Confirm target values before changes:
   - command name (default `codex3`)
   - third-party home (default `%USERPROFILE%\\.codex-apikey`)
   - tutorial-provided provider name, base URL, model, review model, reasoning effort, and other required top-of-file settings
2. If the user supplies a screenshot or pasted tutorial, extract the values from that tutorial first.
3. Map the tutorial's provider values onto the shared-state wrapper design:
   - third-party auth stays under `%USERPROFILE%\\.codex-apikey`
   - shared runtime state defaults to `%USERPROFILE%\\.codex`
4. Run `scripts/install_windows.ps1` to install or update `codex3_m` and the shared-state wrapper.
5. Use `codex3_m` to manage third-party provider settings and saved API key profiles.
6. Run `<command> login`, paste API key, and press Enter, or activate a saved profile from `codex3_m`.
7. Verify separation:
   - `codex exec --skip-git-repo-check "hello"` should show `provider: openai`.
   - `<command> exec --skip-git-repo-check "hello"` should show third-party provider.
8. If validation fails, follow `references/troubleshooting.md`.

## Deterministic Behavior

- Set `CODEX_HOME` to the shared Codex home in wrapper startup.
- Restore `CODEX_HOME` after the wrapper exits.
- Remove inherited `OPENAI_API_KEY` during third-party child runs, then restore it after exit.
- Inject the active third-party API key through a command-scoped provider env var instead of rewriting shared `auth.json`.
- Force provider routing at runtime with `-c` overrides.
- Keep `codex` untouched; only create/update `<command>.ps1` and `<command>.cmd`.
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

If the tutorial changes, update the installed provider settings with `codex3_m provider set ...` so future upgrades stay aligned with the tutorial instead of old hardcoded defaults.

## Resources

- `scripts/install_windows.ps1`: Install/update `codex3_m` plus the shared-state third-party wrapper.
- `scripts/install_codex3_wrapper.ps1`: Install/update the shared-state third-party launcher.
- `scripts/validate_codex3_manager.js`: Validate `codex3_m`, the wrapper, shared runtime home, and third-party auth placement.
- `assets/windows-runtime/`: Machine-local runtime for `codex3_m`.
- `references/troubleshooting.md`: Diagnose common split-setup failures quickly.

## Guardrails

- Do not replace or modify the existing `codex` launcher.
- Do not store third-party key in official `~\\.codex` path.
- Do not let `codex3` or `codex3_m` rewrite official `~\\.codex/auth.json` or official manager state.
- Do not give `codex3` its own fully separate long-lived `CODEX_HOME` unless the user explicitly asks for stronger isolation than shared-state mode.
- Do not silently ignore a user-supplied tutorial when its values differ from the current defaults; update the installer/runtime to match the tutorial instead.
- If a key is exposed in chat or logs, rotate it and rerun `<command> login`.
