#!/usr/bin/env pwsh
param(
  [string]$CommandName = "codex3",
  [string]$ThirdPartyHome = "$env:USERPROFILE\.codex-apikey",
  [string]$SharedCodexHome = "$env:USERPROFILE\.codex",
  [string]$ProviderName = "OpenAI",
  [string]$BaseUrl = "https://sub.aimizy.com",
  [string]$Model = "gpt-5.4",
  [string]$ReviewModel = "gpt-5.4",
  [string]$ModelReasoningEffort = "xhigh",
  [int]$ModelContextWindow = 1000000,
  [int]$ModelAutoCompactTokenLimit = 900000,
  [string]$GlobalBinDir = "$env:APPDATA\npm",
  [switch]$ForceRewriteConfig
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )

  $parent = Split-Path -Parent $Path
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Get-ProviderEnvKeyName {
  param(
    [Parameter(Mandatory = $true)][string]$Command
  )

  $normalized = ($Command -replace '[^A-Za-z0-9]+', '_').Trim('_').ToUpperInvariant()
  if ([string]::IsNullOrWhiteSpace($normalized)) {
    $normalized = "CODEX3"
  }
  return "${normalized}_OPENAI_API_KEY"
}

function New-ThirdPartyConfig {
  param(
    [string]$Provider,
    [string]$Url,
    [string]$ModelName,
    [string]$ReviewModelName,
    [string]$ReasoningEffort,
    [string]$EnvKeyName,
    [int]$ContextWindow,
    [int]$AutoCompactTokenLimit
  )

  $lines = @(
    'cli_auth_credentials_store = "file"',
    ('model_provider = "{0}"' -f $Provider),
    ('model = "{0}"' -f $ModelName),
    ('review_model = "{0}"' -f $ReviewModelName),
    ('model_reasoning_effort = "{0}"' -f $ReasoningEffort),
    'disable_response_storage = true',
    'network_access = "enabled"',
    'windows_wsl_setup_acknowledged = true',
    ('model_context_window = {0}' -f $ContextWindow),
    ('model_auto_compact_token_limit = {0}' -f $AutoCompactTokenLimit),
    '',
    ('[model_providers.{0}]' -f $Provider),
    ('name = "{0}"' -f $Provider),
    ('base_url = "{0}"' -f $Url),
    ('env_key = "{0}"' -f $EnvKeyName),
    'wire_api = "responses"',
    'requires_openai_auth = false',
    '',
    '[features]',
    'apps = false'
  )

  return (($lines -join "`r`n") + "`r`n")
}

