#!/usr/bin/env pwsh
param(
  [string]$CommandName = "codex3",
  [string]$ThirdPartyHome = "$env:USERPROFILE\.codex-apikey",
  [string]$SharedCodexHome = "$env:USERPROFILE\.codex",
  [string]$ProviderName = "openai",
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

function Ensure-DirectoryJunction {
  param(
    [Parameter(Mandatory = $true)][string]$LinkPath,
    [Parameter(Mandatory = $true)][string]$TargetPath
  )

  if (-not (Test-Path $TargetPath)) {
    New-Item -ItemType Directory -Force -Path $TargetPath | Out-Null
  }

  if (Test-Path $LinkPath) {
    $existingItem = Get-Item -LiteralPath $LinkPath -Force
    $existingTarget = $null
    if ($existingItem.LinkType -eq "Junction" -or $existingItem.LinkType -eq "SymbolicLink") {
      $targetValue = $existingItem.Target
      if ($targetValue -is [System.Array]) {
        $targetValue = $targetValue[0]
      }
      if (-not [string]::IsNullOrWhiteSpace([string]$targetValue)) {
        try {
          $existingTarget = [System.IO.Path]::GetFullPath([string]$targetValue)
        } catch {
          $existingTarget = $null
        }
      }
    }
    $targetResolved = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $TargetPath).Path)
    if ($existingTarget -and $existingTarget -eq $targetResolved) {
      return
    }

    if ($existingItem.PSIsContainer) {
      $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
      $backupPath = "{0}.pre-shared-{1}" -f $LinkPath, $timestamp
      Get-ChildItem -LiteralPath $LinkPath -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $TargetPath -Recurse -Force
      }
      Move-Item -LiteralPath $LinkPath -Destination $backupPath -Force
    } else {
      throw "Expected directory at $LinkPath before creating shared session junction."
    }
  }

  New-Item -ItemType Junction -Path $LinkPath -Target $TargetPath | Out-Null
}

function Ensure-FileHardLink {
  param(
    [Parameter(Mandatory = $true)][string]$LinkPath,
    [Parameter(Mandatory = $true)][string]$TargetPath
  )

  $targetParent = Split-Path -Parent $TargetPath
  if ($targetParent -and -not (Test-Path $targetParent)) {
    New-Item -ItemType Directory -Force -Path $targetParent | Out-Null
  }
  if (-not (Test-Path $TargetPath)) {
    New-Item -ItemType File -Force -Path $TargetPath | Out-Null
  }

  if (Test-Path $LinkPath) {
    Remove-Item -LiteralPath $LinkPath -Force
  }

  New-Item -ItemType HardLink -Path $LinkPath -Target $TargetPath | Out-Null
}

function Use-BuiltInOpenAiProvider {
  param([string]$Provider)

  return ($Provider.Trim().ToLowerInvariant() -eq "openai")
}

function Get-EffectiveOpenAiBaseUrl {
  param([string]$Url)

  $trimmed = $Url.Trim().TrimEnd('/')
  if ($trimmed -match '/v1$') {
    return $trimmed
  }
  return "$trimmed/v1"
}

