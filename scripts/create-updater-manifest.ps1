param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Repository,
  [Parameter(Mandatory = $true)][string]$BundleDirectory,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [string]$Notes = "Tenma Player $Version update"
)

$ErrorActionPreference = 'Stop'
$configPath = Join-Path $PSScriptRoot '../src-tauri/tauri.conf.json'
$config = Get-Content -LiteralPath $configPath -Raw -Encoding utf8 | ConvertFrom-Json
if ($Version -ne $config.version) { throw "Release version $Version does not match app version $($config.version)" }
$expectedName = "$($config.productName)_${Version}_x64-setup.exe"
$exe = Get-Item -LiteralPath (Join-Path (Join-Path $BundleDirectory 'nsis') $expectedName) -ErrorAction SilentlyContinue
if (-not $exe) { throw "NSIS installer not found: $expectedName" }
$sigPath = "$($exe.FullName).sig"
if (-not (Test-Path -LiteralPath $sigPath)) { throw "Updater signature not found: $sigPath" }
$signature = (Get-Content -LiteralPath $sigPath -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($signature)) { throw "Updater signature is empty: $sigPath" }

$manifest = [ordered]@{
  version = $Version
  notes = $Notes
  pub_date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  platforms = [ordered]@{
    'windows-x86_64' = [ordered]@{
      signature = $signature
      url = "https://github.com/$Repository/releases/download/v$Version/$([Uri]::EscapeDataString($exe.Name))"
    }
  }
}
# Prefer the original installer type when the client provides it.
$manifest.platforms['windows-x86_64-nsis'] = $manifest.platforms['windows-x86_64']
$msiFiles = @(Get-ChildItem -LiteralPath (Join-Path $BundleDirectory 'msi') -Filter "$($config.productName)_${Version}_x64_*.msi" -File -ErrorAction SilentlyContinue)
if ($msiFiles.Count -gt 1) { throw "Expected one Windows MSI, found $($msiFiles.Count)" }
if ($msiFiles.Count -eq 1) {
  $msi = $msiFiles[0]
  $msiSignature = (Get-Content -LiteralPath "$($msi.FullName).sig" -Raw -Encoding utf8).Trim()
  if ([string]::IsNullOrWhiteSpace($msiSignature)) { throw "Updater signature is empty: $($msi.Name).sig" }
  $manifest.platforms['windows-x86_64-msi'] = [ordered]@{
    signature = $msiSignature
    url = "https://github.com/$Repository/releases/download/v$Version/$([Uri]::EscapeDataString($msi.Name))"
  }
}

$parent = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$json = $manifest | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath), $json, (New-Object Text.UTF8Encoding($false)))
Write-Output "Created $OutputPath for $($exe.Name)"
