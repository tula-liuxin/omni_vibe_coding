# Common Contract

`codex_m` is the machine-local manager for the official Codex lane.

## User-Facing Behavior

- Home is intentionally small: `Login`, `Account Manage`, `API Key Manage`, `codex.exe`, `Quit`.
- `Login` is the entry point for saving official identities.
- `Account Manage` is only for official ChatGPT snapshots.
- `API Key Manage` is only for official API key profiles.
- `codex.exe` means "make the Desktop lane follow the official identity currently managed by `codex_m`".
- `Enter` applies the selected identity in the current section.
- `Tab` opens section-specific actions such as `Rename`, `Logout`, or `Delete`.

## Identity Model

- One saved ChatGPT item represents one real official login snapshot.
- The real identity key is `chatgpt_account_id`.
- Preserve distinct `(account_email, chatgpt_account_id)` pairs when the email differs.
- Treat visible organizations as hints only.
- Official API key profiles are separate saved identities from ChatGPT snapshots.

## Sharing Model

- Share safe session/history/thread metadata as much as practical.
- Keep auth carriers and managed config keys distinct from shared session/history state.
- Do not model switching as whole-home replacement.
- Do not live-share SQLite sidebar/thread databases between homes.
- If thread/sidebar views need alignment, use synchronization or backfill instead of direct SQLite sharing.

## Upgrade Invariants

- Prefer migration or repair over destructive reinstall.
- Keep the official/third-party boundary understandable.
- Keep the public contract stable even when platform adapters change.
