# macOS

Load this file only on macOS.

This skill does not ship a finished macOS installer/runtime in v1. A future Codex on macOS should derive the missing adapter from the shared contract and this reference, rather than treating macOS as a variation of Windows.

## What To Reuse

- the common behavior contract
- the auth/state model
- the progressive disclosure structure
- the same `Login`, `Manage`, `Quit` flow and snapshot semantics

## What To Implement Separately

- launcher install path
- shell wrapper format
- Node/npm detection
- install/update script
- machine-local manager home conventions
- any macOS-specific runtime packaging differences

## macOS Rules

- Keep macOS-specific scripts and assets separate from Windows ones.
- Do not expose Windows launcher or PowerShell detail unless explicitly porting behavior.
- Keep real switching identity based on `chatgpt_account_id`, not visible org ids.
