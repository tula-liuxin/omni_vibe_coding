#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [string]$CommandName = "codex3",
  [string]$ThirdPartyHome = "$env:USERPROFILE\.codex-apikey",
  [string]$SharedCodexHome = "$env:USERPROFILE\.codex",
  [string]$ProviderName = "api111",
  [string]$BaseUrl = "https://api.xcode.best/v1",
  [string]$Model = "gpt-5.4",
  [string]$ReviewModel = "",
  [string]$ModelReasoningEffort = "high",
  [string]$PreferredAuthMethod = "apikey",
  [Nullable[bool]]$RequiresOpenAiAuth = $null,
  [Nullable[bool]]$SupportsWebsockets = $null,
  [int]$ModelContextWindow = 1000000,
  [int]$ModelAutoCompactTokenLimit = 900000,
  [string]$ServiceTier = "",
  [string]$ModelVerbosity = "",
  [string]$PlanModeReasoningEffort = "",
  [string]$GlobalBinDir = "$env:APPDATA\npm",
  [switch]$ForceRewriteConfig
)

$ErrorActionPreference = "Stop"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$FixedProviderName = "api111"
$FixedPreferredAuthMethod = "apikey"
$NormalizedBaseUrl = $BaseUrl.Trim().TrimEnd("/")
$SharedSubstrateHome = Join-Path $env:USERPROFILE ".codex-shared"
$SharedDirectoryNames = @("sessions", "archived_sessions", "skills", "memories", "rules", "vendor_imports")
$SharedFileNames = @("session_index.jsonl")

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )

  $parent = Split-Path -Parent $Path
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  [System.IO.File]::WriteAllText($Path, $Content, $Utf8NoBom)
}

function Escape-PsSingleQuoted {
  param([string]$Value)
  if ([string]::IsNullOrEmpty($Value)) {
    return ""
  }
  return $Value.Replace("'", "''")
}

function Move-ExistingPathAside {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path $Path)) {
    return $true
  }
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")
  try {
    Rename-Item -LiteralPath $Path -NewName ((Split-Path -Leaf $Path) + ".pre-shared-" + $stamp) -ErrorAction Stop
    return $true
  }
  catch {
    Write-Warning "Could not move existing path aside, likely because it is in use: $Path"
    return $false
  }
}

function Merge-DirectorySeed {
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$TargetPath
  )
  if (-not (Test-Path $SourcePath)) {
    return
  }
  New-Item -ItemType Directory -Force -Path $TargetPath | Out-Null
  Get-ChildItem -LiteralPath $SourcePath -Force | ForEach-Object {
    $childTarget = Join-Path $TargetPath $_.Name
    if ($_.PSIsContainer) {
      Merge-DirectorySeed -SourcePath $_.FullName -TargetPath $childTarget
    }
    elseif (-not (Test-Path $childTarget)) {
      Copy-Item -LiteralPath $_.FullName -Destination $childTarget -Force
    }
  }
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
    $resolvedTarget = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $TargetPath).Path)
    if ($existingTarget -and $existingTarget -eq $resolvedTarget) {
      return
    }
    if ($existingItem.PSIsContainer) {
      if (-not (Move-ExistingPathAside -Path $LinkPath)) {
        return
      }
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
    $existing = Get-Item -LiteralPath $LinkPath -Force
    if ($existing.LinkType -eq "HardLink") {
      try {
        $left = Get-Item -LiteralPath $LinkPath -Force
        $right = Get-Item -LiteralPath $TargetPath -Force
        if ($left.Length -eq $right.Length -and $left.Target -contains $TargetPath) {
          return
        }
      } catch {
        # Fall through and recreate.
      }
    }
    if (-not (Move-ExistingPathAside -Path $LinkPath)) {
      return
    }
  }

  New-Item -ItemType HardLink -Path $LinkPath -Target $TargetPath | Out-Null
}

