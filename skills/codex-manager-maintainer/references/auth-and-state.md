# Auth And State

## Real Identity Rules

- Treat `chatgpt_account_id` as the real login workspace/account identity.
- Save login snapshots by `(account_email, chatgpt_account_id)` when email is available, so different emails on the same real workspace stay separate.
- Treat `organizations[].id` as informational only.
- Validate switching behavior against the real login identity, not against display names or visible org ids.

## `auth.json`

- `~/.codex/auth.json` is the main local carrier of the active official login snapshot.
- `codex_m` may also store per-snapshot auth copies in its own machine-local home.
- Copying a saved snapshot into official `auth.json` is part of switching.

## `config.toml`

- `forced_chatgpt_workspace_id` must be written at the TOML top level.
- Writing that key under a nested table makes Codex ignore it.
- Preserve unrelated config content.

## Import Current

- `Use current signed-in Codex` means "capture the login already present in official `~/.codex/auth.json`".
- It does not create a new backend workspace by itself.
- It is useful for migration, repair, recovery, and syncing a login the user already completed outside `codex_m`.

## Logout

- Logout removes the saved snapshot entry.
- If it was the last saved snapshot for that saved `(account_email, chatgpt_account_id)` pair, remove the saved auth copy for that pair.
- If it was the active and only remaining snapshot, official `auth.json` may be cleared and the managed workspace restriction removed.
- Shared Codex sessions/history/config should remain.

## Duplicate Compaction

- If multiple saved entries share one saved `(account_email, chatgpt_account_id)` identity, compact them into one saved snapshot.
- Different emails on the same real login workspace must remain as separate saved snapshots.
- Keep the most recent or active item as the canonical entry.
- Preserve the manual display name when possible.
