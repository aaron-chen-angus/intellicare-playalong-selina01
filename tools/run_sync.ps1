# Sync spot check of the built chart against the video soundtrack. Output: tools/_check/sync_log.txt
$root = Split-Path -Parent $PSScriptRoot
$U = { param($p) [Uri]::EscapeDataString(([System.Uri]$p).AbsoluteUri) }
$page = ([System.Uri](Join-Path $root "tools\sync_check.html")).AbsoluteUri
$q = "?video=" + (& $U (Join-Path $env:TEMP "icm_video.mp4")) + "&chart=" + (& $U (Join-Path $PSScriptRoot "_check\beatmap_final.json"))
$out = Join-Path $PSScriptRoot "_check"
& (Join-Path $PSScriptRoot "cdp_run.ps1") -Url ($page + $q) -Expr "JSON.stringify({log: document.getElementById('log').textContent})" -OutFile (Join-Path $out "sync_result.json") -Port 9337
$r = [IO.File]::ReadAllText((Join-Path $out "sync_result.json"), [Text.Encoding]::UTF8) | ConvertFrom-Json
[IO.File]::WriteAllText((Join-Path $out "sync_log.txt"), $r.log, (New-Object Text.UTF8Encoding $false))
