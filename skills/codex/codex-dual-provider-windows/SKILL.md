---
name: codex-dual-provider-windows
description: Maintain the Windows split setup where official Codex stays official while `codex3` and `codex3_m` manage a third-party API key lane. Use when Codex needs to install, repair, upgrade, or explain `codex3`/`codex3_m`, keep third-party auth isolated, make Desktop `codex.exe` follow the third-party lane, or preserve safe session sharing without mixing auth carriers.
---

# Codex Dual Provider Windows

## Purpose

- Keep the official lane understandable and unchanged.
- Keep third-party auth/config isolated from the official lane.
- Treat `codex3_m` as the manager for third-party API key profiles.
- Keep session/history, MCP/project config, skills, memories, rules, and vendor imports stable across official/third-party switching without mixing auth carriers.
- The default third-party lane is `codex3` + `codex3_m`, using the `api111` API-key configuration shape.

## Stable Responsibilities

`codex3_m` is responsible for:

- saving and switching third-party API key profiles
- applying the active third-party API key profile to `codex3`
- making Desktop `codex.exe` follow the third-party lane when requested
- maintaining the split Windows adapter where official and third-party auth/config remain separated
- keeping the generated third-party config aligned with the current `api111` tutorial shape
- preserving shared MCP servers, project trust/config, skills, memories, rules, and session discovery when accounts or API keys are switched

## Public Contract

- Official `codex` stays on the official lane.
- `codex3` stays on the third-party lane.
- `codex3_m` manages saved third-party API key profiles.
- `codex.exe to use` means "choose whether Desktop `codex.exe` should follow the active third-party lane".
- On Windows, that Desktop-only contract assumes the managed plain `codex` launcher is pinned to `~/.codex-official`.
- On current Windows builds, that managed launcher must also force the official provider/auth overrides for plain CLI launches; `CODEX_HOME` pinning alone is not a strong enough guarantee.
- `Config` is the small settings surface for command/path/model details on the fixed `api111` lane.
- Third-party auth and provider-owned config remain isolated from the official lane.
- Unmanaged MCP server config, project config/trust, skills, memories, rules, vendor imports, and session/history discovery should be stable across `codex_m`/`codex3_m` switching.
- Default shared substrate is `%USERPROFILE%\.codex-shared`.
- Default shared state includes:
  - `sessions`
  - `archived_sessions`
  - `skills`
  - `memories`
  - `rules`
  - `vendor_imports`
  - `session_index.jsonl`
- Shared MCP server, MCP OAuth, and project config fragments are stored under `.codex-shared\config` and merged into generated lane configs.
- SQLite sidebar/thread databases must not be live-shared.
- If sidebar/thread views need alignment, use synchronization or backfill instead of direct SQLite sharing.

## Shared Substrate Boundary

The shared substrate is not "one single config file with different auth". It is a shared state layer plus lane-specific generated configs.

Shared via `%USERPROFILE%\.codex-shared`:

- `sessions`
- `archived_sessions`
- `skills`
- `memories`
- `rules`
- `vendor_imports`
- `session_index.jsonl`
- shared config fragments under `.codex-shared\config`, such as MCP server config, MCP OAuth top-level settings, and project trust/config fragments

Isolated per lane:

- auth carriers such as ChatGPT login snapshots, official API key profiles, and third-party `auth.json`
- lane-owned provider sections such as `model_provider = "openai"` / `model_provider = "api111"` and `[model_providers.*]`
- managed top-level provider/auth keys that belong to one lane
- the lane homes themselves, such as `~/.codex-official` and `~/.codex-apikey`
- SQLite sidebar/thread databases such as `state_5.sqlite*`

Bridge-only exception:

- `codex.exe to use` may copy the active lane into the Desktop lane on purpose
- this is an explicit bridge operation, not default substrate sharing

## Workflow

1. Read `references/contract.md`.
2. Read `references/windows-win11.md`.
3. Read `references/troubleshooting.md` when validation fails or behavior drifts.
4. Confirm whether the task is about:
   - install or repair
   - third-party API key profile management
   - `codex.exe to use` / Desktop follow-mode switching
   - config or wrapper repair for the `codex3` lane
5. Use bundled installers and validators when possible.
6. Validate separation, sharing, and `codex.exe to use` behavior after changes.

## Reading Rules

- Use `SKILL.md` for the stable function contract.
- Use `references/contract.md` for split-lane behavior and sharing rules.
- Use `references/windows-win11.md` for current Windows paths, wrappers, and installer/runtime detail.
- Keep wrapper mechanics and Windows path details out of `SKILL.md`.

## Resources

- `scripts/install_windows.ps1`
  Install or update `codex3_m` plus the Windows split-lane adapter.
- `scripts/install_codex3_wrapper.ps1`
  Install or update the `codex3` wrapper and session-sharing links.
- `scripts/validate_codex3_manager.js`
  Validate saved third-party profiles, wrapper state, shared session targets, and `codex.exe to use` assumptions.
- `assets/windows-runtime/`
  Current Windows runtime for `codex3_m`.
- `references/troubleshooting.md`
  Use for common split-lane failures and provider drift.

## Guardrails

- Do not store third-party auth inside the official home.
- Do not let `codex3_m` rewrite official manager state except for the explicit `codex.exe to use` bridge.
- Do not describe `codex.exe to use` as launcher replacement, plain `codex` CLI switching, or whole-home replacement.
- Do not allow `codex.exe to use` to run on Windows if the managed plain `codex` launcher is not pinned to `~/.codex-official`.
- Do not share auth carriers, provider tables, or managed top-level provider keys through the shared substrate.
- Do not let `[model_providers.openai]` or `model_provider = "openai"` leak into the `codex3` config.
- Do not live-share SQLite `state_5.sqlite*` files between official and third-party homes.
- Do not re-introduce multi-mode provider compatibility (`compat`, `stable-http`) into the public contract.
- Do not expose protocol fields such as `model_provider`, provider table names, `wire_api`, or auth-carrier settings as everyday controls.
