# Contract

`codex3_m` is the machine-local Windows manager for the third-party API-key lane.

## User-Facing Behavior

- Home is centered on third-party API key profiles.
- `Login` saves or imports a third-party API key profile.
- `Manage` switches, renames, or deletes saved third-party API key profiles.
- `Config` adjusts only the small set of supported lane settings:
  - wrapper command name
  - third-party home
  - shared Codex home
  - base URL
  - model
  - review model
  - reasoning effort
  - context window
  - auto-compact token limit
- `codex.exe to use` means "make Desktop `codex.exe` follow the active third-party profile".
- `codex.exe to use` is a Desktop bridge label only; it does not rename or switch the plain `codex` CLI.

## Fixed Lane Shape

- The public third-party lane is a single `api111` configuration shape.
- The generated config must keep:
  - `model_provider = "api111"`
  - `preferred_auth_method = "apikey"`
  - `cli_auth_credentials_store = "file"`
  - `wire_api = "responses"`
- Do not re-introduce `compat`, `stable-http`, or other multi-mode branches into the public contract.

## Separation Rules

- Official `codex` remains official.
- `codex3` remains the third-party lane.
- Third-party auth/config are isolated from the official lane.
- Only the explicit `codex.exe to use` bridge may copy the active third-party auth/config into the Desktop lane.
- Do not use the Desktop bridge when the plain `codex` launcher is unmanaged or still reading `~/.codex`.
- Do not treat `CODEX_HOME` pinning alone as enough to prove the bridge is safe; verify the managed official launcher behavior too.

## Sharing Rules

- Default shared targets are:
  - `sessions`
  - `archived_sessions`
  - `session_index.jsonl`
- Do not live-share SQLite sidebar/thread databases.
- If the thread list needs to align across lanes, use sync/backfill instead of SQLite live-sharing.
