# Read-only smoke test of the deployed Apps Script backend (no data is written).
# Output: tools/_check/backend.txt
param([string]$Exec = "")
$root = Split-Path -Parent $PSScriptRoot
if (-not $Exec) { $m = [regex]::Match([IO.File]::ReadAllText((Join-Path $root "index.html"), [Text.Encoding]::UTF8), "SHEETS_ENDPOINT:\s*'([^']+)'"); $Exec = $m.Groups[1].Value }
$out = @("endpoint: $Exec")
$ProgressPreference = 'SilentlyContinue'
foreach ($q in @("", "?action=leaderboard&board=score&song=ling-yu-ji-dong&difficulty=groove&period=all", "?action=norms&metric=srtMedian", "?action=stats")) {
  try { $r = Invoke-WebRequest -Uri ($Exec + $q) -UseBasicParsing -TimeoutSec 60 -MaximumRedirection 5
        $body = $r.Content; if ($body.Length -gt 600) { $body = $body.Substring(0, 600) + " ..." }
        $out += "GET $q -> HTTP $($r.StatusCode)  $body" }
  catch { $out += "GET $q -> ERROR $($_.Exception.Message)" } }
try { $r = Invoke-WebRequest -Uri ($Exec + "?action=dashboard") -UseBasicParsing -TimeoutSec 60; $out += "GET ?action=dashboard -> HTTP $($r.StatusCode), $($r.Content.Length) bytes, has title: $($r.Content -match 'Live Dashboard')" } catch { $out += "GET ?action=dashboard -> ERROR $($_.Exception.Message)" }
try { $r = Invoke-WebRequest -Uri ($Exec + "?action=export") -UseBasicParsing -TimeoutSec 60; $c = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()); $out += "GET ?action=export -> HTTP $($r.StatusCode), first line: " + ($c -split "`n")[0].Substring(0, [Math]::Min(200, ($c -split "`n")[0].Length)) } catch { $out += "GET ?action=export -> ERROR $($_.Exception.Message)" }
[IO.File]::WriteAllText((Join-Path $PSScriptRoot "_check\backend.txt"), ($out -join "`r`n"), (New-Object Text.UTF8Encoding $false))
