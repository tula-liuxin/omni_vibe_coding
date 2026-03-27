# Upstream Watchpoints

Read this file when `codex_m` behavior breaks after a Codex CLI update or when porting the tool to another platform.

## Watch First

- Where official Codex stores active auth:
  - `~/.codex/auth.json`
  - `cli_auth_credentials_store`
- Which token field represents the real switch identity:
  - currently `chatgpt_account_id`
- Whether `forced_chatgpt_workspace_id` is still a supported top-level config key
- Whether launcher conventions or packaged Node dependencies changed
- Whether login/import wording in the runtime still matches the stable contract

## Update Order

1. Verify the new upstream behavior from the installed Codex or its source.
2. Update platform-specific assets and install scripts first.
3. Update validation scripts so doctor checks match the new reality.
4. Only then update references/common contract text if the user-facing effect truly changed.

## What Should Stay Stable

- `Login`, `Manage`, `Quit` remains the default home flow unless the user asks to redesign it.
- Manual workspace naming remains required after login/import.
- Saved entries remain real login snapshots, not fake org-derived workspaces.
- `Logout` remains snapshot cleanup, not shared-session destruction.
