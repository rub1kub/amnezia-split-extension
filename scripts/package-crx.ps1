param(
  [string]$BravePath = "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
  [string]$KeyPath = "$env:LOCALAPPDATA\Amnezia Split\amnezia-split.pem"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $root "dist\amnezia-split"
$generatedKey = Join-Path $root "dist\amnezia-split.pem"
$crx = Join-Path $root "dist\amnezia-split.crx"

& (Join-Path $PSScriptRoot "package.ps1") | Out-Null
if (-not (Test-Path -LiteralPath $BravePath)) { throw "Brave not found: $BravePath" }
if (Test-Path -LiteralPath $crx) { Remove-Item -LiteralPath $crx -Force }

if (Test-Path -LiteralPath $KeyPath) {
  & $BravePath --pack-extension=$stage --pack-extension-key=$KeyPath
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $KeyPath) | Out-Null
  & $BravePath --pack-extension=$stage
  if (-not (Test-Path -LiteralPath $generatedKey)) { throw "Brave did not create the signing key" }
  Move-Item -LiteralPath $generatedKey -Destination $KeyPath
  & icacls $KeyPath /inheritance:r /grant:r "$env:USERNAME`:F" | Out-Null
}

for ($attempt = 0; $attempt -lt 40 -and -not (Test-Path -LiteralPath $crx); $attempt++) {
  Start-Sleep -Milliseconds 250
}
if (-not (Test-Path -LiteralPath $crx)) { throw "Brave did not create the CRX package" }
Write-Output $crx
