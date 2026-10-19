# Render the sharing card with the original logo and native text drawing.
# Run from Windows PowerShell: powershell -File tools/build-share-image.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path $PSScriptRoot -Parent
$bitmap = New-Object System.Drawing.Bitmap 1200,630
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$logo = [System.Drawing.Image]::FromFile((Join-Path $projectRoot 'assets/logo.png'))
$background = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
    (New-Object System.Drawing.Point 0,0),
    (New-Object System.Drawing.Point 1200,630),
    [System.Drawing.Color]::White,
    [System.Drawing.Color]::White
)
$blend = New-Object System.Drawing.Drawing2D.ColorBlend 3
$blend.Colors = @(
    [System.Drawing.Color]::FromArgb(255,253,246),
    [System.Drawing.Color]::White,
    [System.Drawing.Color]::FromArgb(246,251,255)
)
$blend.Positions = @(0.0,0.5,1.0)
$background.InterpolationColors = $blend
$ink = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(25,25,25))
$muted = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(100,108,120))
$titleFont = New-Object System.Drawing.Font 'Malgun Gothic',40,([System.Drawing.FontStyle]::Bold),([System.Drawing.GraphicsUnit]::Pixel)
$bodyFont = New-Object System.Drawing.Font 'Malgun Gothic',25,([System.Drawing.FontStyle]::Regular),([System.Drawing.GraphicsUnit]::Pixel)
$urlFont = New-Object System.Drawing.Font 'Arial',20,([System.Drawing.FontStyle]::Regular),([System.Drawing.GraphicsUnit]::Pixel)
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.FillRectangle($background,0,0,1200,630)
    $graphics.DrawImage($logo,140,96,920,225)
    # Unicode escapes keep this file readable by Windows PowerShell's default encoding.
    $title = -join (0xBCF5,0xC0AC,0xD574,0xC11C,0x20,0xBC14,0xB85C,0x20,0xC4F0,0xB294 | ForEach-Object { [char]$_ })
    $subtitle = -join (0xD504,0xB86C,0xD504,0xD2B8,0x20,0xBAA8,0xC74C,0x20,0xB7,0x20,0xC0DD,0xC131,0xAE30 | ForEach-Object { [char]$_ })
    $graphics.DrawString($title,$titleFont,$ink,(New-Object System.Drawing.RectangleF 60,340,1080,65),$format)
    $graphics.DrawString($subtitle,$bodyFont,$muted,(New-Object System.Drawing.RectangleF 60,420,1080,50),$format)
    $graphics.DrawString('prompt-generator-black.vercel.app',$urlFont,$muted,(New-Object System.Drawing.RectangleF 60,535,1080,40),$format)
    $bitmap.Save((Join-Path $projectRoot 'assets/share-card.png'),[System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    foreach ($resource in @($format,$urlFont,$bodyFont,$titleFont,$muted,$ink,$background,$logo,$graphics,$bitmap)) { $resource.Dispose() }
}
Write-Output 'Created assets/share-card.png (1200 x 630)'
