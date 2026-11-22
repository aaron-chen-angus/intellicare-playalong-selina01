# Runs index.html?test=1 in headless Edge and writes the PASS/FAIL list to tools/_check/tests.txt
$root = Split-Path -Parent $PSScriptRoot
$url = ([System.Uri](Join-Path $root "index.html")).AbsoluteUri + "?test=1&cdp=1"
$out = Join-Path $PSScriptRoot "_check"; New-Item -ItemType Directory -Force $out | Out-Null
$expr = "JSON.stringify({tests: window.TEST_OUT || null, errors: (window.__errs || []), title: document.title})"
& (Join-Path $PSScriptRoot "cdp_run.ps1") -Url $url -Expr $expr -OutFile (Join-Path $out "tests.json") -TimeoutSec 120 -Port 9336
$r = [IO.File]::ReadAllText((Join-Path $out "tests.json"), [Text.Encoding]::UTF8) | ConvertFrom-Json
$lines = @()
if ($r.tests) { $lines += $r.tests; $f = @($r.tests | Where-Object { $_ -like 'FAIL*' }).Count; $lines += ""; $lines += "$($r.tests.Count) tests, $f failed" } else { $lines += "no test output (title: $($r.title))" }
if ($r.errors) { $lines += "page errors:"; $lines += $r.errors }
[IO.File]::WriteAllText((Join-Path $out "tests.txt"), ($lines -join "`r`n"), (New-Object Text.UTF8Encoding $false))