function Initialize-SharedSubstrate {
  foreach ($relativePath in $SharedDirectoryNames) {
    $targetPath = Join-Path $SharedSubstrateHome $relativePath
    New-Item -ItemType Directory -Force -Path $targetPath | Out-Null
    Merge-DirectorySeed -SourcePath (Join-Path $SharedCodexHome $relativePath) -TargetPath $targetPath
    Merge-DirectorySeed -SourcePath (Join-Path $ThirdPartyHome $relativePath) -TargetPath $targetPath
  }
  foreach ($relativePath in $SharedFileNames) {
    $targetPath = Join-Path $SharedSubstrateHome $relativePath
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetPath) | Out-Null
    if (-not (Test-Path $targetPath)) {
      New-Item -ItemType File -Force -Path $targetPath | Out-Null
    }
    foreach ($homePath in @($SharedCodexHome, $ThirdPartyHome)) {
      $legacyPath = Join-Path $homePath $relativePath
      if ((Test-Path $legacyPath) -and ((Get-Item -LiteralPath $targetPath).Length -eq 0)) {
        Copy-Item -LiteralPath $legacyPath -Destination $targetPath -Force
      }
    }
  }
}

function Ensure-SharedSubstrateLinks {
  param([Parameter(Mandatory = $true)][string]$HomePath)
  foreach ($relativePath in $SharedDirectoryNames) {
    Ensure-DirectoryJunction -LinkPath (Join-Path $HomePath $relativePath) -TargetPath (Join-Path $SharedSubstrateHome $relativePath)
  }
  foreach ($relativePath in $SharedFileNames) {
    Ensure-FileHardLink -LinkPath (Join-Path $HomePath $relativePath) -TargetPath (Join-Path $SharedSubstrateHome $relativePath)
  }
}

function Get-SharedTomlFragments {
  param(
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [Parameter(Mandatory = $true)][string]$Kind
  )
  if (-not (Test-Path $ConfigPath)) {
    return @()
  }

  $lines = ([System.IO.File]::ReadAllText($ConfigPath) -replace "`r`n", "`n" -replace "`r", "`n") -split "`n"
  $blocks = @()
  $current = $null
  $include = $false

  foreach ($line in $lines) {
    $sectionMatch = [Regex]::Match($line, '^\s*\[([^\]]+)\]\s*$')
    if ($sectionMatch.Success) {
      if ($current -and $include) {
        $blocks += (($current -join "`r`n").Trim())
      }
      $header = $sectionMatch.Groups[1].Value.Trim()
      $include =
        ($Kind -eq "mcp" -and $header.StartsWith("mcp_servers.")) -or
        ($Kind -eq "projects" -and $header.StartsWith("projects."))
      $current = @($line)
      continue
    }

    if ($current) {
      $current += $line
    }
    elseif ($Kind -eq "mcp" -and $line -match '^\s*mcp_oauth_[A-Za-z0-9_.-]+\s*=') {
      $blocks += $line.Trim()
    }
  }

  if ($current -and $include) {
    $blocks += (($current -join "`r`n").Trim())
  }

  return $blocks | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }
}

function Merge-SharedTomlFragments {
  param(
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [Parameter(Mandatory = $true)][string]$Kind,
    [string[]]$SourceConfigPaths
  )

  $blocks = @()
  if (Test-Path $OutputPath) {
    $blocks += Get-SharedTomlFragments -ConfigPath $OutputPath -Kind $Kind
  }
  foreach ($sourcePath in $SourceConfigPaths) {
    $blocks += Get-SharedTomlFragments -ConfigPath $sourcePath -Kind $Kind
  }

  $seen = [ordered]@{}
  foreach ($block in $blocks) {
    $firstLine = (($block -split '\r?\n') | Select-Object -First 1).Trim()
    $keyMatch = [Regex]::Match($firstLine, '^\s*([A-Za-z0-9_.-]+)\s*=')
    $sectionMatch = [Regex]::Match($firstLine, '^\s*\[([^\]]+)\]\s*$')
    $key =
      if ($keyMatch.Success) {
        $keyMatch.Groups[1].Value
      }
      elseif ($sectionMatch.Success) {
        $sectionMatch.Groups[1].Value
      }
      else {
        $firstLine
      }
    $seen[$key] = $block
  }

  if ($seen.Count -gt 0) {
    Write-Utf8NoBom -Path $OutputPath -Content (([string[]]$seen.Values -join "`r`n`r`n") + "`r`n")
  }
}

