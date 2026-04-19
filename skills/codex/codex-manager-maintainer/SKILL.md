---
name: codex-manager-maintainer
description: Maintain `codex_m` as the machine-local Windows manager for official Codex identities. Use when Codex needs to install, repair, upgrade, or explain `codex_m`, switch the official identity that normal `codex`/Desktop should follow, or preserve saved ChatGPT snapshots and official API key profiles on Windows.
---

# Codex Manager Maintainer

## Purpose

- Keep `codex_m` focused on the official Codex lane.
- Treat saved official identities as durable user data.
- Keep shared MCP/project config, sessions, skills, memories, rules, and vendor imports stable when switching between `codex_m`, `codex3_m`, and their API/account profiles.
- Preserve behavior first, even when platform adapters change.
- Keep the public contract separate from the Windows implementation details.

## Stable Responsibilities

`codex_m` is responsible for all official identities:

- official ChatGPT login snapshots
- official API key profiles
- applying one saved official identity to the official Codex lane
- making Desktop `codex.exe` follow the `codex_m`-managed official identity
- preserving the shared substrate used by official and third-party lanes while keeping auth/provider ownership isolated

`codex_m` is not a third-party provider manager. Third-party API key flows belong to `codex3_m`.

## Public Contract

- Home stays focused on the official lane: `Login`, `Account Manage`, `API Key Manage`, `codex.exe`, `Quit`.
- `Login` can save either an official ChatGPT snapshot or an official API key profile.
- `Account Manage` operates on saved official ChatGPT snapshots only.
- `API Key Manage` operates on saved official API key profiles only.
- `codex.exe` means "make the Desktop lane follow the official identity managed by `codex_m`".
- On Windows, the plain `codex` CLI should be wrapped to use `~/.codex-official`, so Desktop `codex.exe` follow-mode and CLI follow-mode stay separate.
- On current Windows builds, that wrapper must also force the official provider/auth overrides for plain CLI launches; `CODEX_HOME` pinning alone is not a strong enough guarantee.
- Switching the official identity updates auth carriers and managed config keys; it does not mean swapping the whole Codex home.
- Shared session/history/thread metadata, MCP/MCP OAuth/project config, skills, memories, rules, and vendor imports should stay aligned as much as safely possible.
- Auth carriers and managed provider config keys stay separate from shared state.
- On Windows, shared state is centralized in `%USERPROFILE%\.codex-shared` and linked into official homes.
- SQLite thread/sidebar databases must not be live-shared across homes; sync or backfill is acceptable.

## Shared Substrate Boundary

The shared substrate is a shared state layer, not a single official/third-party config file with only the auth changed.

Shared via `%USERPROFILE%\.codex-shared`:

- `sessions`
- `archived_sessions`
- `skills`
- `memories`
- `rules`
- `vendor_imports`
- `session_index.jsonl`
- shared config fragments under `.codex-shared\config`, including shared MCP server config, MCP OAuth top-level settings, and project trust/config fragments

Isolated from shared state:

- official auth carriers and saved identity files
- third-party auth carriers and third-party provider-owned config
- lane-owned provider sections such as `model_provider = "openai"` / `model_provider = "api111"` and `[model_providers.*]`
- managed top-level provider/auth keys
- the lane homes themselves
- SQLite sidebar/thread databases such as `state_5.sqlite*`

Bridge-only exception:

- Desktop follow-mode may temporarily mirror one lane into the Desktop lane
- that bridge is explicit mode switching, not default substrate sharing

## Workflow

1. Run `scripts/detect_environment.js`.
2. Read `references/common-contract.md`.
3. Read `references/auth-and-state.md`.
4. Read `references/windows-win11.md`.
5. Read `references/upstream-watchpoints.md` only when upstream Codex behavior appears to have drifted.
6. Classify the task:
   - install `codex_m`
   - repair broken `codex_m`
   - upgrade an existing `codex_m`
   - explain or debug official identity behavior
   - refine the Windows adapter
7. Validate behavior, not just file presence.

## Reading Rules

- Use `SKILL.md` for the stable function contract.
- Use `references/common-contract.md` for public behavior shared across platforms.
- Use `references/auth-and-state.md` for identity and carrier rules.
- Use the Windows reference for paths, wrapper mechanics, directory sharing, and installer/runtime details.
- Do not move Windows-specific path mechanics back into `SKILL.md`.

## Resources

- `scripts/detect_environment.js`
  Inspect OS, shell, expected launcher paths, Codex paths, and whether `codex_m` already exists.
- `scripts/validate_codex_manager.js`
  Validate the official lane, saved identity state, managed config placement, and Desktop follow-mode assumptions.
- `scripts/install_windows.ps1`
  Install or update the current Windows adapter.
- `assets/windows-runtime/`
  Current Windows runtime for `codex_m`.
- `references/troubleshooting.md`
  Use when behavior is wrong even though the expected files appear to exist.

## Guardrails

- Do not treat `organizations[].id` as a real switch target.
- Do not collapse different `(account_email, chatgpt_account_id)` snapshots into one saved identity.
- Do not delete shared sessions/history/trust/skills during normal logout, repair, or switching.
- Do not describe `codex.exe` follow-mode as launcher replacement or whole-home replacement.
- Do not overwrite unrelated config keys; patch only the managed top-level keys.
- Do not let `model_provider = "api111"` or `[model_providers.api111]` leak into the official lane.
- Do not let official identity switching remove shared MCP servers, project config, skills, memories, rules, vendor imports, or session discovery.
- Do not claim Desktop-only follow-mode on Windows unless the managed plain `codex` launcher is pinned to `~/.codex-official`.
- Do not present the current Windows directory layout as a cross-platform contract.
- If upstream Codex behavior changes, update the platform adapter and validation logic before changing the public contract.