function New-ThirdPartyConfig {
  param(
    [string]$Provider,
    [string]$Url,
    [string]$ModelName,
    [string]$ReviewModelName,
    [string]$ReasoningEffort,
    [int]$ContextWindow,
    [int]$AutoCompactTokenLimit
  )

  $lines = @(
    'cli_auth_credentials_store = "file"'
  )

  if (Use-BuiltInOpenAiProvider -Provider $Provider) {
    $effectiveOpenAiBaseUrl = Get-EffectiveOpenAiBaseUrl -Url $Url
    $lines += @(
      'model_provider = "openai"',
      ('openai_base_url = "{0}"' -f $effectiveOpenAiBaseUrl)
    )
  } else {
    $lines += @(
      ('model_provider = "{0}"' -f $Provider)
    )
  }

  $lines += @(
    ('model = "{0}"' -f $ModelName),
    ('review_model = "{0}"' -f $ReviewModelName),
    ('model_reasoning_effort = "{0}"' -f $ReasoningEffort),
    'disable_response_storage = true',
    'network_access = "enabled"',
    'windows_wsl_setup_acknowledged = true',
    ('model_context_window = {0}' -f $ContextWindow),
    ('model_auto_compact_token_limit = {0}' -f $AutoCompactTokenLimit)
  )

  if (-not (Use-BuiltInOpenAiProvider -Provider $Provider)) {
    $lines += @(
      '',
      ('[model_providers.{0}]' -f $Provider),
      ('name = "{0}"' -f $Provider),
      ('base_url = "{0}"' -f $Url),
      'wire_api = "responses"',
      'requires_openai_auth = true'
    )
  }

  $lines += @(
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
    [int]$ContextWindow,
    [int]$AutoCompactTokenLimit
  )

  $useBuiltInOpenAi = Use-BuiltInOpenAiProvider -Provider $Provider
  $effectiveOpenAiBaseUrl = Get-EffectiveOpenAiBaseUrl -Url $Url

  $configBootstrapLines = @(
    '    ''cli_auth_credentials_store = "file"'','
  )

  if ($useBuiltInOpenAi) {
    $configBootstrapLines += @(
      '    ''model_provider = "openai"'',',
      ('    (''openai_base_url = "{0}"'' -f $baseUrl),' -f $effectiveOpenAiBaseUrl)
    )
  } else {
    $configBootstrapLines += @(
      ('    (''model_provider = "{0}"'' -f $providerName),' -f $Provider)
    )
  }

  $configBootstrapLines += @(
    ('    (''model = "{0}"'' -f $modelName),' -f $ModelName),
    ('    (''review_model = "{0}"'' -f $reviewModelName),' -f $ReviewModelName),
    ('    (''model_reasoning_effort = "{0}"'' -f $reasoningEffort),' -f $ReasoningEffort),
    '    ''disable_response_storage = true'',',
    '    ''network_access = "enabled"'',',
    '    ''windows_wsl_setup_acknowledged = true'',',
    ('    (''model_context_window = {0}'' -f $contextWindow),' -f $ContextWindow),
    ('    (''model_auto_compact_token_limit = {0}'' -f $autoCompactTokenLimit),' -f $AutoCompactTokenLimit)
  )

  if (-not $useBuiltInOpenAi) {
    $configBootstrapLines += @(
      '    '''',',
      ('    (''[model_providers.{0}]'' -f $providerName),' -f $Provider),
      ('    (''name = "{0}"'' -f $providerName),' -f $Provider),
      ('    (''base_url = "{0}"'' -f $baseUrl),' -f $Url),
      '    ''wire_api = "responses"'',',
      '    ''requires_openai_auth = true'','
    )
  }

  $configBootstrapLines += @(
    '    '''',',
    '    ''[features]'',',
    '    ''apps = false'''
  )

  $forcedConfigLines = @(
    '  "-c", ''cli_auth_credentials_store="file"'',',
    '  "-c", ''features.apps=false'',',
    ('  "-c", (''model="{0}"'' -f $modelName),' -f $ModelName),
    ('  "-c", (''review_model="{0}"'' -f $reviewModelName),' -f $ReviewModelName),
    ('  "-c", (''model_reasoning_effort="{0}"'' -f $reasoningEffort),' -f $ReasoningEffort),
    ('  "-c", (''model_context_window={0}'' -f $contextWindow),' -f $ContextWindow),
    ('  "-c", (''model_auto_compact_token_limit={0}'' -f $autoCompactTokenLimit),' -f $AutoCompactTokenLimit)
  )

  if ($useBuiltInOpenAi) {
    $forcedConfigLines = @(
      '  "-c", ''model_provider="openai"'',',
      ('  "-c", (''openai_base_url="{0}"'' -f $baseUrl),' -f $effectiveOpenAiBaseUrl)
    ) + $forcedConfigLines
  } else {
    $forcedConfigLines = @(
      ('  "-c", (''model_provider="{0}"'' -f $providerName),' -f $Provider)
    ) + $forcedConfigLines + @(
      ('  "-c", (''model_providers.{0}.name="{0}"'' -f $providerName),' -f $Provider),
      ('  "-c", (''model_providers.{0}.base_url="{1}"'' -f $providerName, $baseUrl),' -f $Provider, $Url),
      ('  "-c", (''model_providers.{0}.wire_api="responses"'' -f $providerName),' -f $Provider),
      ('  "-c", (''model_providers.{0}.requires_openai_auth=true'' -f $providerName)' -f $Provider)
    )
  }

  if ($forcedConfigLines.Count -gt 0) {
    $forcedConfigLines[$forcedConfigLines.Count - 1] = $forcedConfigLines[$forcedConfigLines.Count - 1].TrimEnd(',')
  }

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
    '$sharedSessionDirs = @("sessions", "archived_sessions")',
    '$sharedSessionIndexPath = Join-Path $sharedCodexHome "session_index.jsonl"',
    '',
    'function Ensure-DirectoryJunction {',
    '  param(',
    '    [Parameter(Mandatory = $true)][string]$LinkPath,',
    '    [Parameter(Mandatory = $true)][string]$TargetPath',
    '  )',
    '',
    '  if (-not (Test-Path $TargetPath)) {',
    '    New-Item -ItemType Directory -Force -Path $TargetPath | Out-Null',
    '  }',
    '',
    '  if (Test-Path $LinkPath) {',
    '    $existingItem = Get-Item -LiteralPath $LinkPath -Force',
    '    $existingTarget = $null',
    '    if ($existingItem.LinkType -eq "Junction" -or $existingItem.LinkType -eq "SymbolicLink") {',
    '      $targetValue = $existingItem.Target',
    '      if ($targetValue -is [System.Array]) {',
    '        $targetValue = $targetValue[0]',
    '      }',
    '      if (-not [string]::IsNullOrWhiteSpace([string]$targetValue)) {',
    '        try {',
    '          $existingTarget = [System.IO.Path]::GetFullPath([string]$targetValue)',
    '        } catch {',
    '          $existingTarget = $null',
    '        }',
    '      }',
    '    }',
    '    $targetResolved = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $TargetPath).Path)',
    '    if ($existingTarget -and $existingTarget -eq $targetResolved) {',
    '      return',
    '    }',
    '',
    '    if ($existingItem.PSIsContainer) {',
    '      $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"',
    '      $backupPath = "{0}.pre-shared-{1}" -f $LinkPath, $timestamp',
    '      Get-ChildItem -LiteralPath $LinkPath -Force | ForEach-Object {',
    '        Copy-Item -LiteralPath $_.FullName -Destination $TargetPath -Recurse -Force',
    '      }',
    '      Move-Item -LiteralPath $LinkPath -Destination $backupPath -Force',
    '    } else {',
    '      throw "Expected directory at $LinkPath before creating shared session junction."',
    '    }',
    '  }',
    '',
    '  New-Item -ItemType Junction -Path $LinkPath -Target $TargetPath | Out-Null',
    '}',
    '',
    'function Ensure-FileHardLink {',
    '  param(',
    '    [Parameter(Mandatory = $true)][string]$LinkPath,',
    '    [Parameter(Mandatory = $true)][string]$TargetPath',
    '  )',
    '',
    '  $targetParent = Split-Path -Parent $TargetPath',
    '  if ($targetParent -and -not (Test-Path $targetParent)) {',
    '    New-Item -ItemType Directory -Force -Path $targetParent | Out-Null',
    '  }',
    '  if (-not (Test-Path $TargetPath)) {',
    '    New-Item -ItemType File -Force -Path $TargetPath | Out-Null',
    '  }',
    '',
    '  if (Test-Path $LinkPath) {',
    '    Remove-Item -LiteralPath $LinkPath -Force',
    '  }',
    '',
    '  New-Item -ItemType HardLink -Path $LinkPath -Target $TargetPath | Out-Null',
    '}',
    '',
    'if (-not (Test-Path $thirdPartyHome)) {',
    '  New-Item -ItemType Directory -Force -Path $thirdPartyHome | Out-Null',
    '}',
    'if (-not (Test-Path $sharedCodexHome)) {',
    '  New-Item -ItemType Directory -Force -Path $sharedCodexHome | Out-Null',
    '}',
    'foreach ($relativePath in $sharedSessionDirs) {',
    '  Ensure-DirectoryJunction -LinkPath (Join-Path $thirdPartyHome $relativePath) -TargetPath (Join-Path $sharedCodexHome $relativePath)',
    '}',
    'Ensure-FileHardLink -LinkPath (Join-Path $thirdPartyHome "session_index.jsonl") -TargetPath $sharedSessionIndexPath',
    '',
    'if (-not (Test-Path $configPath)) {',
    '  $configText = @('
  )
  $lines += $configBootstrapLines
  $lines += @(
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
    '$forcedConfig = @('
  )
  $lines += $forcedConfigLines
  $lines += @(
    ')',
    '',
    '$exitCode = 0',
    'try {',
    '  $env:CODEX_HOME = $thirdPartyHome',
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
if (-not (Test-Path $GlobalBinDir)) {
  New-Item -ItemType Directory -Force -Path $GlobalBinDir | Out-Null
}

$configPath = Join-Path $ThirdPartyHome "config.toml"
if ($ForceRewriteConfig -or -not (Test-Path $configPath)) {
  $configContent = New-ThirdPartyConfig `
    -Provider $ProviderName `
    -Url $BaseUrl `
    -ModelName $Model `
    -ReviewModelName $ReviewModel `
    -ReasoningEffort $ModelReasoningEffort `
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

foreach ($relativePath in @("sessions", "archived_sessions")) {
  Ensure-DirectoryJunction `
    -LinkPath (Join-Path $ThirdPartyHome $relativePath) `
    -TargetPath (Join-Path $SharedCodexHome $relativePath)
}
Ensure-FileHardLink `
  -LinkPath (Join-Path $ThirdPartyHome "session_index.jsonl") `
  -TargetPath (Join-Path $SharedCodexHome "session_index.jsonl")

$wrapperPs1 = New-WrapperPs1 `
  -HomePath $ThirdPartyHome `
  -SharedHomePath $SharedCodexHome `
  -Provider $ProviderName `
  -Url $BaseUrl `
  -ModelName $Model `
  -ReviewModelName $ReviewModel `
  -ReasoningEffort $ModelReasoningEffort `
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
Write-Output "Shared session dirs: sessions, archived_sessions"
Write-Output "Next: run '$CommandName login' to set API key"
