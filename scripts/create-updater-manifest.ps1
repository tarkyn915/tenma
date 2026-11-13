param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Repository,
  [Parameter(Mandatory = $true)][string]$BundleDirectory,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [string]$Notes = "Tenma $Version automatic update"
)

$ErrorActionPreference = 'Stop'
$expectedName = "Tenma_${Version}_x64-setup.exe"
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
      url = "https://github.com/$Repository/releases/download/v$Version/$($exe.Name)"
    }
  }
}
$parent = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding utf8
Write-Output "Created $OutputPath for $($exe.Name)"
