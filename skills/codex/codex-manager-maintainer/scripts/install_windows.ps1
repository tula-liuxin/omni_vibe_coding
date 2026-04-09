[CmdletBinding()]
param(
  [string]$SkillRoot,
  [string]$ManagerHome = (Join-Path $env:USERPROFILE ".codex-manager"),
  [string]$LauncherDir = (Join-Path $env:APPDATA "npm"),
  [string]$CommandName = "codex_m",
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

$OfficialCliHome = Join-Path $env:USERPROFILE ".codex-official"
$DesktopHome = Join-Path $env:USERPROFILE ".codex"
$LegacyBridgeDir = Join-Path $ManagerHome "plain-codex-bridge"
$EntryPath = Join-Path $ManagerHome "index.mjs"
$Ps1LauncherPath = Join-Path $LauncherDir "$CommandName.ps1"
$CmdLauncherPath = Join-Path $LauncherDir "$CommandName.cmd"
$CodexPs1LauncherPath = Join-Path $LauncherDir "codex.ps1"
$CodexCmdLauncherPath = Join-Path $LauncherDir "codex.cmd"
$CodexPs1BackupPath = Join-Path $ManagerHome "upstream-codex.ps1"
$CodexCmdBackupPath = Join-Path $ManagerHome "upstream-codex.cmd"

Copy-ManagerRuntimeAssets -AssetRoot $AssetRoot -ManagerHome $ManagerHome -SharedCoreRoot $SharedCoreRoot
Install-ManagerDependencies -ManagerHome $ManagerHome -SkipNpmInstall:$SkipNpmInstall

New-Item -ItemType Directory -Force -Path $OfficialCliHome | Out-Null
New-Item -ItemType Directory -Force -Path $DesktopHome | Out-Null

if (Test-Path $LegacyBridgeDir) {
  Remove-Item -LiteralPath $LegacyBridgeDir -Recurse -Force
}

$ManagerPs1 = @(
  "param(",
  "  [Parameter(ValueFromRemainingArguments = `$true)]",
  "  [string[]]`$ArgsFromCaller",
  ")",
  ('& node "{0}" @ArgsFromCaller' -f $EntryPath.Replace('"', '`"')),
  "exit `$LASTEXITCODE",
  ""
) -join "`r`n"

$ManagerCmd = @(
  "@echo off",
  "setlocal",
  ('node "{0}" %*' -f $EntryPath),
  "exit /b %errorlevel%",
  ""
) -join "`r`n"

Write-NodeLauncherPair `
  -LauncherDir $LauncherDir `
  -CommandName $CommandName `
  -Ps1Content $ManagerPs1 `
  -CmdContent $ManagerCmd

if ((Test-Path $CodexPs1LauncherPath) -and -not (Test-Path $CodexPs1BackupPath)) {
  Copy-Item -Path $CodexPs1LauncherPath -Destination $CodexPs1BackupPath -Force
}

if ((Test-Path $CodexCmdLauncherPath) -and -not (Test-Path $CodexCmdBackupPath)) {
  Copy-Item -Path $CodexCmdLauncherPath -Destination $CodexCmdBackupPath -Force
}

$CodexWrapperPs1 = @(
  "# codex_m managed official codex CLI wrapper",
  "param(",
  "  [Parameter(ValueFromRemainingArguments = `$true)]",
  "  [string[]]`$ArgsFromCaller",
  ")",
  "`$basedir = Split-Path `$MyInvocation.MyCommand.Definition -Parent",
  '$exe = ""',
  'if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {',
  '  $exe = ".exe"',
  "}",
  ('$officialCliHome = "{0}"' -f $OfficialCliHome.Replace('"', '`"')),
  'if (-not (Test-Path $officialCliHome)) {',
  '  New-Item -ItemType Directory -Force -Path $officialCliHome | Out-Null',
  "}",
  '$officialConfigPath = Join-Path $officialCliHome "config.toml"',
  '$officialConfigText = ""',
  'if (Test-Path $officialConfigPath) {',
  '  $officialConfigText = [System.IO.File]::ReadAllText($officialConfigPath)',
  "}",
  'function Get-TomlStringValue {',
  '  param(',
  '    [Parameter(Mandatory = $true)][string]$Text,',
  '    [Parameter(Mandatory = $true)][string]$Key',
  '  )',
  '  $escapedKey = [Regex]::Escape($Key)',
  '  $match = [Regex]::Match($Text, "(?m)^[ \t]*$escapedKey[ \t]*=[ \t]*""([^""]*)""[ \t]*(?:#.*)?$")',
  '  if ($match.Success) {',
  '    return $match.Groups[1].Value',
  '  }',
  '  return $null',
  "}",
  '$forcedArgs = @(',
  '  "-c", ''model_provider="openai"'',',
  '  "-c", ''cli_auth_credentials_store="file"''',
  ')',
  'foreach ($key in @("model", "model_reasoning_effort", "forced_chatgpt_workspace_id")) {',
  '  $value = Get-TomlStringValue -Text $officialConfigText -Key $key',
  '  if (-not [string]::IsNullOrWhiteSpace($value)) {',
  '    $forcedArgs += @("-c", ("{0}=""{1}""" -f $key, $value))',
  '  }',
  '}',
  "`$ret = 0",
  '$previousCodexHome = [Environment]::GetEnvironmentVariable("CODEX_HOME", "Process")',
  '$previousOpenAiApiKey = [Environment]::GetEnvironmentVariable("OPENAI_API_KEY", "Process")',
  '$previousOpenAiBaseUrl = [Environment]::GetEnvironmentVariable("OPENAI_BASE_URL", "Process")',
  "try {",
  "  `$env:CODEX_HOME = `$officialCliHome",
  '  Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue',
  '  Remove-Item Env:OPENAI_BASE_URL -ErrorAction SilentlyContinue',
  '  if (Test-Path "$basedir/node$exe") {',
  "    if (`$MyInvocation.ExpectingInput) {",
  '      $input | & "$basedir/node$exe" "$basedir/node_modules/@openai/codex/bin/codex.js" @forcedArgs @ArgsFromCaller',
  "    } else {",
  '      & "$basedir/node$exe" "$basedir/node_modules/@openai/codex/bin/codex.js" @forcedArgs @ArgsFromCaller',
  "    }",
  "    `$ret = `$LASTEXITCODE",
  "  } else {",
  "    if (`$MyInvocation.ExpectingInput) {",
  '      $input | & "node$exe" "$basedir/node_modules/@openai/codex/bin/codex.js" @forcedArgs @ArgsFromCaller',
  "    } else {",
  '      & "node$exe" "$basedir/node_modules/@openai/codex/bin/codex.js" @forcedArgs @ArgsFromCaller',
  "    }",
  "    `$ret = `$LASTEXITCODE",
  "  }",
  "} finally {",
  '  if ([string]::IsNullOrEmpty($previousCodexHome)) {',
  '    Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue',
  "  } else {",
  "    `$env:CODEX_HOME = `$previousCodexHome",
  "  }",
  '  if ([string]::IsNullOrEmpty($previousOpenAiApiKey)) {',
  '    Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue',
  "  } else {",
  "    `$env:OPENAI_API_KEY = `$previousOpenAiApiKey",
  "  }",
  '  if ([string]::IsNullOrEmpty($previousOpenAiBaseUrl)) {',
  '    Remove-Item Env:OPENAI_BASE_URL -ErrorAction SilentlyContinue',
  "  } else {",
  "    `$env:OPENAI_BASE_URL = `$previousOpenAiBaseUrl",
  "  }",
  "}",
  "exit `$ret",
  ""
) -join "`r`n"

$CodexWrapperCmd = @(
  "@echo off",
  "setlocal",
  'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0codex.ps1" %*',
  "exit /b %errorlevel%",
  ""
) -join "`r`n"

Write-Utf8NoBom -Path $CodexPs1LauncherPath -Content $CodexWrapperPs1
Write-Utf8NoBom -Path $CodexCmdLauncherPath -Content $CodexWrapperCmd

Write-Host "Installed codex_m runtime."
Write-Host "Skill root       : $ResolvedSkillRoot"
Write-Host "Manager home     : $ManagerHome"
Write-Host "Launcher dir     : $LauncherDir"
Write-Host "Official CLI home: $OfficialCliHome"
Write-Host "Desktop home     : $DesktopHome"
Write-Host "Manager PS1      : $Ps1LauncherPath"
Write-Host "Manager CMD      : $CmdLauncherPath"
Write-Host "Wrapped codex PS1: $CodexPs1LauncherPath"
Write-Host "Wrapped codex CMD: $CodexCmdLauncherPath"
