# Windows 11

Load this file only when the target environment is Windows or when explicitly porting Windows behavior elsewhere.

## Default Paths

- Manager home: `%USERPROFILE%\.codex-manager`
- Official Codex home: `%USERPROFILE%\.codex`
- Launchers: `%APPDATA%\npm\codex_m.ps1` and `%APPDATA%\npm\codex_m.cmd`

## Baseline Runtime

- Use `assets/windows-runtime/` as the current Windows baseline implementation.
- Use `scripts/install_windows.ps1` to install or update that runtime.
- The runtime expects Node and npm on the machine.

## Install Or Update

Run from the skill folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install_windows.ps1
```

Optional overrides:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install_windows.ps1 `
  -LauncherDir "$env:APPDATA\npm" `
  -CommandName codex_m
```

Note:

- The current Windows runtime baseline still uses `%USERPROFILE%\.codex-manager` as its internal default state home.
- Overriding `-ManagerHome` changes the copied runtime location, but not that internal default state path unless the runtime itself is updated.

## Validate

After install or repair:

```powershell
node scripts/validate_codex_manager.js
codex_m doctor
```

Expected outcomes:

- `codex_m` launcher exists
- runtime files exist under manager home
- official config uses top-level managed keys
- `codex_m` opens and shows `Login`, `Manage`, `Quit`

## Windows Guardrails

- Write text files as UTF-8 without BOM.
- Do not rely on WSL-specific paths for the default Windows flow.
- Do not hardcode `Program Files` installs; detect what is already present.
- Keep launchers lightweight and machine-local.
