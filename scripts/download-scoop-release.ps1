param(
  [Parameter(Mandatory = $true)]
  [string]$Tag
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw (Join-Path $repositoryRoot "packaging/scoop/hronaut.json") | ConvertFrom-Json
$package = Get-Content -Raw (Join-Path $repositoryRoot "package.json") | ConvertFrom-Json
if ($Tag -cnotmatch '^v[0-9]+\.[0-9]+\.[0-9]+$' -or $Tag -cne "v$($manifest.version)" -or $manifest.version -cne $package.version) {
  throw "Release tag must match the current package and Scoop manifest version"
}
$filename = "hronaut-$($manifest.version)-x64-windows-portable.exe"
$expectedUrl = "https://github.com/hronaut/hronaut/releases/download/$Tag/$filename"
if ($manifest.architecture.'64bit'.url -cne $expectedUrl) {
  throw "Scoop manifest must reference the version-specific publisher release"
}
$dist = Join-Path $repositoryRoot "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$releaseSource = & gh release view $Tag --repo hronaut/hronaut --json isDraft,isPrerelease
if ($LASTEXITCODE -ne 0) { throw "Could not read published release" }
$release = $releaseSource | ConvertFrom-Json
if ($release.isDraft -or $release.isPrerelease) { throw "Expected a published stable release" }
& gh release download $Tag --repo hronaut/hronaut --pattern $filename --dir $dist
if ($LASTEXITCODE -ne 0) { throw "Could not download published portable package" }
$artifact = Join-Path $dist $filename
$actualHash = (Get-FileHash -Algorithm SHA256 $artifact).Hash.ToLowerInvariant()
if ($actualHash -cne $manifest.architecture.'64bit'.hash) {
  throw "Published portable package does not match the Scoop manifest hash"
}
& gh attestation verify $artifact --repo hronaut/hronaut --signer-workflow hronaut/hronaut/.github/workflows/release.yml
if ($LASTEXITCODE -ne 0) { throw "Published portable package attestation verification failed" }
Write-Host "Verified published Scoop package $Tag ($actualHash)"
