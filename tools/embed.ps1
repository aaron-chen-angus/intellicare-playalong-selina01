# Embeds a beatmap (and optionally tools/_check/samples.json) inline into index.html.
#   powershell -ExecutionPolicy Bypass -File tools\embed.ps1                                   # raw analyze.html output: crosstalk clean-up, then embed
#   powershell -ExecutionPolicy Bypass -File tools\embed.ps1 -Beatmap tools\_check\beatmap_final.json   # already cleaned by build_chart.html: embed as-is
# The inline drum samples are only replaced when tools/_check/samples.json exists (tools/prep_assets.ps1).
param([string]$Beatmap = "")
$root = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding $false
$idx = Join-Path $root "index.html"
$html = [IO.File]::ReadAllText($idx, $utf8)
if (-not $Beatmap) { $Beatmap = Join-Path $PSScriptRoot "_check\beatmap.json" } elseif (-not [IO.Path]::IsPathRooted($Beatmap)) { $Beatmap = Join-Path $root $Beatmap }
$bm = [IO.File]::ReadAllText($Beatmap, $utf8) | ConvertFrom-Json
if (-not ($bm.meta -and $bm.meta.qa)) {
  # legacy path: clean the raw NMF output
  $notes = @($bm.charts.full)
  $kicks = @($notes | Where-Object { $_.l -eq 'kick' } | ForEach-Object { [double]$_.t })
  $snares = @($notes | Where-Object { $_.l -eq 'snare' } | ForEach-Object { [double]$_.t })
  $hats = @($notes | Where-Object { $_.l -eq 'hihat' } | ForEach-Object { [double]$_.t })
  $downs = @($bm.downbeats | ForEach-Object { [double]$_ })
  function Near($arr, $t, $w) { foreach ($x in $arr) { if ([math]::Abs($x - $t) -le $w) { return $true } } return $false }
  $clean = @($notes | Where-Object {
    if ($_.l -eq 'tom') { -not (Near $kicks ([double]$_.t) 0.045) }
    elseif ($_.l -eq 'cymbal') { $t = [double]$_.t; (Near $downs $t 0.06) -or -not ((Near $hats $t 0.05) -or (Near $snares $t 0.05)) }
    else { $true } })
  $bm.charts.full = $clean
  $bm.meta | Add-Member -NotePropertyName postprocess -NotePropertyValue "tom within 45 ms of kick removed; cymbal within 50 ms of hi-hat/snare removed unless on a downbeat" -Force
  "legacy clean-up: $($notes.Count) -> $($clean.Count) notes"
} else { "embedding cleaned beatmap: full=$(@($bm.charts.full).Count) fire=$(@($bm.charts.fire).Count) groove=$(@($bm.charts.groove).Count) gentle=$(@($bm.charts.gentle).Count)" }
$json = ($bm | ConvertTo-Json -Depth 10 -Compress).Replace('</', '<\/')
$re = New-Object System.Text.RegularExpressions.Regex '(<script type="application/json" id="beatmap">)(.*?)(</script>)', 'Singleline'
if (-not $re.IsMatch($html)) { throw "beatmap <script> block not found in index.html" }
$html = $re.Replace($html, { param($m) $m.Groups[1].Value + "`n" + $json + "`n" + $m.Groups[3].Value }, 1)
$sj = Join-Path $PSScriptRoot "_check\samples.json"
if (Test-Path $sj) { $samples = [IO.File]::ReadAllText($sj, $utf8)
  $re2 = New-Object System.Text.RegularExpressions.Regex '(<script type="application/json" id="drumSamples">)(.*?)(</script>)', 'Singleline'
  $html = $re2.Replace($html, { param($m) $m.Groups[1].Value + $samples + $m.Groups[3].Value }, 1); "samples replaced" }
[IO.File]::WriteAllText($idx, $html, $utf8)
"index.html size: $([math]::Round((Get-Item $idx).Length/1KB)) KB"
