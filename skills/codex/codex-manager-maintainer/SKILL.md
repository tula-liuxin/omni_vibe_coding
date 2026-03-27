---
name: codex-manager-maintainer
description: Install, repair, upgrade, and extend codex_m as a machine-local Codex login/workspace manager with a stable effect-first UX across environments. Use when Codex needs to create codex_m on a new computer, migrate an existing codex_m setup, fix launcher/auth/config bugs, compact fake or duplicate saved logins, or add platform-specific support while keeping Windows, macOS, and Linux implementation details isolated. Trigger for requests about codex_m installation, maintenance, upgrade, repair, portability, cross-platform support, login/workspace switching behavior, or codex_m skill-driven bootstrap on another machine.
---

# Codex Manager Maintainer

## Overview

- Maintain `codex_m` as a machine-local tool, not as a project-local artifact.
- Preserve the user-facing behavior contract even when the implementation changes by platform.
- Prefer effect parity over code parity.
- Treat shared logic and user-facing behavior as the durable core.
- Treat saved login snapshots as durable data with explicit identity rules, not as disposable cache.
- If the active platform does not yet have bundled installer/runtime assets, build the missing platform adapter from the common contract instead of blocking on missing scaffolding.

## Workflow

1. Run `scripts/detect_environment.js` first.
2. Read `references/common-contract.md` and `references/auth-and-state.md`.
3. Read only the current platform reference:
   - Windows: `references/windows-win11.md`
   - Linux: `references/ubuntu-linux.md`
   - macOS: `references/macos.md`
4. If the task involves upstream Codex behavior drift, upgrades, or unexplained auth/workspace breakage, also read `references/upstream-watchpoints.md`.
5. Classify the task as one of:
   - install `codex_m`
   - repair broken `codex_m`
   - upgrade an existing `codex_m`
   - explain or debug login/workspace behavior
   - add or refine platform support
6. Use bundled scripts and assets when they fit the current platform. Do not rewrite Windows launchers or runtime files from scratch when the bundled Windows assets already match the requested behavior.
7. When the task involves login persistence, tuple overwrite, or workspace/account confusion, inspect all three layers together:
   - tuple identity and compaction rules in runtime state
   - saved auth snapshot storage layout
   - activation/config behavior in official `auth.json` and `config.toml`
8. When the task involves official API keys, treat them as a separate official profile type:
   - ChatGPT snapshots stay under `tuples`
   - file-backed official API key profiles stay under `official_api_key_profiles`
   - `active_official_profile` is the source of truth for what normal `codex` should use
9. If the active platform does not yet have a bundled installer/runtime, derive the implementation from the common contract plus the active platform reference, keep unrelated platform detail out of the explanation, and persist the new adapter cleanly under `scripts/`, `assets/`, and `references/`.
10. Validate behavior, not just file presence.

## Stable Contract

Keep these behaviors stable unless the user explicitly asks to change them:

- Home shows `Login`, `Account Manage`, `API Key Manage`, `Plain codex -> codex`, `Quit`.
- `Login now` is the main login path.
- `Use current signed-in Codex` is an advanced recovery/import path.
- After login or import, prompt for a manual workspace name.
- `Account Manage` lists only real saved ChatGPT login snapshots.
- `API Key Manage` lists only saved official API key profiles.
- `Plain codex -> codex` restores plain `codex` back to the official `~/.codex` state without changing the launcher.
- Distinct `(account_email, chatgpt_account_id)` snapshots must remain separately saved and manageable when the email differs.
- `Enter` switches to the selected profile in the current manage section.
- `Tab` opens section-appropriate actions such as `Rename`, `Logout`, or `Delete`.
- `Logout` deletes the saved snapshot, not shared sessions/history/config.
- Visible org ids from the token are informational hints only.
- Real switching identity is keyed by `chatgpt_account_id`, not `organizations[].id`.

## Platform Loading Rules

- Do not load Windows implementation detail on Linux or macOS unless the user is explicitly asking to port the Windows implementation.
- Do not treat Linux/macOS references as full implementations unless they actually contain the needed installer/runtime details.
- When adding a new platform, keep the common contract unchanged and add platform-specific scripts/assets instead of branching the whole workflow in `SKILL.md`.
- If the current machine is on a platform without a finished adapter, synthesize only that platform's implementation details and keep them isolated from other platforms.

## Resources

- `scripts/detect_environment.js`
  Use to inspect OS, shell, expected launcher paths, Codex paths, and whether `codex_m` already exists.
- `scripts/validate_codex_manager.js`
  Use to verify an installed `codex_m` footprint, catch auth/config placement problems, detect duplicate saved snapshot identities, and detect API-key-vs-workspace residue.
- `scripts/install_windows.ps1`
  Use on Windows to install or update `codex_m` from bundled assets.
- `assets/windows-runtime/`
  Treat as the current Windows baseline implementation for `codex_m`.
- `references/upstream-watchpoints.md`
  Read before changing the public contract in response to a Codex CLI update.
- `references/troubleshooting.md`
  Read when behavior appears correct locally but Codex still uses the wrong login/workspace.

## Guardrails

- Do not use `organizations[].id` as a real switch target.
- Do not collapse different emails into one saved snapshot just because they share one real login workspace id.
- Do not delete shared Codex session/history state as part of normal logout or repair.
- Do not assume launcher paths or shell wrappers are identical across platforms.
- Do not overwrite unrelated `~/.codex/config.toml` content; only patch the managed keys.
- Do not require Ubuntu/macOS to mimic Windows launcher mechanics; preserve behavior, not file-layout symmetry.
- If upstream Codex behavior appears to have changed, update the platform adapter and validation logic before changing the public contract.
