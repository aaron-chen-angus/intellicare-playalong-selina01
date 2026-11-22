# Builds tools/_check/samples.json: base64 of the five drum samples in sounds/ (inlined into index.html by tools/embed.ps1).
# Only needed if you replace the samples in sounds/ - the shipped index.html already contains them.
# Stage images are made by tools/stage_images.ps1.
$root = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot "_check") | Out-Null
$lines = @()
foreach ($p in @(@('kick','KICK.mp3'),@('snare','SNARE.mp3'),@('hihat','HI-HAT.mp3'),@('tom','TOM.mp3'),@('cymbal','CYMBAL.mp3'))) {
  $b = [IO.File]::ReadAllBytes((Join-Path $root ("sounds\" + $p[1])))
  $lines += ('"' + $p[0] + '":"' + [Convert]::ToBase64String($b) + '"')
}
$json = '{' + ($lines -join ',') + '}'
[IO.File]::WriteAllText((Join-Path $PSScriptRoot "_check\samples.json"), $json)
"samples json: $([math]::Round($json.Length/1KB)) KB"
