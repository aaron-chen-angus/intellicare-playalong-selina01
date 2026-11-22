# Builds the phone-friendly stage images from the hi-res sources in assets/src/
#   assets/src/selina-hero.png      (full kit + artist, transparent)  -> assets/stage/selina-hero.png     (640 px wide)
#   assets/src/selina-portrait.png  (3/4 shot, transparent)           -> assets/stage/selina-portrait.png (320 x 320, head and shoulders)
# Usage:  powershell -ExecutionPolicy Bypass -File tools\stage_images.ps1
# The avatar crop box is a square in source pixels: -CropX -CropY -CropSize (defaults: Selina's face in the 1312 x 1199 portrait source).
# selina-frame.png = the whole portrait, uncropped (menu "framed" pose).
param([int]$HeroWidth = 640, [int]$AvatarSize = 320, [int]$CropX = 600, [int]$CropY = 0, [int]$CropSize = 460)
$root = Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName System.Drawing
$src = Join-Path $root "assets\src"; $dst = Join-Path $root "assets\stage"
New-Item -ItemType Directory -Force $dst | Out-Null
function Save-Scaled($img, [System.Drawing.Rectangle]$crop, $w, $h, $out) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'; $g.SmoothingMode = 'HighQuality'
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $w, $h), $crop.X, $crop.Y, $crop.Width, $crop.Height, [System.Drawing.GraphicsUnit]::Pixel)
  # save via a memory stream: GDI+ Save(path) throws "A generic error" on some OneDrive-synced folders
  $ms = New-Object System.IO.MemoryStream; $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  [System.IO.File]::WriteAllBytes($out, $ms.ToArray()); $ms.Dispose(); $g.Dispose(); $bmp.Dispose()
}
$log = @()
$img = [System.Drawing.Image]::FromFile((Join-Path $src "selina-hero.png"))
$h = [int][math]::Round($img.Height * $HeroWidth / $img.Width)
$out = Join-Path $dst "selina-hero.png"
Save-Scaled $img (New-Object System.Drawing.Rectangle 0, 0, $img.Width, $img.Height) $HeroWidth $h $out
$log += "selina-hero.png: $($img.Width)x$($img.Height) -> $HeroWidth x $h, $([math]::Round((Get-Item $out).Length/1KB)) KB"; $img.Dispose()
$img = [System.Drawing.Image]::FromFile((Join-Path $src "selina-portrait.png"))
$out = Join-Path $dst "selina-portrait.png"
Save-Scaled $img (New-Object System.Drawing.Rectangle $CropX, $CropY, $CropSize, $CropSize) $AvatarSize $AvatarSize $out
$log += "selina-portrait.png: crop ($CropX,$CropY,$CropSize) -> $AvatarSize x $AvatarSize, $([math]::Round((Get-Item $out).Length/1KB)) KB"; $img.Dispose()
# Full, uncropped portrait for the framed hero pose (shown whole inside the rose-glow square on the menu)
$img = [System.Drawing.Image]::FromFile((Join-Path $src "selina-portrait.png"))
$fw = 512; $fh = [int][math]::Round($img.Height * $fw / $img.Width)
$out = Join-Path $dst "selina-frame.png"
Save-Scaled $img (New-Object System.Drawing.Rectangle 0, 0, $img.Width, $img.Height) $fw $fh $out
$log += "selina-frame.png: $($img.Width)x$($img.Height) -> $fw x $fh, $([math]::Round((Get-Item $out).Length/1KB)) KB"; $img.Dispose()
$log | Set-Content (Join-Path $PSScriptRoot "_stage.txt") -Encoding UTF8
