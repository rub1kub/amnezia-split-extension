param(
  [switch]$Store,
  [switch]$Gateway
)

$ErrorActionPreference = "Stop"
if ($Store -and $Gateway) { throw "Choose one package type" }
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"
$version = (Get-Content -LiteralPath (Join-Path $root "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
$stageName = if ($Gateway) { "routeva-gateway" } elseif ($Store) { "routeva-store" } else { "routeva" }
$zipName = if ($Gateway) { "routeva-$version-gateway.zip" } elseif ($Store) { "routeva-$version-store.zip" } else { "routeva-extension.zip" }
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
$items = if ($Gateway) { @("LICENSE") } else { @("manifest.json", "assets", "data", "lib", "src") }
foreach ($item in $items) {
  Copy-Item -LiteralPath (Join-Path $root $item) -Destination $stage -Recurse
}
if ($Gateway) {
  # Package only source/docs/service units, never generated secrets or Python caches.
  $gatewayStage = Join-Path $stage "gateway"
  New-Item -ItemType Directory -Force -Path $gatewayStage | Out-Null
  foreach ($name in @("routeva_gateway.py", "test_gateway.py", "README.md", "routeva-gateway.service", "routeva-mihomo.service")) {
    Copy-Item -LiteralPath (Join-Path (Join-Path $root "gateway") $name) -Destination $gatewayStage
  }
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