function New-WrapperPs1 {
  param(
    [string]$HomePath,
    [string]$SharedHomePath,
    [string]$Provider,
    [string]$Url,
    [string]$ModelName,
    [string]$ReviewModelName,
    [string]$ReasoningEffort,
    [string]$ProviderEnvKeyName,
    [int]$ContextWindow,
    [int]$AutoCompactTokenLimit
  )

  $lines = @(
    '#!/usr/bin/env pwsh',
    'param(',
    '  [Parameter(ValueFromRemainingArguments=$true)]',
    '  [string[]]$Rest',
    ')',
    '',
    ('$thirdPartyHome = "{0}"' -f $HomePath),
    ('$sharedCodexHome = "{0}"' -f $SharedHomePath),
    '$previousCodexHome = [Environment]::GetEnvironmentVariable("CODEX_HOME", "Process")',
    '$previousOpenAiApiKey = [Environment]::GetEnvironmentVariable("OPENAI_API_KEY", "Process")',
    ('$providerEnvKeyName = "{0}"' -f $ProviderEnvKeyName),
    '$previousProviderApiKey = [Environment]::GetEnvironmentVariable($providerEnvKeyName, "Process")',
    '$authPath = Join-Path $thirdPartyHome "auth.json"',
    '$configPath = Join-Path $thirdPartyHome "config.toml"',
    ('$providerName = "{0}"' -f $Provider),
    ('$baseUrl = "{0}"' -f $Url),
    ('$modelName = "{0}"' -f $ModelName),
    ('$reviewModelName = "{0}"' -f $ReviewModelName),
    ('$reasoningEffort = "{0}"' -f $ReasoningEffort),
    ('$contextWindow = {0}' -f $ContextWindow),
    ('$autoCompactTokenLimit = {0}' -f $AutoCompactTokenLimit),
    '$utf8NoBom = New-Object System.Text.UTF8Encoding($false)',
    '',
    'if (-not (Test-Path $thirdPartyHome)) {',
    '  New-Item -ItemType Directory -Force -Path $thirdPartyHome | Out-Null',
    '}',
    '',
    'if (-not (Test-Path $sharedCodexHome)) {',
    '  New-Item -ItemType Directory -Force -Path $sharedCodexHome | Out-Null',
    '}',
    '',
    'if (-not (Test-Path $configPath)) {',
    '  $configText = @(',
    '    ''cli_auth_credentials_store = "file"'',',
    '    (''model_provider = "{0}"'' -f $providerName),',
    '    (''model = "{0}"'' -f $modelName),',
    '    (''review_model = "{0}"'' -f $reviewModelName),',
    '    (''model_reasoning_effort = "{0}"'' -f $reasoningEffort),',
    '    ''disable_response_storage = true'',',
    '    ''network_access = "enabled"'',',
    '    ''windows_wsl_setup_acknowledged = true'',',
    '    (''model_context_window = {0}'' -f $contextWindow),',
    '    (''model_auto_compact_token_limit = {0}'' -f $autoCompactTokenLimit),',
    '    '''',',
    '    (''[model_providers.{0}]'' -f $providerName),',
    '    (''name = "{0}"'' -f $providerName),',
    '    (''base_url = "{0}"'' -f $baseUrl),',
    '    (''env_key = "{0}"'' -f $providerEnvKeyName),',
    '    ''wire_api = "responses"'',',
    '    ''requires_openai_auth = false'',',
    '    '''',',
    '    ''[features]'',',
    '    ''apps = false''',
    '  ) -join "`r`n"',
    '  [System.IO.File]::WriteAllText($configPath, $configText + "`r`n", $utf8NoBom)',
    '}',
    '',
    'if ($Rest.Length -eq 2 -and $Rest[0] -eq "login" -and $Rest[1] -eq "status") {',
    '  if (-not (Test-Path $authPath)) {',
    '    Write-Output "Not configured (no auth.json). Run: $($MyInvocation.MyCommand.Name) login"',
    '    exit 1',
    '  }',
    '  try {',
    '    $auth = Get-Content -Raw $authPath | ConvertFrom-Json',
    '  } catch {',
    '    Write-Output "auth.json exists but is invalid JSON: $authPath"',
    '    exit 1',
    '  }',
    '  if (-not [string]::IsNullOrWhiteSpace([string]$auth.OPENAI_API_KEY)) {',
    '    $key = [string]$auth.OPENAI_API_KEY',
    '    if ($key.Length -ge 12) {',
    '      $masked = $key.Substring(0, 6) + "..." + $key.Substring($key.Length - 4)',
    '    } else {',
    '      $masked = "(hidden)"',
    '    }',
    '    Write-Output "Configured ($providerName): key=$masked"',
    '    exit 0',
    '  }',
    '  Write-Output "Configured but OPENAI_API_KEY is missing. Run: $($MyInvocation.MyCommand.Name) login"',
    '  exit 1',
    '}',
    '',
    'if ($Rest.Length -eq 1 -and $Rest[0] -eq "login") {',
    '  $apiKey = Read-Host "Input $providerName OPENAI_API_KEY (paste then press Enter)"',
    '  $apiKey = $apiKey.Trim()',
    '  if ([string]::IsNullOrWhiteSpace($apiKey)) {',
    '    Write-Error "API key is empty."',
    '    exit 1',
    '  }',
    '  $json = ([ordered]@{',
    '    auth_mode = "apikey"',
    '    OPENAI_API_KEY = $apiKey',
    '  } | ConvertTo-Json -Compress)',
    '  [System.IO.File]::WriteAllText($authPath, $json + "`r`n", $utf8NoBom)',
    '  Write-Output "Saved key to $authPath"',
    '  exit 0',
    '}',
    '',
    '$forcedConfig = @(',
    '  "-c", (''model_provider="{0}"'' -f $providerName),',
    '  "-c", ''cli_auth_credentials_store="file"'',',
    '  "-c", ''features.apps=false'',',
    '  "-c", (''model="{0}"'' -f $modelName),',
    '  "-c", (''review_model="{0}"'' -f $reviewModelName),',
    '  "-c", (''model_reasoning_effort="{0}"'' -f $reasoningEffort),',
    '  "-c", (''model_context_window={0}'' -f $contextWindow),',
    '  "-c", (''model_auto_compact_token_limit={0}'' -f $autoCompactTokenLimit),',
    '  "-c", (''model_providers.{0}.name="{0}"'' -f $providerName),',
    '  "-c", (''model_providers.{0}.base_url="{1}"'' -f $providerName, $baseUrl),',
    '  "-c", (''model_providers.{0}.env_key="{1}"'' -f $providerName, $providerEnvKeyName),',
    '  "-c", (''model_providers.{0}.wire_api="responses"'' -f $providerName),',
    '  "-c", (''model_providers.{0}.requires_openai_auth=false'' -f $providerName)',
    ')',
    '',
    '$exitCode = 0',
    'try {',
    '  if (-not (Test-Path $authPath)) {',
    '    Write-Error "Third-party auth is missing at $authPath. Run: $($MyInvocation.MyCommand.Name) login"',
    '    exit 1',
    '  }',
    '  try {',
    '    $auth = Get-Content -Raw $authPath | ConvertFrom-Json',
    '  } catch {',
    '    Write-Error "auth.json exists but is invalid JSON: $authPath"',
    '    exit 1',
    '  }',
    '  $providerApiKey = [string]$auth.OPENAI_API_KEY',
    '  if ([string]::IsNullOrWhiteSpace($providerApiKey)) {',
    '    Write-Error "OPENAI_API_KEY is missing in $authPath. Run: $($MyInvocation.MyCommand.Name) login"',
    '    exit 1',
    '  }',
    '  $providerApiKey = $providerApiKey.Trim()',
    '  $env:CODEX_HOME = $sharedCodexHome',
    '  Set-Item -Path ("Env:" + $providerEnvKeyName) -Value $providerApiKey',
    '  Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue',
    '  & codex @forcedConfig @Rest',
    '  $exitCode = $LASTEXITCODE',
    '} finally {',
    '  if ([string]::IsNullOrEmpty($previousCodexHome)) {',
    '    Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue',
    '  } else {',
    '    $env:CODEX_HOME = $previousCodexHome',
    '  }',
    '  if ([string]::IsNullOrEmpty($previousOpenAiApiKey)) {',
    '    Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue',
    '  } else {',
    '    $env:OPENAI_API_KEY = $previousOpenAiApiKey',
    '  }',
    '  if ([string]::IsNullOrEmpty($previousProviderApiKey)) {',
    '    Remove-Item ("Env:" + $providerEnvKeyName) -ErrorAction SilentlyContinue',
    '  } else {',
    '    Set-Item -Path ("Env:" + $providerEnvKeyName) -Value $previousProviderApiKey',
    '  }',
    '}',
    'exit $exitCode'
  )

  return (($lines -join "`r`n") + "`r`n")
}

