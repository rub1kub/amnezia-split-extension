param(
  [string]$ExtensionId = "apikojlampdnhoeahaicppemblbghjnc",
  [string]$UpdateUrl = "https://raw.githubusercontent.com/rub1kub/amnezia-split-extension/main/updates.xml"
)

$ErrorActionPreference = "Stop"
$policyPath = "HKCU:\Software\Policies\BraveSoftware\Brave"
$valueName = "ExtensionSettings"
$settings = [ordered]@{}

if (Test-Path -LiteralPath $policyPath) {
  $existing = (Get-ItemProperty -LiteralPath $policyPath -Name $valueName -ErrorAction SilentlyContinue).$valueName
  if ($existing) {
    $parsed = $existing | ConvertFrom-Json
    foreach ($property in $parsed.PSObject.Properties) {
      $settings[$property.Name] = $property.Value
    }
  }
}

$settings[$ExtensionId] = [ordered]@{
  installation_mode = "normal_installed"
  update_url = $UpdateUrl
  override_update_url = $true
  toolbar_pin = "default_pinned"
}

New-Item -Path $policyPath -Force | Out-Null
Set-ItemProperty -LiteralPath $policyPath -Name $valueName -Type String -Value ($settings | ConvertTo-Json -Depth 10 -Compress)
Write-Output "Brave policy installed for $ExtensionId"
