$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$master = Join-Path $root 'assets\tenma-icon.png'
$icons = Join-Path $root 'src-tauri\icons'
$paths = @($master) + @(Get-ChildItem -LiteralPath $icons -Filter '*.png' | ForEach-Object FullName) + @((Join-Path $root 'public\icon.png'))
foreach ($path in $paths) {
  $image = [Drawing.Bitmap]::FromFile($path)
  try {
    if ($image.Width -ne $image.Height) { throw "Non-square icon: $path" }
    if ($image.GetPixel(0,0).A -ne 0 -or $image.GetPixel($image.Width-1,0).A -ne 0 -or $image.GetPixel(0,$image.Height-1).A -ne 0 -or $image.GetPixel($image.Width-1,$image.Height-1).A -ne 0) { throw "Opaque corner / residual rectangular background: $path" }
    if ($image.GetPixel([int]($image.Width/2),[int]($image.Height/2)).A -ne 255) { throw "Damaged illustration opacity: $path" }
    if ($image.GetPixel([int]($image.Width/2),2).A -lt 240) { throw "Unexpected top padding: $path" }
    if ($image.GetPixel(2,[int]($image.Height/2)).A -lt 240) { throw "Unexpected left padding: $path" }
  } finally { $image.Dispose() }
}
$ico = [IO.File]::ReadAllBytes((Join-Path $icons 'icon.ico'))
if ([BitConverter]::ToUInt16($ico,2) -ne 1) { throw 'Invalid ICO header' }
$count = [BitConverter]::ToUInt16($ico,4)
$sizes = for ($i=0; $i -lt $count; $i++) { $offset=6+16*$i; if ($ico[$offset] -eq 0) { 256 } else { [int]$ico[$offset] } }
foreach ($size in @(16,24,32,48,64,256)) { if ($sizes -notcontains $size) { throw "Missing ICO resolution: $size" } }
if ((Get-FileHash (Join-Path $icons 'icon.ico')).Hash -ne (Get-FileHash (Join-Path $root 'public\favicon.ico')).Hash) { throw 'Web favicon differs from desktop icon' }
if ((Get-FileHash (Join-Path $icons '128x128@2x.png')).Hash -ne (Get-FileHash (Join-Path $root 'public\icon.png')).Hash) { throw 'About/web icon differs from desktop icon' }
$config = Get-Content -LiteralPath (Join-Path $root 'src-tauri\tauri.conf.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($path in $config.bundle.icon) { if (-not (Test-Path (Join-Path $root "src-tauri\$path"))) { throw "Missing configured icon: $path" } }
if ($config.bundle.windows.nsis.installerIcon -ne 'icons/icon.ico' -or $config.bundle.windows.nsis.uninstallerIcon -ne 'icons/icon.ico') { throw 'Installer/uninstaller icon mapping missing' }
"PASS: $($paths.Count) square PNGs, clean transparent corners, tight crop, all ICO sizes and web/desktop/installer icon consistency"