function New-WrapperCmd {
  param([string]$CmdName)

  $lines = @(
    '@ECHO off',
    'SETLOCAL',
    ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0\{0}.ps1" %*' -f $CmdName)
  )

  return (($lines -join "`r`n") + "`r`n")
}

if ([string]::IsNullOrWhiteSpace($CommandName)) {
  throw "CommandName cannot be empty."
}
if (-not ($CommandName -match '^[a-zA-Z0-9-]+$')) {
  throw "CommandName must use letters, digits, or hyphens only."
}

if (-not (Test-Path $ThirdPartyHome)) {
  New-Item -ItemType Directory -Force -Path $ThirdPartyHome | Out-Null
}
if (-not (Test-Path $SharedCodexHome)) {
  New-Item -ItemType Directory -Force -Path $SharedCodexHome | Out-Null
}
if (-not (Test-Path $GlobalBinDir)) {
  New-Item -ItemType Directory -Force -Path $GlobalBinDir | Out-Null
}

$providerEnvKeyName = Get-ProviderEnvKeyName -Command $CommandName
$configPath = Join-Path $ThirdPartyHome "config.toml"
if ($ForceRewriteConfig -or -not (Test-Path $configPath)) {
  $configContent = New-ThirdPartyConfig `
    -Provider $ProviderName `
    -Url $BaseUrl `
    -ModelName $Model `
    -ReviewModelName $ReviewModel `
    -ReasoningEffort $ModelReasoningEffort `
    -EnvKeyName $providerEnvKeyName `
    -ContextWindow $ModelContextWindow `
    -AutoCompactTokenLimit $ModelAutoCompactTokenLimit
  Write-Utf8NoBom -Path $configPath -Content $configContent
} else {
  # Keep existing config text and normalize encoding.
  $existing = Get-Content -Raw $configPath
  Write-Utf8NoBom -Path $configPath -Content $existing
}

$ps1Path = Join-Path $GlobalBinDir ("{0}.ps1" -f $CommandName)
$cmdPath = Join-Path $GlobalBinDir ("{0}.cmd" -f $CommandName)
$wrapperPs1 = New-WrapperPs1 `
  -HomePath $ThirdPartyHome `
  -SharedHomePath $SharedCodexHome `
  -Provider $ProviderName `
  -Url $BaseUrl `
  -ModelName $Model `
  -ReviewModelName $ReviewModel `
  -ReasoningEffort $ModelReasoningEffort `
  -ProviderEnvKeyName $providerEnvKeyName `
  -ContextWindow $ModelContextWindow `
  -AutoCompactTokenLimit $ModelAutoCompactTokenLimit
$wrapperCmd = New-WrapperCmd -CmdName $CommandName

Write-Utf8NoBom -Path $ps1Path -Content $wrapperPs1
Write-Utf8NoBom -Path $cmdPath -Content $wrapperCmd

Write-Output "Installed wrapper command: $CommandName"
Write-Output "PS1: $ps1Path"
Write-Output "CMD: $cmdPath"
Write-Output "Third-party home: $ThirdPartyHome"
Write-Output "Shared Codex home: $SharedCodexHome"
Write-Output "Config: $configPath"
Write-Output "Next: run '$CommandName login' to set API key"
