---
name: codex-dual-provider-windows
description: Maintain the Windows split setup where official Codex stays official while `codex3` and `codex3_m` manage a third-party API key lane. Use when Codex needs to install, repair, upgrade, or explain `codex3`/`codex3_m`, keep third-party auth isolated, make Desktop `codex.exe` follow the third-party lane, or preserve safe session sharing without mixing auth carriers.
---

# Codex Dual Provider Windows

## Purpose

- Keep the official lane understandable and unchanged.
- Keep third-party auth/config isolated from the official lane.
- Treat `codex3_m` as the manager for third-party API key profiles.
- Keep session/history sharing as broad as safely possible without mixing auth carriers.
- When a new provider tutorial should be tested safely, prefer a second parallel command/home pair such as `codex31` + `codex31_m` instead of rewriting the existing `codex3` lane in place.

## Stable Responsibilities

`codex3_m` is responsible for:

- saving and switching third-party API key profiles
- applying the active third-party API key profile to `codex3`
- making Desktop `codex.exe` follow the third-party lane when requested
- maintaining the split Windows adapter where official and third-party auth/config remain separated

Advanced provider settings such as provider mode, tutorial mapping, base URL, model, and wrapper reinstall remain supported, but they are advanced compatibility tools, not the primary public identity contract.

## Public Contract

- Official `codex` stays on the official lane.
- `codex3` stays on the third-party lane.
- `codex3_m` manages saved third-party API key profiles.
- `codex.exe` means "make the Desktop lane follow the active third-party lane".
- Third-party auth/config remain isolated from the official lane.
- Default shared state is limited to:
  - `sessions`
  - `archived_sessions`
  - `session_index.jsonl`
- SQLite sidebar/thread databases must not be live-shared.
- If sidebar/thread views need alignment, use synchronization or backfill instead of direct SQLite sharing.

## Workflow

1. Read `references/contract.md`.
2. Read `references/windows-win11.md`.
3. Read `references/troubleshooting.md` when validation fails or behavior drifts.
4. Confirm whether the task is about:
   - install or repair
   - third-party API key profile management
   - Desktop follow-mode switching
   - advanced provider compatibility (`provider` / `mode`)
   - safe rollout of a new provider tutorial through a parallel lane such as `codex31`
5. Use bundled installers and validators when possible.
6. Validate separation, sharing, and Desktop follow-mode behavior after changes.

## Reading Rules

- Use `SKILL.md` for the stable function contract.
- Use `references/contract.md` for split-lane behavior and sharing rules.
- Use `references/windows-win11.md` for current Windows paths, wrappers, and installer/runtime detail.
- Keep provider tutorial mapping and wrapper mechanics out of `SKILL.md`.

## Resources

- `scripts/install_windows.ps1`
  Install or update `codex3_m` plus the Windows split-lane adapter.
- `scripts/install_codex31_api111_windows.ps1`
  Install the safe parallel `codex31` + `codex31_m` lane for the newer `api111` tutorial shape.
- `scripts/install_codex3_wrapper.ps1`
  Install or update the `codex3` wrapper and session-sharing links.
- `scripts/validate_codex3_manager.js`
  Validate saved third-party profiles, wrapper state, shared session targets, and Desktop follow-mode assumptions.
- `assets/windows-runtime/`
  Current Windows runtime for `codex3_m`.
- `references/codex31-api111-quickstart.md`
  Fast reproduction steps for installing the parallel `codex31` lane on another Windows machine.
- `references/troubleshooting.md`
  Use for common split-lane failures and provider drift.

## Guardrails

- Do not store third-party auth inside the official home.
- Do not let `codex3_m` rewrite official manager state except for the explicit Desktop follow-mode bridge.
- Do not describe `codex.exe` follow-mode as launcher replacement or whole-home replacement.
- Do not expand third-party default sharing beyond `sessions`, `archived_sessions`, and `session_index.jsonl` unless the task explicitly requires it and safety is clear.
- Do not live-share SQLite `state_5.sqlite*` files between official and third-party homes.
- Do not silently ignore user-supplied provider tutorial values when advanced provider compatibility is the task.