function Update-SharedConfigFragments {
  $configDir = Join-Path $SharedSubstrateHome "config"
  New-Item -ItemType Directory -Force -Path $configDir | Out-Null
  $sourceConfigPaths = @(
    (Join-Path $SharedCodexHome "config.toml"),
    (Join-Path $ThirdPartyHome "config.toml")
  )
  Merge-SharedTomlFragments -OutputPath (Join-Path $configDir "mcp.toml") -Kind "mcp" -SourceConfigPaths $sourceConfigPaths
  Merge-SharedTomlFragments -OutputPath (Join-Path $configDir "projects.toml") -Kind "projects" -SourceConfigPaths $sourceConfigPaths
}

function Get-SharedConfigText {
  $configDir = Join-Path $SharedSubstrateHome "config"
  if (-not (Test-Path $configDir)) {
    return ""
  }
  $blocks = @()
  Get-ChildItem -LiteralPath $configDir -Filter "*.toml" -File -Force | Sort-Object Name | ForEach-Object {
    $text = [System.IO.File]::ReadAllText($_.FullName).Trim()
    if (-not [string]::IsNullOrWhiteSpace($text)) {
      $blocks += $text
    }
  }
  if ($blocks.Count -eq 0) {
    return ""
  }
  return (($blocks -join "`r`n`r`n") + "`r`n")
}

function New-ConfigText {
  $lines = @(
    ('model_provider = "{0}"' -f $FixedProviderName),
    ('model = "{0}"' -f $Model)
  )

  if (-not [string]::IsNullOrWhiteSpace([string]$ReviewModel)) {
    $lines += ('review_model = "{0}"' -f $ReviewModel)
  }

  $lines += @(
    ('model_reasoning_effort = "{0}"' -f $ModelReasoningEffort),
    'cli_auth_credentials_store = "file"',
    'disable_response_storage = true',
    ('preferred_auth_method = "{0}"' -f $FixedPreferredAuthMethod)
  )

  if (-not [string]::IsNullOrWhiteSpace([string]$ServiceTier)) {
    $lines += ('service_tier = "{0}"' -f $ServiceTier)
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$ModelVerbosity)) {
    $lines += ('model_verbosity = "{0}"' -f $ModelVerbosity)
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$PlanModeReasoningEffort)) {
    $lines += ('plan_mode_reasoning_effort = "{0}"' -f $PlanModeReasoningEffort)
  }
  if ($ModelContextWindow -gt 0) {
    $lines += ('model_context_window = {0}' -f $ModelContextWindow)
  }
  if ($ModelAutoCompactTokenLimit -gt 0) {
    $lines += ('model_auto_compact_token_limit = {0}' -f $ModelAutoCompactTokenLimit)
  }

  $lines += @(
    '',
    ('[model_providers.{0}]' -f $FixedProviderName),
    ('name = "{0}"' -f $FixedProviderName),
    ('base_url = "{0}"' -f $NormalizedBaseUrl),
    'wire_api = "responses"'
  )

  $text = (($lines -join "`r`n") + "`r`n")
  $sharedConfigText = Get-SharedConfigText
  if (-not [string]::IsNullOrWhiteSpace($sharedConfigText)) {
    $text += "`r`n" + $sharedConfigText
  }
  return $text
}

function New-ForcedConfigItem {
  param([Parameter(Mandatory = $true)][string]$Literal)
  return "  '-c', '$Literal'"
}

