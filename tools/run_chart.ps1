# Runs tools/chart.html in headless Edge: tempo grid + 4/4 bar patterns + piecewise stem→video alignment.
# Needs tools/_check/beatmap.json (from run_analyze.ps1) and the video at $env:TEMP\icm_video.mp4.
# Output: tools/_check/chart_log.txt (human-readable) and tools/_check/chart.json
$root = Split-Path -Parent $PSScriptRoot
$U = { param($p) [Uri]::EscapeDataString(([System.Uri]$p).AbsoluteUri) }
$page = ([System.Uri](Join-Path $root "tools\chart.html")).AbsoluteUri
$drum = Get-ChildItem (Join-Path $root "sounds") -File | Where-Object { $_.Name -match 'drums\.(wav|mp3|m4a|flac)$' } | Select-Object -First 1
$q = "?drums=" + (& $U $drum.FullName) + "&notes=" + (& $U (Join-Path $PSScriptRoot "_check\beatmap.json"))
$vid = Join-Path $env:TEMP "icm_video.mp4"; if (Test-Path $vid) { $q += "&video=" + (& $U $vid) }
$out = Join-Path $PSScriptRoot "_check"
$expr = "JSON.stringify({log: document.getElementById('log').textContent, out: window.OUT || null})"
& (Join-Path $PSScriptRoot "cdp_run.ps1") -Url ($page + $q) -Expr $expr -OutFile (Join-Path $out "chart_result.json") -Port 9334
$res = [IO.File]::ReadAllText((Join-Path $out "chart_result.json"), [Text.Encoding]::UTF8) | ConvertFrom-Json
[IO.File]::WriteAllText((Join-Path $out "chart_log.txt"), $res.log, (New-Object Text.UTF8Encoding $false))
if ($res.out) { [IO.File]::WriteAllText((Join-Path $out "chart.json"), ($res.out | ConvertTo-Json -Depth 8 -Compress), (New-Object Text.UTF8Encoding $false)) }
