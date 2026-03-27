[CmdletBinding()]
param(
  [string]$SkillRoot,
  [string]$ManagerHome = (Join-Path $env:USERPROFILE ".codex3-manager"),
  [string]$LauncherDir = (Join-Path $env:APPDATA "npm"),
  [string]$ManagerCommandName = "codex3_m",
  [string]$ThirdPartyCommandName = "codex3",
  [string]$ThirdPartyHome = (Join-Path $env:USERPROFILE ".codex-apikey"),
  [string]$ProviderName = "OpenAI",
  [string]$BaseUrl = "https://sub.aimizy.com",
  [string]$Model = "gpt-5.4",
  [string]$ReviewModel = "gpt-5.4",
  [string]$ModelReasoningEffort = "xhigh",
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

$ResolvedSkillRoot = (Resolve-Path $SkillRoot).Path
$AssetRoot = Join-Path $ResolvedSkillRoot "assets\\windows-runtime"
$WrapperInstaller = Join-Path $ResolvedSkillRoot "scripts\\install_codex3_wrapper.ps1"
$ManagerScriptsDir = Join-Path $ManagerHome "scripts"

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
  ('& node "{0}" @ArgsFromCaller' -f $EntryPath.Replace('"', '`"')),
  "exit `$LASTEXITCODE",
  ""
) -join "`r`n"

$CmdContent = @(
  "@echo off",
  "setlocal",
  ('node "{0}" %*' -f $EntryPath),
  "exit /b %errorlevel%",
  ""
) -join "`r`n"

Write-Utf8NoBom -Path $Ps1LauncherPath -Content $Ps1Content
Write-Utf8NoBom -Path $CmdLauncherPath -Content $CmdContent

& powershell -NoProfile -ExecutionPolicy Bypass -File $WrapperInstaller `
  -CommandName $ThirdPartyCommandName `
  -ThirdPartyHome $ThirdPartyHome `
  -ProviderName $ProviderName `
  -BaseUrl $BaseUrl `
  -Model $Model `
  -ReviewModel $ReviewModel `
  -ModelReasoningEffort $ModelReasoningEffort `
  -ModelContextWindow $ModelContextWindow `
  -ModelAutoCompactTokenLimit $ModelAutoCompactTokenLimit `
  -ForceRewriteConfig
if ($LASTEXITCODE -ne 0) {
  throw "install_codex3_wrapper.ps1 failed with exit code $LASTEXITCODE"
}

& node $EntryPath provider set `
  --command-name $ThirdPartyCommandName `
  --third-party-home $ThirdPartyHome `
  --provider-name $ProviderName `
  --base-url $BaseUrl `
  --model $Model `
  --review-model $ReviewModel `
  --model-reasoning-effort $ModelReasoningEffort `
  --model-context-window $ModelContextWindow `
  --model-auto-compact-token-limit $ModelAutoCompactTokenLimit
if ($LASTEXITCODE -ne 0) {
  throw "codex3_m provider set failed with exit code $LASTEXITCODE"
}

Write-Host "Installed codex3_m runtime."
Write-Host "Skill root       : $ResolvedSkillRoot"
Write-Host "Manager home     : $ManagerHome"
Write-Host "Launcher dir     : $LauncherDir"
Write-Host "Manager PS1      : $Ps1LauncherPath"
Write-Host "Manager CMD      : $CmdLauncherPath"
Write-Host "Third-party cmd  : $ThirdPartyCommandName"
Write-Host "Third-party home : $ThirdPartyHome"
Write-Host "Provider         : $ProviderName"
Write-Host "Base URL         : $BaseUrl"
Write-Host "Model            : $Model"
