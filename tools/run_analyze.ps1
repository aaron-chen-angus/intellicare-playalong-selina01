# Runs tools/analyze.html in headless Edge on sounds/*drums.wav (and optionally the downloaded video)
# Saves beatmap.json, log.txt and check images to $env:TEMP\icm_an
param([string]$Params = "", [switch]$WithVideo)
$root = Split-Path -Parent $PSScriptRoot
$page = ([System.Uri](Join-Path $root "tools\analyze.html")).AbsoluteUri
$drumFile = Get-ChildItem (Join-Path $root "sounds") -File | Where-Object { $_.Name -match 'drums\.(wav|mp3|m4a|flac)$' } | Select-Object -First 1
if (-not $drumFile) { throw "No drum stem found in sounds/ (expected *drums.wav|mp3|m4a|flac)" }
$q = "?drums=" + [Uri]::EscapeDataString(([System.Uri]$drumFile.FullName).AbsoluteUri)
if ($WithVideo) { $q += "&video=" + [Uri]::EscapeDataString(([System.Uri](Join-Path $env:TEMP "icm_video.mp4")).AbsoluteUri) }
if ($Params) { $q += "&params=" + [Uri]::EscapeDataString($Params) }
$outDir = Join-Path $PSScriptRoot "_check"; New-Item -ItemType Directory -Force $outDir | Out-Null
$expr = "JSON.stringify({log: document.getElementById('log').textContent, beatmap: window.BEATMAP || null, imgs: Array.from(document.images).map(i => i.src)})"
& (Join-Path $PSScriptRoot "cdp_run.ps1") -Url ($page + $q) -Expr $expr -OutFile (Join-Path $outDir "result.json")
$res = Get-Content (Join-Path $outDir "result.json") -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Output $res.log
if ($res.beatmap) { ($res.beatmap | ConvertTo-Json -Depth 8 -Compress) | Out-File (Join-Path $outDir "beatmap.json") -Encoding utf8; Write-Output "beatmap saved" }
$i = 0; foreach ($s in $res.imgs) { $b64 = $s.Substring($s.IndexOf(',') + 1); [IO.File]::WriteAllBytes((Join-Path $outDir "check$i.png"), [Convert]::FromBase64String($b64)); $i++ }
Write-Output "images: $i"
