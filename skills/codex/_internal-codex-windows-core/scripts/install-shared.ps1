[CmdletBinding()]
param()

function Get-ResolvedSkillRoot {
  param(
    [string]$SkillRoot,
    [string]$PSScriptRootValue,
    [string]$PSCommandPathValue,
    [string]$InvocationPathValue
  )

  if ($SkillRoot) {
    return (Resolve-Path $SkillRoot).Path
  }

  $ScriptRoot =
    if ($PSScriptRootValue) {
      $PSScriptRootValue
    }
    elseif ($PSCommandPathValue) {
      Split-Path -Parent $PSCommandPathValue
    }
    elseif ($InvocationPathValue) {
      Split-Path -Parent $InvocationPathValue
    }
    else {
      (Get-Location).Path
    }

  return (Resolve-Path (Join-Path $ScriptRoot "..")).Path
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

function Get-SharedCoreRoot {
  param(
    [Parameter(Mandatory = $true)][string]$ResolvedSkillRoot
  )

  $candidate = Join-Path (Split-Path -Parent $ResolvedSkillRoot) "_internal-codex-windows-core"
  if (-not (Test-Path $candidate)) {
    throw "Missing internal shared Windows core at $candidate"
  }
  return (Resolve-Path $candidate).Path
}

function Copy-ManagerRuntimeAssets {
  param(
    [Parameter(Mandatory = $true)][string]$AssetRoot,
    [Parameter(Mandatory = $true)][string]$ManagerHome,
    [Parameter(Mandatory = $true)][string]$SharedCoreRoot,
    [string[]]$ExtraScriptFiles = @()
  )

  foreach ($RequiredAsset in @("index.mjs", "package.json", "package-lock.json")) {
    $AssetPath = Join-Path $AssetRoot $RequiredAsset
    if (-not (Test-Path $AssetPath)) {
      throw "Missing runtime asset: $AssetPath"
    }
  }

  $SharedRuntimeRoot = Join-Path $SharedCoreRoot "runtime"
  if (-not (Test-Path $SharedRuntimeRoot)) {
    throw "Missing shared runtime asset root: $SharedRuntimeRoot"
  }

  New-Item -ItemType Directory -Force -Path $ManagerHome | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $ManagerHome "_shared") | Out-Null

  Copy-Item -Path (Join-Path $AssetRoot "index.mjs") -Destination (Join-Path $ManagerHome "index.mjs") -Force
  Copy-Item -Path (Join-Path $AssetRoot "package.json") -Destination (Join-Path $ManagerHome "package.json") -Force
  Copy-Item -Path (Join-Path $AssetRoot "package-lock.json") -Destination (Join-Path $ManagerHome "package-lock.json") -Force
  Copy-Item -Path (Join-Path $SharedRuntimeRoot "*") -Destination (Join-Path $ManagerHome "_shared") -Recurse -Force

  foreach ($scriptFile in $ExtraScriptFiles) {
    if (-not (Test-Path $scriptFile)) {
      throw "Missing extra script asset: $scriptFile"
    }
    $scriptsDir = Join-Path $ManagerHome "scripts"
    New-Item -ItemType Directory -Force -Path $scriptsDir | Out-Null
    Copy-Item -Path $scriptFile -Destination (Join-Path $scriptsDir (Split-Path -Leaf $scriptFile)) -Force
  }
}

function Install-ManagerDependencies {
  param(
    [Parameter(Mandatory = $true)][string]$ManagerHome,
    [switch]$SkipNpmInstall
  )

  Require-Command -Name node
  if ($SkipNpmInstall) {
    return
  }

  Require-Command -Name npm
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

function Write-NodeLauncherPair {
  param(
    [Parameter(Mandatory = $true)][string]$LauncherDir,
    [Parameter(Mandatory = $true)][string]$CommandName,
    [Parameter(Mandatory = $true)][string]$Ps1Content,
    [Parameter(Mandatory = $true)][string]$CmdContent
  )

  New-Item -ItemType Directory -Force -Path $LauncherDir | Out-Null
  Write-Utf8NoBom -Path (Join-Path $LauncherDir "$CommandName.ps1") -Content $Ps1Content
  Write-Utf8NoBom -Path (Join-Path $LauncherDir "$CommandName.cmd") -Content $CmdContent
}
