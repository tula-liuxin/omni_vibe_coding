# Troubleshooting

## Switch Looks Successful But Codex Still Uses The Old Workspace

Check these in order:

- the active official `~/.codex/auth.json` really changed
- `forced_chatgpt_workspace_id` is at the TOML top level
- the selected saved item has a different real `chatgpt_account_id`
- there are no already-running Codex windows still using stale in-memory auth

## Duplicate Saved Entries

If two entries share the same real login identity, they are not two real switch targets. Compact them.

## Login Page Semantics

- `Login now` means perform a real login flow now.
- `Use current signed-in Codex` means import the current official login without reauthenticating.

## Logout Semantics

Logout removes the saved snapshot. It should not wipe shared session/history/config state.

## Config Placement Bugs

If `forced_chatgpt_workspace_id` is nested under another TOML table, Codex will ignore it.