function New-WrapperPs1 {
  $configSeed = New-ConfigText

  $forcedConfigLines = @(
    (New-ForcedConfigItem ('model_provider="{0}"' -f $FixedProviderName)),
    (New-ForcedConfigItem 'cli_auth_credentials_store="file"'),
    (New-ForcedConfigItem ('model="{0}"' -f (Escape-PsSingleQuoted $Model))),
    (New-ForcedConfigItem ('model_reasoning_effort="{0}"' -f (Escape-PsSingleQuoted $ModelReasoningEffort))),
    (New-ForcedConfigItem ('preferred_auth_method="{0}"' -f $FixedPreferredAuthMethod)),
    (New-ForcedConfigItem ('model_providers.{0}.name="{0}"' -f $FixedProviderName)),
    (New-ForcedConfigItem ('model_providers.{0}.base_url="{1}"' -f $FixedProviderName, (Escape-PsSingleQuoted $NormalizedBaseUrl))),
    (New-ForcedConfigItem ('model_providers.{0}.wire_api="responses"' -f $FixedProviderName))
  )

  if (-not [string]::IsNullOrWhiteSpace([string]$ReviewModel)) {
    $forcedConfigLines += (New-ForcedConfigItem ('review_model="{0}"' -f (Escape-PsSingleQuoted $ReviewModel)))
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$ServiceTier)) {
    $forcedConfigLines += (New-ForcedConfigItem ('service_tier="{0}"' -f (Escape-PsSingleQuoted $ServiceTier)))
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$ModelVerbosity)) {
    $forcedConfigLines += (New-ForcedConfigItem ('model_verbosity="{0}"' -f (Escape-PsSingleQuoted $ModelVerbosity)))
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$PlanModeReasoningEffort)) {
    $forcedConfigLines += (New-ForcedConfigItem ('plan_mode_reasoning_effort="{0}"' -f (Escape-PsSingleQuoted $PlanModeReasoningEffort)))
  }
  if ($ModelContextWindow -gt 0) {
    $forcedConfigLines += (New-ForcedConfigItem ('model_context_window={0}' -f $ModelContextWindow))
  }
  if ($ModelAutoCompactTokenLimit -gt 0) {
    $forcedConfigLines += (New-ForcedConfigItem ('model_auto_compact_token_limit={0}' -f $ModelAutoCompactTokenLimit))
  }

  $forcedConfigBlock = $forcedConfigLines -join ",`r`n"

  $template = @'
#!/usr/bin/env pwsh
param(
  [Parameter(ValueFromRemainingArguments=$true)]
  [string[]]$Rest
)

$basedir = Split-Path $MyInvocation.MyCommand.Definition -Parent
$exe = ""
if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {
  $exe = ".exe"
}
$thirdPartyHome = '__THIRD_PARTY_HOME__'
$sharedCodexHome = '__SHARED_CODEX_HOME__'
$authPath = Join-Path $thirdPartyHome 'auth.json'
$configPath = Join-Path $thirdPartyHome 'config.toml'
$sharedSubstrateHome = '__SHARED_SUBSTRATE_HOME__'
$sharedDirectoryNames = @('sessions', 'archived_sessions', 'skills', 'memories', 'rules', 'vendor_imports')
$sharedFileNames = @('session_index.jsonl')
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$previousCodexHome = [Environment]::GetEnvironmentVariable('CODEX_HOME', 'Process')
$previousOpenAiApiKey = [Environment]::GetEnvironmentVariable('OPENAI_API_KEY', 'Process')
$previousOpenAiBaseUrl = [Environment]::GetEnvironmentVariable('OPENAI_BASE_URL', 'Process')

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

function Move-ExistingPathAside {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path $Path)) {
    return $true
  }
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
  try {
    Rename-Item -LiteralPath $Path -NewName ((Split-Path -Leaf $Path) + '.pre-shared-' + $stamp) -ErrorAction Stop
    return $true
  }
  catch {
    if ($env:CODEX_SHARED_LINK_WARNINGS -eq '1') {
      Write-Warning "Could not move existing path aside, likely because it is in use: $Path"
    }
    return $false
  }
}

function Merge-DirectorySeed {
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$TargetPath
  )
  if (-not (Test-Path $SourcePath)) {
    return
  }
  New-Item -ItemType Directory -Force -Path $TargetPath | Out-Null
  Get-ChildItem -LiteralPath $SourcePath -Force | ForEach-Object {
    $childTarget = Join-Path $TargetPath $_.Name
    if ($_.PSIsContainer) {
      Merge-DirectorySeed -SourcePath $_.FullName -TargetPath $childTarget
    }
    elseif (-not (Test-Path $childTarget)) {
      Copy-Item -LiteralPath $_.FullName -Destination $childTarget -Force
    }
  }
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
    if ($existingItem.LinkType -eq 'Junction' -or $existingItem.LinkType -eq 'SymbolicLink') {
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
    $resolvedTarget = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $TargetPath).Path)
    if ($existingTarget -and $existingTarget -eq $resolvedTarget) {
      return
    }
    if ($existingItem.PSIsContainer) {
      if (-not (Move-ExistingPathAside -Path $LinkPath)) {
        return
      }
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
    $existing = Get-Item -LiteralPath $LinkPath -Force
    if ($existing.LinkType -eq 'HardLink') {
      try {
        $left = Get-Item -LiteralPath $LinkPath -Force
        $right = Get-Item -LiteralPath $TargetPath -Force
        if ($left.Length -eq $right.Length -and $left.Target -contains $TargetPath) {
          return
        }
      } catch {
        # Fall through and recreate.
      }
    }
    if (-not (Move-ExistingPathAside -Path $LinkPath)) {
      return
    }
  }

  New-Item -ItemType HardLink -Path $LinkPath -Target $TargetPath | Out-Null
}

