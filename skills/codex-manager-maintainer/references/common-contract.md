# Common Contract

`codex_m` is a machine-local manager for real Codex login snapshots.

## User-Facing UX

- Home must stay minimal: `Login`, `Manage`, `Quit`.
- `Login now` is the default user path.
- `Use current signed-in Codex` is advanced and recovery-oriented.
- A successful login or import must ask for a manual workspace name.
- `Manage` must be keyboard-first.
- `Enter` switches.
- `Tab` opens more actions.
- More actions must include `Rename` and `Logout`.

## Real Snapshot Model

- A saved item represents one real login snapshot.
- The real identity is the login token's `chatgpt_account_id`.
- Saved snapshot storage must preserve distinct `(account_email, chatgpt_account_id)` pairs when the email differs.
- Visible organizations in the token are hints only.
- Do not create multiple saved switch targets from a single token just because multiple visible orgs exist.

## Data Safety

- Shared Codex data should survive normal switch/logout flows.
- Login-specific data may change:
  - saved `codex_m` state
  - saved auth snapshots
  - official `~/.codex/auth.json`
  - managed auth/config restriction keys
- Do not wipe unrelated project trust, model settings, history, sessions, or skills.

## Upgrade Invariants

- Prefer repair or migration over destructive reinstall.
- Compact only exact duplicate saved snapshots for the same `(account_email, chatgpt_account_id)` pair.
- Keep the main UX stable even if a platform-specific runtime is replaced.
