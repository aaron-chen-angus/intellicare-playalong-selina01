# Builds selina01_github.zip at the project root: exactly the files that belong in the GitHub repo.
# Unzip it somewhere with a short path (e.g. Desktop) and drag its CONTENTS onto the GitHub "Add file > Upload files" page,
# or copy them into a GitHub Desktop clone. Also runs release checks -> tools/_check/release.txt
# (A zip is used instead of a staging folder because this project's path is close to the Windows 260-character limit.)
$root = Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zipPath = Join-Path $root "selina01_github.zip"
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
$list = @("index.html", "README.md", ".gitignore", ".nojekyll", "assets\stage\selina-hero.png", "assets\stage\selina-frame.png", "assets\stage\selina-portrait.png")
$list += Get-ChildItem (Join-Path $root "sounds") -Filter *.mp3 | ForEach-Object { "sounds\" + $_.Name }
$list += Get-ChildItem (Join-Path $root "tools") -File | Where-Object { $_.Name -notmatch '^_' } | ForEach-Object { "tools\" + $_.Name }
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
$rep = @(); $total = 0
try { foreach ($rel in $list) { $src = Join-Path $root $rel; if (-not (Test-Path -LiteralPath $src)) { $rep += "MISSING SOURCE: $rel"; continue }
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $src, $rel.Replace('\', '/'), 'Optimal'); $len = (Get-Item -LiteralPath $src).Length; $total += $len
    $rep += ("{0,10:N0}  {1}" -f $len, $rel) } } finally { $zip.Dispose() }
$rep = @("zip: $zipPath", "files: $($list.Count), uncompressed $([math]::Round($total / 1MB, 2)) MB, zip $([math]::Round((Get-Item $zipPath).Length / 1MB, 2)) MB") + $rep
# ---- checks ----
$zh1 = [string]::new([char[]]@(0x5FC3,0x8DF3,0x7684,0x82B1,0x857E)); $ar1 = [string]::new([char[]]@(0x5218,0x5609,0x610F))
$pat = "Grace|$ar1|$zh1|Buds of a Heartbeat|buds-of-a-heartbeat"; $hits = 0
foreach ($rel in $list | Where-Object { $_ -match '\.(html|md|ps1|gs|json|ipynb)$' -and $_ -notmatch 'make_upload' }) {
  $t = [IO.File]::ReadAllText((Join-Path $root $rel), [Text.Encoding]::UTF8)
  if ($rel -eq 'index.html') { $t = [regex]::Replace($t, '/\*OTHER_SONGS:begin\*/[\s\S]*?/\*OTHER_SONGS:end\*/', '') }
  if ($rel -eq 'README.md') { $t = [regex]::Replace($t, '## Appendix F[\s\S]*$', '') }
  foreach ($m in [regex]::Matches($t, $pat, 'IgnoreCase')) { $hits++; $rep += "SONG-1 STRING in ${rel}: '$($m.Value)' at $($m.Index)" } }
$rep += "Song 1 strings outside OTHER_SONGS / changelog: $hits"
$idx = [IO.File]::ReadAllText((Join-Path $root "index.html"), [Text.Encoding]::UTF8)
$ep = [regex]::Match($idx, "SHEETS_ENDPOINT:\s*'([^']*)'").Groups[1].Value
$rep += "SHEETS_ENDPOINT: $ep" + $(if ($ep -match '^__') { "  (PLACEHOLDER - local-only)" } else { "" })
$gs = [IO.File]::ReadAllText((Join-Path $root "tools\apps_script.gs"), [Text.Encoding]::UTF8)
$rep += "apps_script SHEET_ID: " + [regex]::Match($gs, "SHEET_ID = '([^']*)'").Groups[1].Value + " | GAME_URL: " + [regex]::Match($gs, "GAME_URL = '([^']*)'").Groups[1].Value
$rep += "index.html size: $([math]::Round((Get-Item (Join-Path $root 'index.html')).Length / 1KB)) KB (limit 650 KB)"
foreach ($img in [regex]::Matches($idx, "assets/stage/[A-Za-z0-9._-]+\.png") | ForEach-Object { $_.Value } | Sort-Object -Unique) { $rep += "referenced ${img}: " + $(if ($list -contains $img.Replace('/', '\')) { "in zip" } else { "NOT IN ZIP" }) }
New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot "_check") | Out-Null
[IO.File]::WriteAllText((Join-Path $PSScriptRoot "_check\release.txt"), ($rep -join "`r`n"), (New-Object Text.UTF8Encoding $false))