function Initialize-SharedSubstrate {
  foreach ($relativePath in $sharedDirectoryNames) {
    $targetPath = Join-Path $sharedSubstrateHome $relativePath
    New-Item -ItemType Directory -Force -Path $targetPath | Out-Null
    Merge-DirectorySeed -SourcePath (Join-Path $sharedCodexHome $relativePath) -TargetPath $targetPath
    Merge-DirectorySeed -SourcePath (Join-Path $thirdPartyHome $relativePath) -TargetPath $targetPath
  }
  foreach ($relativePath in $sharedFileNames) {
    $targetPath = Join-Path $sharedSubstrateHome $relativePath
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetPath) | Out-Null
    if (-not (Test-Path $targetPath)) {
      New-Item -ItemType File -Force -Path $targetPath | Out-Null
    }
    foreach ($homePath in @($sharedCodexHome, $thirdPartyHome)) {
      $legacyPath = Join-Path $homePath $relativePath
      if ((Test-Path $legacyPath) -and ((Get-Item -LiteralPath $targetPath).Length -eq 0)) {
        Copy-Item -LiteralPath $legacyPath -Destination $targetPath -Force
      }
    }
  }
}

function Ensure-SharedSubstrateLinks {
  param([Parameter(Mandatory = $true)][string]$HomePath)
  foreach ($relativePath in $sharedDirectoryNames) {
    Ensure-DirectoryJunction -LinkPath (Join-Path $HomePath $relativePath) -TargetPath (Join-Path $sharedSubstrateHome $relativePath)
  }
  foreach ($relativePath in $sharedFileNames) {
    Ensure-FileHardLink -LinkPath (Join-Path $HomePath $relativePath) -TargetPath (Join-Path $sharedSubstrateHome $relativePath)
  }
}

if (-not (Test-Path $thirdPartyHome)) {
  New-Item -ItemType Directory -Force -Path $thirdPartyHome | Out-Null
}
if (-not (Test-Path $sharedCodexHome)) {
  New-Item -ItemType Directory -Force -Path $sharedCodexHome | Out-Null
}
Initialize-SharedSubstrate
Ensure-SharedSubstrateLinks -HomePath $sharedCodexHome
Ensure-SharedSubstrateLinks -HomePath $thirdPartyHome

$configSeed = @"
__CONFIG_SEED__
"@

if (-not (Test-Path $configPath)) {
  Write-Utf8NoBom -Path $configPath -Content $configSeed
}

if ($Rest.Length -eq 2 -and $Rest[0] -eq 'login' -and $Rest[1] -eq 'status') {
  if (-not (Test-Path $authPath)) {
    Write-Output 'Not configured (no auth.json). Run: codex3 login'
    exit 1
  }
  try {
    $auth = Get-Content -Raw $authPath | ConvertFrom-Json
  } catch {
    Write-Output "auth.json exists but is invalid JSON: $authPath"
    exit 1
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$auth.OPENAI_API_KEY)) {
    $key = [string]$auth.OPENAI_API_KEY
    if ($key.Length -ge 12) {
      $masked = $key.Substring(0, 6) + '...' + $key.Substring($key.Length - 4)
    } else {
      $masked = '(hidden)'
    }
    Write-Output "Configured (__PROVIDER_NAME__): key=$masked"
    exit 0
  }
  Write-Output 'Configured but OPENAI_API_KEY is missing. Run: codex3 login'
  exit 1
}

if ($Rest.Length -eq 1 -and $Rest[0] -eq 'login') {
  $apiKey = Read-Host 'Input api111 OPENAI_API_KEY (paste then press Enter)'
  $apiKey = $apiKey.Trim()
  if ([string]::IsNullOrWhiteSpace($apiKey)) {
    Write-Error 'API key is empty.'
    exit 1
  }
  $json = ([ordered]@{
    OPENAI_API_KEY = $apiKey
  } | ConvertTo-Json -Compress)
  Write-Utf8NoBom -Path $authPath -Content ($json + "`r`n")
  Write-Output "Saved key to $authPath"
  exit 0
}

