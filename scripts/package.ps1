$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"
$stage = Join-Path $dist "amnezia-split"
$zip = Join-Path $dist "amnezia-split-extension.zip"
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
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -CompressionLevel Optimal
Write-Output $zip
