# Contract

`codex3_m` is the machine-local manager for the third-party API key lane on Windows.

## User-Facing Behavior

- Home is centered on third-party API key management.
- `Login` saves or imports a third-party API key profile.
- `Manage` switches, renames, or deletes saved third-party API key profiles.
- `codex.exe to use` means "choose whether Desktop `codex.exe` should follow the active third-party profile".
- `codex.exe to use` is a Desktop bridge label only; it does not mean the plain `codex` CLI command has been renamed or switched.
- On the current Windows adapter, that Desktop-only guarantee depends on the managed plain `codex` launcher being pinned to `~/.codex-official`.
- On the current Windows adapter, the managed plain `codex` launcher must also inject official `-c` overrides such as `model_provider="openai"` and `cli_auth_credentials_store="file"` and clear inherited `OPENAI_*` env overrides, otherwise plain `codex` can still drift onto the third-party lane.
- Advanced provider compatibility settings remain available, but they are not the main identity story.

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
- Treat broader directory sharing as optional and adapter-specific.
- Do not live-share SQLite sidebar/thread databases.
- If the thread list needs to align across lanes, use sync/backfill instead of SQLite live-sharing.

## Advanced Compatibility

- Provider mode, provider id, base URL, model, and tutorial mapping are advanced controls.
- Keep them compatible with the current provider tutorial when the task is specifically about provider setup or repair.
- Do not let advanced provider detail obscure the main contract: `codex3_m` manages third-party API key profiles.
