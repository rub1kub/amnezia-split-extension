param(
  [switch]$Store
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"
$stageName = if ($Store) { "amnezia-split-store" } else { "amnezia-split" }
$zipName = if ($Store) { "amnezia-split-0.4.0-store.zip" } else { "amnezia-split-extension.zip" }
$stage = Join-Path $dist $stageName
$zip = Join-Path $dist $zipName
$distFull = [IO.Path]::GetFullPath($dist)
$stageFull = [IO.Path]::GetFullPath($stage)

if (-not $stageFull.StartsWith($distFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe staging path: $stageFull"
}

if (Test-Path $stageFull) { Remove-Item -LiteralPath $stageFull -Recurse -Force }
if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }

New-Item -ItemType Directory -Force -Path $stage | Out-Null
foreach ($item in @("manifest.json", "assets", "data", "lib", "src")) {
  Copy-Item -LiteralPath (Join-Path $root $item) -Destination $stage -Recurse
}

if ($Store) {
  $manifestPath = Join-Path $stage "manifest.json"
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($manifest.PSObject.Properties.Name -contains "update_url") {
    $manifest.PSObject.Properties.Remove("update_url")
    $json = $manifest | ConvertTo-Json -Depth 20
    [IO.File]::WriteAllText($manifestPath, $json, [Text.UTF8Encoding]::new($false))
  }
}

Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -CompressionLevel Optimal
Write-Output $zip
