# Common Contract

`codex_m` is the machine-local manager for the official Codex lane.

## User-Facing Behavior

- Home is intentionally small: `Login`, `Account Manage`, `API Key Manage`, `codex.exe`, `Quit`.
- `Login` is the entry point for saving official identities.
- `Account Manage` is only for official ChatGPT snapshots.
- `API Key Manage` is only for official API key profiles.
- `codex.exe` means "make the Desktop lane follow the official identity currently managed by `codex_m`".
- On Windows, the plain `codex` CLI is expected to use a separate official CLI home such as `~/.codex-official`.
- On the current Windows adapter, the managed `codex.ps1` wrapper also injects official `-c` overrides such as `model_provider="openai"` and `cli_auth_credentials_store="file"` and clears inherited `OPENAI_*` env overrides before launch, so Desktop follow-mode does not imply CLI switching.
- `Enter` applies the selected identity in the current section.
- `Tab` opens section-specific actions such as `Rename`, `Logout`, or `Delete`.

## Identity Model

- One saved ChatGPT item represents one real official login snapshot.
- The real identity key is `chatgpt_account_id`.
- Preserve distinct `(account_email, chatgpt_account_id)` pairs when the email differs.
- Treat visible organizations as hints only.
- Official API key profiles are separate saved identities from ChatGPT snapshots.

## Sharing Model

- Share safe session/history/thread metadata, MCP/project config, skills, memories, rules, and vendor imports as much as practical.
- Keep auth carriers and managed provider config keys distinct from shared state.
- Switching an official identity should not force the user to reconfigure MCP servers, project trust/config, skills, memories, rules, or session discovery.
- That switching-cost contract does not mean the official and third-party lanes collapse into one identical config file.
- Shared substrate scope is limited to safe state and shared config fragments; provider-owned sections, auth carriers, lane homes, and SQLite thread databases remain isolated.
- Desktop follow-mode is a bridge operation, not evidence that the substrate itself is sharing auth/provider state.
- Do not model switching as whole-home replacement.
- Do not live-share SQLite sidebar/thread databases between homes.
- If thread/sidebar views need alignment, use synchronization or backfill instead of direct SQLite sharing.

## Upgrade Invariants

- Prefer migration or repair over destructive reinstall.
- Keep the official/third-party boundary understandable.
- Strip third-party provider ownership from official configs; `api111` belongs to `codex3_m`, not `codex_m`.
- Keep the public contract stable even when platform adapters change.
