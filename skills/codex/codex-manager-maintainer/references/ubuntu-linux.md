# Ubuntu And Linux

Load this file only on Linux.

This skill does not ship a finished Linux installer/runtime in v1. A future Codex on Ubuntu or another Linux distro should derive the missing adapter from the shared contract and this reference, without pulling Windows details into the user-facing flow.

## What To Reuse

- Reuse the common behavior contract.
- Reuse the auth/state model.
- Reuse the validation mindset.
- Reuse the same `Login`, `Manage`, `Quit` flow and the same snapshot semantics.

## What To Rebuild Per Platform

- launcher location
- shell wrapper format
- Node/npm discovery
- install/update script
- path conventions for machine-local manager home
- any Linux-specific runtime packaging differences

## Linux Rules

- Prefer POSIX shell wrappers over PowerShell.
- Keep Linux-specific scripts and assets separate from Windows ones.
- Do not copy Windows `.cmd` or `.ps1` launchers into Linux guidance.
- Keep real switching identity based on `chatgpt_account_id`, not visible org ids.
