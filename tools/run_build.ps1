# Builds the final beatmap (video time) from tools/_check/beatmap.json (NMF notes) + tools/_check/chart.json (grid / bars / alignment).
# Output: tools/_check/beatmap_final.json and tools/_check/build_log.txt. Then run tools/embed.ps1 -Beatmap tools\_check\beatmap_final.json
# Section list = [bar (1-based, from chart_log.txt), name]. Names are provisional until confirmed by ear in the Editor.
param([string]$Sections = '[[16,"Pickup"],[17,"Verse 1"],[25,"Verse 1b"],[45,"Pre-chorus"],[53,"Chorus 1"],[65,"Chorus 1b"],[73,"Bridge"],[81,"Chorus 2"],[89,"Chorus 2b"],[97,"Final chorus"],[108,"Outro"]]')
$root = Split-Path -Parent $PSScriptRoot
$U = { param($p) [Uri]::EscapeDataString(([System.Uri]$p).AbsoluteUri) }
# song metadata lives in tools/song.json (UTF-8) - Windows PowerShell 5 reads BOM-less .ps1 files as ANSI, so no CJK text in scripts
$song = ([IO.File]::ReadAllText((Join-Path $PSScriptRoot "song.json"), [Text.Encoding]::UTF8)).Trim()
$page = ([System.Uri](Join-Path $root "tools\build_chart.html")).AbsoluteUri
$q = "?notes=" + (& $U (Join-Path $PSScriptRoot "_check\beatmap.json")) + "&grid=" + (& $U (Join-Path $PSScriptRoot "_check\chart.json")) + "&song=" + [Uri]::EscapeDataString($song) + "&sections=" + [Uri]::EscapeDataString($Sections)
$out = Join-Path $PSScriptRoot "_check"
$expr = "JSON.stringify({log: document.getElementById('log').textContent, beatmap: window.BEATMAP || null})"
& (Join-Path $PSScriptRoot "cdp_run.ps1") -Url ($page + $q) -Expr $expr -OutFile (Join-Path $out "build_result.json") -Port 9335
$res = [IO.File]::ReadAllText((Join-Path $out "build_result.json"), [Text.Encoding]::UTF8) | ConvertFrom-Json
$enc = New-Object Text.UTF8Encoding $false
[IO.File]::WriteAllText((Join-Path $out "build_log.txt"), $res.log, $enc)
if ($res.beatmap) { [IO.File]::WriteAllText((Join-Path $out "beatmap_final.json"), ($res.beatmap | ConvertTo-Json -Depth 10 -Compress), $enc) }
