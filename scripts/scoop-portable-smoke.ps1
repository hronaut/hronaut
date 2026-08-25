param(
  [string]$ManifestPath = "",
  [string]$ArtifactPath = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
if (-not $ManifestPath) {
  $ManifestPath = Join-Path $repositoryRoot "packaging/scoop/hronaut.json"
}
if (-not $ArtifactPath) {
  $ArtifactPath = (Get-ChildItem (Join-Path $repositoryRoot "dist/*-windows-portable.exe") | Select-Object -First 1).FullName
}

function Get-AvailablePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try {
    return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

function Invoke-CheckedCommand {
  param(
    [string]$Command,
    [string[]]$Arguments
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command exited with code $LASTEXITCODE"
  }
}

function Wait-ForEndpoint {
  param(
    [string]$Url,
    [bool]$Available,
    [int]$TimeoutSeconds = 45
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $responding = $false
    try {
      $response = Invoke-WebRequest -Uri $Url -Method Head -TimeoutSec 2 -UseBasicParsing
      $responding = $response.StatusCode -eq 200
    } catch {
      $responding = $false
    }
    if ($responding -eq $Available) {
      return
    }
    Start-Sleep -Milliseconds 250
  }
  throw "Endpoint $Url did not reach availability=$Available within $TimeoutSeconds seconds"
}

function Start-Hronaut {
  param(
    [string]$Executable,
    [int]$Port
  )

  $env:HRONAUT_MCP_HOST = "127.0.0.1"
  $env:HRONAUT_MCP_PORT = [string]$Port
  $env:HRONAUT_DISABLE_MCP_AUTH = "1"
  Start-Process -FilePath $Executable | Out-Null
  Wait-ForEndpoint -Url "http://127.0.0.1:$Port/healthz" -Available $true
}

function Stop-Hronaut {
  param(
    [string]$Executable,
    [int]$Port
  )

  Start-Process -FilePath $Executable -ArgumentList "--quit" -Wait | Out-Null
  Wait-ForEndpoint -Url "http://127.0.0.1:$Port/healthz" -Available $false
}

$manifest = Get-Content -Raw $ManifestPath | ConvertFrom-Json
$package = Get-Content -Raw (Join-Path $repositoryRoot "package.json") | ConvertFrom-Json
$expectedFilename = "hronaut-$($package.version)-x64-windows-portable.exe"
if ($manifest.version -ne $package.version) {
  throw "Scoop manifest version $($manifest.version) does not match package version $($package.version)"
}
if ((Split-Path -Leaf $ArtifactPath) -ne $expectedFilename) {
  throw "Expected portable artifact $expectedFilename, received $(Split-Path -Leaf $ArtifactPath)"
}
if ($manifest.shortcuts[0][0] -ne $expectedFilename -or $manifest.shortcuts[0][1] -ne "Hronaut") {
  throw "Scoop manifest shortcut does not target the current portable executable"
}

$temporaryRoot = Join-Path $env:RUNNER_TEMP "hronaut-scoop-smoke-$([Guid]::NewGuid().ToString('N'))"
$serveDirectory = Join-Path $temporaryRoot "serve"
$scoopDirectory = Join-Path $temporaryRoot "scoop"
$fixtureDirectory = Join-Path $temporaryRoot "fixture"
$localManifestPath = Join-Path $temporaryRoot "hronaut.json"
$scoopInstallerPath = Join-Path $temporaryRoot "install-scoop.ps1"
$originalAppData = $env:APPDATA
$assetServer = $null
$fixtureServer = $null
$installed = $false
$installedExecutable = $null
$mcpPort = $null
$profileDirectory = $null

try {
  New-Item -ItemType Directory -Force -Path $serveDirectory, $fixtureDirectory | Out-Null
  Copy-Item $ArtifactPath (Join-Path $serveDirectory $expectedFilename)
  Set-Content -Path (Join-Path $fixtureDirectory "index.html") -Value "<!doctype html><title>Hronaut profile smoke</title><h1>Hronaut profile smoke</h1>" -Encoding UTF8

  $assetPort = Get-AvailablePort
  $fixturePort = Get-AvailablePort
  $mcpPort = Get-AvailablePort
  $assetServer = Start-Process -FilePath "python" -ArgumentList "-m", "http.server", $assetPort, "--bind", "127.0.0.1", "--directory", $serveDirectory -PassThru -WindowStyle Hidden
  $fixtureServer = Start-Process -FilePath "python" -ArgumentList "-m", "http.server", $fixturePort, "--bind", "127.0.0.1", "--directory", $fixtureDirectory -PassThru -WindowStyle Hidden
  Wait-ForEndpoint -Url "http://127.0.0.1:$assetPort/$expectedFilename" -Available $true
  Wait-ForEndpoint -Url "http://127.0.0.1:$fixturePort/" -Available $true

  $manifest.architecture.'64bit'.url = "http://127.0.0.1:$assetPort/$expectedFilename"
  $manifest.architecture.'64bit'.hash = (Get-FileHash -Algorithm SHA256 $ArtifactPath).Hash.ToLowerInvariant()
  $manifest | ConvertTo-Json -Depth 20 | Set-Content -Path $localManifestPath -Encoding UTF8

  Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
  Invoke-WebRequest -Uri "https://raw.githubusercontent.com/ScoopInstaller/Install/3bcaeb2ea53ad611fd8552eb9f735c5e2cd52f40/install.ps1" -OutFile $scoopInstallerPath -UseBasicParsing
  & $scoopInstallerPath -ScoopDir $scoopDirectory
  if ($LASTEXITCODE -ne 0) {
    throw "Scoop installer exited with code $LASTEXITCODE"
  }
  $scoopCommand = Join-Path $scoopDirectory "shims/scoop.ps1"

  Invoke-CheckedCommand -Command $scoopCommand -Arguments @("install", $localManifestPath)
  $installed = $true
  $installedExecutable = Join-Path $scoopDirectory "apps/hronaut/current/$expectedFilename"
  if (-not (Test-Path $installedExecutable)) {
    throw "Scoop did not install the portable executable"
  }
  $shortcutPath = Join-Path $originalAppData "Microsoft/Windows/Start Menu/Programs/Scoop Apps/Hronaut.lnk"
  if (-not (Test-Path $shortcutPath)) {
    throw "Scoop did not create the Hronaut Start Menu shortcut"
  }
  $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
  if ([System.IO.Path]::GetFullPath($shortcut.TargetPath) -ne [System.IO.Path]::GetFullPath($installedExecutable)) {
    throw "Hronaut shortcut targets $($shortcut.TargetPath), expected $installedExecutable"
  }

  Start-Hronaut -Executable $installedExecutable -Port $mcpPort
  $env:HRONAUT_MCP_URL = "http://127.0.0.1:$mcpPort/mcp"
  $env:HRONAUT_PROFILE_SMOKE_URL = "http://127.0.0.1:$fixturePort/"
  Remove-Item Env:HRONAUT_MCP_TOKEN -ErrorAction SilentlyContinue
  Invoke-CheckedCommand -Command "node" -Arguments @("scripts/profile-smoke.ts", "write")
  Stop-Hronaut -Executable $installedExecutable -Port $mcpPort

  $profileMarker = Get-ChildItem -Path $originalAppData -Filter "tabs.json" -File -Recurse | Where-Object {
    (Get-Content -Raw $_.FullName) -match 'Profile smoke'
  } | Select-Object -First 1
  if (-not $profileMarker) {
    $appDataContents = (Get-ChildItem -Path $originalAppData -Filter "tabs.json" -File -Recurse | Select-Object -ExpandProperty FullName) -join "`n"
    throw "Hronaut did not store the Profile smoke workspace in normal AppData. tabs.json candidates:`n$appDataContents"
  }
  $profileDirectory = $profileMarker.Directory.FullName
  $appDataPrefix = [System.IO.Path]::GetFullPath($originalAppData).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not [System.IO.Path]::GetFullPath($profileDirectory).StartsWith($appDataPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Hronaut profile was stored outside the expected AppData root: $profileDirectory"
  }
  if ([System.IO.Path]::GetFullPath($profileDirectory).StartsWith([System.IO.Path]::GetFullPath($scoopDirectory), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Hronaut profile was stored inside Scoop's versioned application directory"
  }
  Write-Host "Hronaut profile root: $profileDirectory"

  Invoke-CheckedCommand -Command $scoopCommand -Arguments @("uninstall", "hronaut")
  $installed = $false
  if (Test-Path $installedExecutable) {
    throw "Scoop uninstall retained the portable executable"
  }
  if (Test-Path $shortcutPath) {
    throw "Scoop uninstall retained the Hronaut shortcut"
  }
  if (-not (Test-Path $profileDirectory)) {
    throw "Scoop uninstall removed Hronaut user data"
  }

  Invoke-CheckedCommand -Command $scoopCommand -Arguments @("install", $localManifestPath)
  $installed = $true
  Start-Hronaut -Executable $installedExecutable -Port $mcpPort
  Invoke-CheckedCommand -Command "node" -Arguments @("scripts/profile-smoke.ts", "read")
  Invoke-CheckedCommand -Command "node" -Arguments @("scripts/mcp-smoke.ts")
  Invoke-CheckedCommand -Command "node" -Arguments @("scripts/profile-smoke.ts", "cleanup")
  Stop-Hronaut -Executable $installedExecutable -Port $mcpPort

  Invoke-CheckedCommand -Command $scoopCommand -Arguments @("uninstall", "hronaut")
  $installed = $false
  if ((Test-Path $installedExecutable) -or (Test-Path $shortcutPath)) {
    throw "Final Scoop uninstall retained package files"
  }
  if (-not (Test-Path $profileDirectory)) {
    throw "Final Scoop uninstall removed the intentionally retained Hronaut profile"
  }

  Write-Host "Scoop portable smoke passed: install, shortcut, MCP, external AppData persistence, uninstall, reinstall, relaunch, and final uninstall."
} finally {
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like "hronaut*" } | Stop-Process -Force
  if ($installed -and (Test-Path (Join-Path $scoopDirectory "shims/scoop.ps1"))) {
    & (Join-Path $scoopDirectory "shims/scoop.ps1") uninstall hronaut | Out-Null
  }
  if ($assetServer -and -not $assetServer.HasExited) {
    Stop-Process -Id $assetServer.Id -Force
  }
  if ($fixtureServer -and -not $fixtureServer.HasExited) {
    Stop-Process -Id $fixtureServer.Id -Force
  }
  if ($profileDirectory -and (Test-Path $profileDirectory)) {
    Remove-Item -Recurse -Force $profileDirectory -ErrorAction SilentlyContinue
  }
  Remove-Item -Recurse -Force $temporaryRoot -ErrorAction SilentlyContinue
}
