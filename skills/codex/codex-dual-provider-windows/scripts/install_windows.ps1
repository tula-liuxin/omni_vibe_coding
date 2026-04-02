[CmdletBinding()]
param(
  [string]$SkillRoot,
  [string]$ManagerHome = (Join-Path $env:USERPROFILE ".codex3-manager"),
  [string]$LauncherDir = (Join-Path $env:APPDATA "npm"),
  [string]$ManagerCommandName = "codex3_m",
  [string]$ThirdPartyCommandName = "codex3",
  [string]$ThirdPartyHome = (Join-Path $env:USERPROFILE ".codex-apikey"),
  [string]$SharedCodexHome = (Join-Path $env:USERPROFILE ".codex"),
  [ValidateSet("compat", "stable-http", "api111")][string]$Mode = "compat",
  [string]$ProviderName,
  [string]$BaseUrl,
  [string]$Model,
  [string]$ReviewModel,
  [string]$ModelReasoningEffort,
  [string]$PreferredAuthMethod,
  [Nullable[bool]]$RequiresOpenAiAuth = $null,
  [Nullable[bool]]$SupportsWebsockets = $null,
  [int]$ModelContextWindow = 1000000,
  [int]$ModelAutoCompactTokenLimit = 900000,
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

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Require-Command {
  param(
    [Parameter(Mandatory = $true)][string]$Name
  )

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Get-ModeDefaults {
  param(
    [Parameter(Mandatory = $true)][ValidateSet("compat", "stable-http", "api111")][string]$ModeName
  )

  switch ($ModeName) {
    "stable-http" {
      return [ordered]@{
        ProviderName = "sub2api"
        BaseUrl = "https://sub.aimizy.com"
        Model = "gpt-5.4"
        ReviewModel = "gpt-5.4"
        ModelReasoningEffort = "xhigh"
        PreferredAuthMethod = $null
        RequiresOpenAiAuth = $true
        SupportsWebsockets = $false
      }
    }
    "api111" {
      return [ordered]@{
        ProviderName = "api111"
        BaseUrl = "https://api.xcode.best/v1"
        Model = "gpt-5-codex"
        ReviewModel = $null
        ModelReasoningEffort = "high"
        PreferredAuthMethod = "apikey"
        RequiresOpenAiAuth = $null
        SupportsWebsockets = $null
      }
    }
    default {
      return [ordered]@{
        ProviderName = "openai"
        BaseUrl = "https://sub.aimizy.com"
        Model = "gpt-5.4"
        ReviewModel = "gpt-5.4"
        ModelReasoningEffort = "xhigh"
        PreferredAuthMethod = $null
        RequiresOpenAiAuth = $null
        SupportsWebsockets = $null
      }
    }
  }
}

$ResolvedSkillRoot = (Resolve-Path $SkillRoot).Path
$AssetRoot = Join-Path $ResolvedSkillRoot "assets\\windows-runtime"
$WrapperInstaller = Join-Path $ResolvedSkillRoot "scripts\\install_codex3_wrapper.ps1"
$ManagerScriptsDir = Join-Path $ManagerHome "scripts"
$ModeDefaults = Get-ModeDefaults -ModeName $Mode

$EffectiveProviderName =
  if ($PSBoundParameters.ContainsKey("ProviderName")) {
    $ProviderName
  }
  else {
    $ModeDefaults.ProviderName
  }
$EffectiveBaseUrl =
  if ($PSBoundParameters.ContainsKey("BaseUrl")) {
    $BaseUrl
  }
  else {
    $ModeDefaults.BaseUrl
  }
$EffectiveModel =
  if ($PSBoundParameters.ContainsKey("Model")) {
    $Model
  }
  else {
    $ModeDefaults.Model
  }
$EffectiveReviewModel =
  if ($PSBoundParameters.ContainsKey("ReviewModel")) {
    $ReviewModel
  }
  else {
    $ModeDefaults.ReviewModel
  }
$EffectiveModelReasoningEffort =
  if ($PSBoundParameters.ContainsKey("ModelReasoningEffort")) {
    $ModelReasoningEffort
  }
  else {
    $ModeDefaults.ModelReasoningEffort
  }
$EffectivePreferredAuthMethod =
  if ($PSBoundParameters.ContainsKey("PreferredAuthMethod")) {
    $PreferredAuthMethod
  }
  else {
    $ModeDefaults.PreferredAuthMethod
  }
$EffectiveRequiresOpenAiAuth =
  if ($PSBoundParameters.ContainsKey("RequiresOpenAiAuth")) {
    $RequiresOpenAiAuth
  }
  else {
    $ModeDefaults.RequiresOpenAiAuth
  }
$EffectiveSupportsWebsockets =
  if ($PSBoundParameters.ContainsKey("SupportsWebsockets")) {
    $SupportsWebsockets
  }
  else {
    $ModeDefaults.SupportsWebsockets
  }

foreach ($RequiredAsset in @("index.mjs", "package.json", "package-lock.json")) {
  $AssetPath = Join-Path $AssetRoot $RequiredAsset
  if (-not (Test-Path $AssetPath)) {
    throw "Missing runtime asset: $AssetPath"
  }
}

if (-not (Test-Path $WrapperInstaller)) {
  throw "Missing wrapper installer: $WrapperInstaller"
}

Require-Command -Name node
if (-not $SkipNpmInstall) {
  Require-Command -Name npm
}

New-Item -ItemType Directory -Force -Path $ManagerHome | Out-Null
New-Item -ItemType Directory -Force -Path $ManagerScriptsDir | Out-Null
New-Item -ItemType Directory -Force -Path $LauncherDir | Out-Null

Copy-Item -Path (Join-Path $AssetRoot "index.mjs") -Destination (Join-Path $ManagerHome "index.mjs") -Force
Copy-Item -Path (Join-Path $AssetRoot "package.json") -Destination (Join-Path $ManagerHome "package.json") -Force
Copy-Item -Path (Join-Path $AssetRoot "package-lock.json") -Destination (Join-Path $ManagerHome "package-lock.json") -Force
Copy-Item -Path $WrapperInstaller -Destination (Join-Path $ManagerScriptsDir "install_codex3_wrapper.ps1") -Force

if (-not $SkipNpmInstall) {
  Push-Location $ManagerHome
  try {
    & npm install --omit=dev --no-fund --no-audit
    if ($LASTEXITCODE -ne 0) {
      throw "npm install failed with exit code $LASTEXITCODE"
    }
  }
  finally {
    Pop-Location
  }
}

$EntryPath = Join-Path $ManagerHome "index.mjs"
$Ps1LauncherPath = Join-Path $LauncherDir "$ManagerCommandName.ps1"
$CmdLauncherPath = Join-Path $LauncherDir "$ManagerCommandName.cmd"

$Ps1Content = @(
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

$CmdContent = @(
  "@echo off",
  "setlocal",
  ('set "CODEX_THIRD_PARTY_MANAGER_HOME={0}"' -f $ManagerHome),
  ('set "CODEX_THIRD_PARTY_MANAGER_COMMAND={0}"' -f $ManagerCommandName),
  ('set "CODEX_THIRD_PARTY_LAUNCHER_DIR={0}"' -f $LauncherDir),
  ('node "{0}" %*' -f $EntryPath),
  "exit /b %errorlevel%",
  ""
) -join "`r`n"

Write-Utf8NoBom -Path $Ps1LauncherPath -Content $Ps1Content
Write-Utf8NoBom -Path $CmdLauncherPath -Content $CmdContent

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
  $EffectiveProviderName,
  "-BaseUrl",
  $EffectiveBaseUrl,
  "-Model",
  $EffectiveModel,
  "-ModelReasoningEffort",
  $EffectiveModelReasoningEffort,
  "-ModelContextWindow",
  [string]$ModelContextWindow,
  "-ModelAutoCompactTokenLimit",
  [string]$ModelAutoCompactTokenLimit
)

if (-not [string]::IsNullOrWhiteSpace([string]$EffectiveReviewModel)) {
  $WrapperArgs += @("-ReviewModel", $EffectiveReviewModel)
}
if (-not [string]::IsNullOrWhiteSpace([string]$EffectivePreferredAuthMethod)) {
  $WrapperArgs += @("-PreferredAuthMethod", $EffectivePreferredAuthMethod)
}
if ($null -ne $EffectiveRequiresOpenAiAuth) {
  $WrapperArgs += @("-RequiresOpenAiAuth", $EffectiveRequiresOpenAiAuth.ToString().ToLowerInvariant())
}
if ($null -ne $EffectiveSupportsWebsockets) {
  $WrapperArgs += @("-SupportsWebsockets", $EffectiveSupportsWebsockets.ToString().ToLowerInvariant())
}

& powershell @WrapperArgs
if ($LASTEXITCODE -ne 0) {
  throw "install_codex3_wrapper.ps1 failed with exit code $LASTEXITCODE"
}

$ProviderArgs = @(
  "provider",
  "set",
  "--mode",
  $Mode,
  "--command-name",
  $ThirdPartyCommandName,
  "--third-party-home",
  $ThirdPartyHome,
  "--shared-codex-home",
  $SharedCodexHome,
  "--provider-name",
  $EffectiveProviderName,
  "--base-url",
  $EffectiveBaseUrl,
  "--model",
  $EffectiveModel,
  "--model-reasoning-effort",
  $EffectiveModelReasoningEffort,
  "--model-context-window",
  [string]$ModelContextWindow,
  "--model-auto-compact-token-limit",
  [string]$ModelAutoCompactTokenLimit
)

if (-not [string]::IsNullOrWhiteSpace([string]$EffectiveReviewModel)) {
  $ProviderArgs += @("--review-model", $EffectiveReviewModel)
}
if (-not [string]::IsNullOrWhiteSpace([string]$EffectivePreferredAuthMethod)) {
  $ProviderArgs += @("--preferred-auth-method", $EffectivePreferredAuthMethod)
}
if ($null -ne $EffectiveRequiresOpenAiAuth) {
  $ProviderArgs += @("--requires-openai-auth", $EffectiveRequiresOpenAiAuth.ToString().ToLowerInvariant())
}
if ($null -ne $EffectiveSupportsWebsockets) {
  $ProviderArgs += @("--supports-websockets", $EffectiveSupportsWebsockets.ToString().ToLowerInvariant())
}

& {
  $env:CODEX_THIRD_PARTY_MANAGER_HOME = $ManagerHome
  $env:CODEX_THIRD_PARTY_MANAGER_COMMAND = $ManagerCommandName
  $env:CODEX_THIRD_PARTY_LAUNCHER_DIR = $LauncherDir
  & node $EntryPath @ProviderArgs
}
if ($LASTEXITCODE -ne 0) {
  throw "codex3_m provider set failed with exit code $LASTEXITCODE"
}

Write-Host "Installed $ManagerCommandName runtime."
Write-Host "Skill root         : $ResolvedSkillRoot"
Write-Host "Manager home       : $ManagerHome"
Write-Host "Launcher dir       : $LauncherDir"
Write-Host "Manager PS1        : $Ps1LauncherPath"
Write-Host "Manager CMD        : $CmdLauncherPath"
Write-Host "Third-party cmd    : $ThirdPartyCommandName"
Write-Host "Third-party home   : $ThirdPartyHome"
Write-Host "Shared Codex home  : $SharedCodexHome"
Write-Host "Mode               : $Mode"
Write-Host "Provider           : $EffectiveProviderName"
Write-Host "Base URL           : $EffectiveBaseUrl"
Write-Host "Model              : $EffectiveModel"
