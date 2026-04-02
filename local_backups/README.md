This directory stores machine-local recovery snapshots for Codex-related state.

These backups may contain API keys, auth snapshots, and other sensitive local state.
Keep them local. Do not commit or push them.

Each snapshot folder should be self-contained enough for Codex to inspect and restore:

- deployed skill source snapshots from `~/.codex/skills/custom/...`
- active third-party and official auth/config carriers
- installed manager state and saved third-party profiles
- launcher scripts from `%APPDATA%\\npm`
- plain-codex bridge state and backups

The timestamped snapshot folders are intentionally ignored by Git via the repo root `.gitignore`.
