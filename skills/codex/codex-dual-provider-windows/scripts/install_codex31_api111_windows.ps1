[CmdletBinding()]
param(
  [string]$SkillRoot,
  [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"

if (-not $SkillRoot) {
  $ScriptRoot =
    if ($PSScriptRoot) {
      $PSScriptRoot
    }
    elseif ($PSCommandPath) {
      Split-Path -Parent $PSCommandPath
    }
    elseif ($MyInvocation.MyCommand.Path) {
      Split-Path -Parent $MyInvocation.MyCommand.Path
    }
    else {
      (Get-Location).Path
    }

  $SkillRoot = (Resolve-Path (Join-Path $ScriptRoot "..")).Path
}

$InstallScript = Join-Path $SkillRoot "scripts\install_windows.ps1"
if (-not (Test-Path $InstallScript)) {
  throw "Missing installer: $InstallScript"
}

$Args = @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  $InstallScript,
  "-SkillRoot",
  $SkillRoot,
  "-ManagerHome",
  (Join-Path $env:USERPROFILE ".codex31-manager"),
  "-ManagerCommandName",
  "codex31_m",
  "-ThirdPartyCommandName",
  "codex31",
  "-ThirdPartyHome",
  (Join-Path $env:USERPROFILE ".codex-apikey-api111"),
  "-SharedCodexHome",
  (Join-Path $env:USERPROFILE ".codex"),
  "-Mode",
  "api111"
)

if ($SkipNpmInstall) {
  $Args += "-SkipNpmInstall"
}

& powershell @Args
exit $LASTEXITCODE
