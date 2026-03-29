# Auth And State

## Official Identity Rules

- Official ChatGPT snapshots are keyed by `chatgpt_account_id`.
- Save ChatGPT snapshots by `(account_email, chatgpt_account_id)` when email is available.
- Official API key profiles are separate file-backed identities.
- Validate switching behavior against the real login identity, not display names or visible organization ids.

## Auth Carriers

- The active official identity is applied by updating the official auth carrier and managed config keys.
- Switching the official identity must not require relocating the entire Codex home.
- ChatGPT snapshots and official API key profiles are both file-backed saved identities.
- Desktop follow-mode and CLI follow-mode may use different current homes on some platforms; that is an adapter detail, not the public contract.

## Managed Config

- Managed keys must stay at the TOML top level.
- Preserve unrelated config content.
- When a ChatGPT snapshot is active, the managed workspace restriction must match that login identity.
- When an official API key profile is active, the managed workspace restriction must be removed.
- If Desktop is intentionally following the third-party lane, validators may relax official Desktop drift checks until `codex_m` restores the official follow-mode.

## Logout And Deletion

- Logout removes the selected saved ChatGPT snapshot only.
- Deleting an official API key profile removes only that saved API key profile.
- Shared sessions/history/config should remain intact.

## Duplicate Handling

- Compact only exact duplicate saved snapshot identities.
- Different emails on the same real login workspace remain separate saved snapshots.
- Preserve the active or most recent entry when compacting.

## State Model

- `active_official_profile` is the source of truth for the applied official identity.
- `active_official_profile` may point to:
  - a ChatGPT snapshot
  - an official API key profile
- Any legacy fields should be interpreted in a way that preserves the current official identity without changing the public contract.