$forcedConfig = @(
__FORCED_CONFIG_BLOCK__
)

$exitCode = 0
try {
  $env:CODEX_HOME = $thirdPartyHome
  Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:OPENAI_BASE_URL -ErrorAction SilentlyContinue
  if (Test-Path "$basedir/node$exe") {
    if ($MyInvocation.ExpectingInput) {
      $input | & "$basedir/node$exe" "$basedir/node_modules/@openai/codex/bin/codex.js" @forcedConfig @Rest
    } else {
      & "$basedir/node$exe" "$basedir/node_modules/@openai/codex/bin/codex.js" @forcedConfig @Rest
    }
    $exitCode = $LASTEXITCODE
  } else {
    if ($MyInvocation.ExpectingInput) {
      $input | & "node$exe" "$basedir/node_modules/@openai/codex/bin/codex.js" @forcedConfig @Rest
    } else {
      & "node$exe" "$basedir/node_modules/@openai/codex/bin/codex.js" @forcedConfig @Rest
    }
    $exitCode = $LASTEXITCODE
  }
} finally {
  if ([string]::IsNullOrEmpty($previousCodexHome)) {
    Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue
  } else {
    $env:CODEX_HOME = $previousCodexHome
  }
  if ([string]::IsNullOrEmpty($previousOpenAiApiKey)) {
    Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
  } else {
    $env:OPENAI_API_KEY = $previousOpenAiApiKey
  }
  if ([string]::IsNullOrEmpty($previousOpenAiBaseUrl)) {
    Remove-Item Env:OPENAI_BASE_URL -ErrorAction SilentlyContinue
  } else {
    $env:OPENAI_BASE_URL = $previousOpenAiBaseUrl
  }
}
exit $exitCode
'@

  $rendered = $template.Replace('__THIRD_PARTY_HOME__', (Escape-PsSingleQuoted $ThirdPartyHome))
  $rendered = $rendered.Replace('__SHARED_CODEX_HOME__', (Escape-PsSingleQuoted $SharedCodexHome))
  $rendered = $rendered.Replace('__SHARED_SUBSTRATE_HOME__', (Escape-PsSingleQuoted $SharedSubstrateHome))
  $rendered = $rendered.Replace('__PROVIDER_NAME__', $FixedProviderName)
  $rendered = $rendered.Replace('__CONFIG_SEED__', $configSeed.TrimEnd())
  $rendered = $rendered.Replace('__FORCED_CONFIG_BLOCK__', $forcedConfigBlock)
  return $rendered
}

function New-WrapperCmd {
  param([string]$CmdName)

  return (
    @(
      '@ECHO off',
      'SETLOCAL',
      ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0\{0}.ps1" %*' -f $CmdName)
    ) -join "`r`n"
  ) + "`r`n"
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

Initialize-SharedSubstrate
Update-SharedConfigFragments
Ensure-SharedSubstrateLinks -HomePath $SharedCodexHome
Ensure-SharedSubstrateLinks -HomePath $ThirdPartyHome

$configPath = Join-Path $ThirdPartyHome "config.toml"
if ($ForceRewriteConfig -or -not (Test-Path $configPath)) {
  Write-Utf8NoBom -Path $configPath -Content (New-ConfigText)
}

$ps1Path = Join-Path $GlobalBinDir "$CommandName.ps1"
$cmdPath = Join-Path $GlobalBinDir "$CommandName.cmd"

Write-Utf8NoBom -Path $ps1Path -Content (New-WrapperPs1)
Write-Utf8NoBom -Path $cmdPath -Content (New-WrapperCmd -CmdName $CommandName)

Write-Host "Installed wrapper command: $CommandName"
Write-Host "PS1: $ps1Path"
Write-Host "CMD: $cmdPath"
Write-Host "Third-party home: $ThirdPartyHome"
Write-Host "Shared Codex home: $SharedCodexHome"
Write-Host "Config: $configPath"
Write-Host "Shared substrate: $SharedSubstrateHome"
Write-Host "Shared dirs: sessions, archived_sessions, skills, memories, rules, vendor_imports"
Write-Host "Next: run '$CommandName login' to set API key"
