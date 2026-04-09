[CmdletBinding()]
param(
  [string]$SkillRoot,
  [string]$ManagerHome = (Join-Path $env:USERPROFILE ".codex3-manager"),
  [string]$LauncherDir = (Join-Path $env:APPDATA "npm"),
  [string]$ManagerCommandName = "codex3_m",
  [string]$ThirdPartyCommandName = "codex3",
  [string]$ThirdPartyHome = (Join-Path $env:USERPROFILE ".codex-apikey"),
  [string]$SharedCodexHome = (Join-Path $env:USERPROFILE ".codex"),
  [string]$BaseUrl = "https://api.xcode.best/v1",
  [string]$Model = "gpt-5-codex",
  [string]$ReviewModel = "",
  [string]$ModelReasoningEffort = "high",
  [int]$ModelContextWindow = 1000000,
  [int]$ModelAutoCompactTokenLimit = 900000,
  [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"

$BootstrapScriptRoot =
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

$SharedScriptPath = Join-Path $BootstrapScriptRoot "..\..\_internal-codex-windows-core\scripts\install-shared.ps1"
. (Resolve-Path $SharedScriptPath).Path

$ResolvedSkillRoot = Get-ResolvedSkillRoot `
  -SkillRoot $SkillRoot `
  -PSScriptRootValue $PSScriptRoot `
  -PSCommandPathValue $PSCommandPath `
  -InvocationPathValue $MyInvocation.MyCommand.Path
$SharedCoreRoot = Get-SharedCoreRoot -ResolvedSkillRoot $ResolvedSkillRoot
$AssetRoot = Join-Path $ResolvedSkillRoot "assets\windows-runtime"
$WrapperInstaller = Join-Path $ResolvedSkillRoot "scripts\install_codex3_wrapper.ps1"
$EntryPath = Join-Path $ManagerHome "index.mjs"
$StatePath = Join-Path $ManagerHome "state.json"

Copy-ManagerRuntimeAssets `
  -AssetRoot $AssetRoot `
  -ManagerHome $ManagerHome `
  -SharedCoreRoot $SharedCoreRoot `
  -ExtraScriptFiles @($WrapperInstaller)
Install-ManagerDependencies -ManagerHome $ManagerHome -SkipNpmInstall:$SkipNpmInstall

$ManagerPs1 = @(
  "param(",
  "  [Parameter(ValueFromRemainingArguments = `$true)]",
  "  [string[]]`$ArgsFromCaller",
  ")",
  ('$env:CODEX_THIRD_PARTY_MANAGER_HOME = "{0}"' -f $ManagerHome.Replace('"', '`"')),
  ('$env:CODEX_THIRD_PARTY_MANAGER_COMMAND = "{0}"' -f $ManagerCommandName.Replace('"', '`"')),
  ('$env:CODEX_THIRD_PARTY_LAUNCHER_DIR = "{0}"' -f $LauncherDir.Replace('"', '`"')),
  ('& node "{0}" @ArgsFromCaller' -f $EntryPath.Replace('"', '`"')),
  "exit `$LASTEXITCODE",
  ""
) -join "`r`n"

$ManagerCmd = @(
  "@echo off",
  "setlocal",
  ('set "CODEX_THIRD_PARTY_MANAGER_HOME={0}"' -f $ManagerHome),
  ('set "CODEX_THIRD_PARTY_MANAGER_COMMAND={0}"' -f $ManagerCommandName),
  ('set "CODEX_THIRD_PARTY_LAUNCHER_DIR={0}"' -f $LauncherDir),
  ('node "{0}" %*' -f $EntryPath),
  "exit /b %errorlevel%",
  ""
) -join "`r`n"

Write-NodeLauncherPair `
  -LauncherDir $LauncherDir `
  -CommandName $ManagerCommandName `
  -Ps1Content $ManagerPs1 `
  -CmdContent $ManagerCmd

$WrapperArgs = @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  $WrapperInstaller,
  "-CommandName",
  $ThirdPartyCommandName,
  "-ThirdPartyHome",
  $ThirdPartyHome,
  "-SharedCodexHome",
  $SharedCodexHome,
  "-GlobalBinDir",
  $LauncherDir,
  "-ProviderName",
  "api111",
  "-BaseUrl",
  $BaseUrl,
  "-Model",
  $Model,
  "-ModelReasoningEffort",
  $ModelReasoningEffort,
  "-PreferredAuthMethod",
  "apikey",
  "-ModelContextWindow",
  [string]$ModelContextWindow,
  "-ModelAutoCompactTokenLimit",
  [string]$ModelAutoCompactTokenLimit,
  "-ForceRewriteConfig"
)

if (-not [string]::IsNullOrWhiteSpace([string]$ReviewModel)) {
  $WrapperArgs += @("-ReviewModel", $ReviewModel)
}

& powershell @WrapperArgs
if ($LASTEXITCODE -ne 0) {
  throw "install_codex3_wrapper.ps1 failed with exit code $LASTEXITCODE"
}

$ExistingState = $null
if (Test-Path $StatePath) {
  try {
    $ExistingState = Get-Content -Raw $StatePath | ConvertFrom-Json
  }
  catch {
    $ExistingState = $null
  }
}

$StateObject = [ordered]@{
  schema_version = 2
  provider = [ordered]@{
    command_name = $ThirdPartyCommandName
    third_party_home = $ThirdPartyHome
    shared_codex_home = $SharedCodexHome
    mode = "api111"
    provider_name = "api111"
    base_url = $BaseUrl
    model = $Model
    review_model =
      if ([string]::IsNullOrWhiteSpace([string]$ReviewModel)) {
        $null
      }
      else {
        $ReviewModel
      }
    model_reasoning_effort = $ModelReasoningEffort
    preferred_auth_method = "apikey"
    requires_openai_auth = $null
    supports_websockets = $null
    model_context_window = $ModelContextWindow
    model_auto_compact_token_limit = $ModelAutoCompactTokenLimit
  }
  tuning =
    if ($ExistingState -and $null -ne $ExistingState.tuning) {
      $ExistingState.tuning
    }
    else {
      [ordered]@{}
    }
  profiles =
    if ($ExistingState -and $null -ne $ExistingState.profiles) {
      $ExistingState.profiles
    }
    else {
      [ordered]@{}
    }
  active_profile_id =
    if ($ExistingState -and $null -ne $ExistingState.active_profile_id) {
      $ExistingState.active_profile_id
    }
    else {
      $null
    }
}
Write-Utf8NoBom -Path $StatePath -Content (($StateObject | ConvertTo-Json -Depth 8) + "`r`n")

Write-Host "Installed $ManagerCommandName runtime."
Write-Host "Skill root        : $ResolvedSkillRoot"
Write-Host "Manager home      : $ManagerHome"
Write-Host "Launcher dir      : $LauncherDir"
Write-Host "Third-party cmd   : $ThirdPartyCommandName"
Write-Host "Third-party home  : $ThirdPartyHome"
Write-Host "Shared Codex home : $SharedCodexHome"
Write-Host "Provider          : api111"
Write-Host "Base URL          : $BaseUrl"
Write-Host "Model             : $Model"
