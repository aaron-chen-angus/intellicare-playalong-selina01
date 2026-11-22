# Headless screenshots of index.html (phone portrait + desktop) and JS error capture -> tools/_check/shot_*.png, shots.log
param([int]$Port = 9344)
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $PSScriptRoot "_check"; New-Item -ItemType Directory -Force $out | Out-Null
$url = ([System.Uri](Join-Path $root "index.html")).AbsoluteUri
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$ud = Join-Path $env:TEMP ("icm_shot_" + $Port)
$proc = Start-Process -FilePath $edge -ArgumentList @("--headless=new", "--disable-gpu", "--no-first-run", "--user-data-dir=$ud", "--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required", "--remote-debugging-port=$Port", "about:blank") -PassThru
$log = @()
try {
  $ws = $null; for ($i = 0; $i -lt 60 -and -not $ws; $i++) { Start-Sleep -Milliseconds 500; try { $t = Invoke-RestMethod "http://127.0.0.1:$Port/json" -TimeoutSec 2; $pg = $t | Where-Object { $_.type -eq 'page' } | Select-Object -First 1; if ($pg) { $ws = $pg.webSocketDebuggerUrl } } catch {} }
  $sock = New-Object System.Net.WebSockets.ClientWebSocket; $sock.Options.SetBuffer(65536, 65536); $sock.ConnectAsync([Uri]$ws, [Threading.CancellationToken]::None).Wait()
  $script:id = 0
  function Cdp($method, $params) {
    $script:id++; $msg = @{ id = $script:id; method = $method; params = $params } | ConvertTo-Json -Depth 8 -Compress
    $b = [Text.Encoding]::UTF8.GetBytes($msg); $sock.SendAsync((New-Object ArraySegment[byte] (, $b)), 'Text', $true, [Threading.CancellationToken]::None).Wait()
    while ($true) { $ms = New-Object IO.MemoryStream; $buf = New-Object byte[] 65536
      do { $r = $sock.ReceiveAsync((New-Object ArraySegment[byte] (, $buf)), [Threading.CancellationToken]::None); $r.Wait(); $ms.Write($buf, 0, $r.Result.Count) } while (-not $r.Result.EndOfMessage)
      $o = [Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json; if ($o.id -eq $script:id) { return $o } } }
  function Eval($e) { (Cdp "Runtime.evaluate" @{ expression = $e; returnByValue = $true; awaitPromise = $true }).result.result.value }
  Cdp "Page.enable" @{} | Out-Null
  Cdp "Page.addScriptToEvaluateOnNewDocument" @{ source = "window.__errs=[];addEventListener('error',e=>__errs.push(String(e.message)+' @'+e.lineno));addEventListener('unhandledrejection',e=>__errs.push('rej '+String(e.reason&&e.reason.stack||e.reason)));const _ce=console.error;console.error=function(){__errs.push('console.error '+[].map.call(arguments,String).join(' '));_ce.apply(console,arguments)};" } | Out-Null
  function Shot($name, $w, $h, $mobile, $setup) {
    Cdp "Emulation.setDeviceMetricsOverride" @{ width = $w; height = $h; deviceScaleFactor = 2; mobile = $mobile } | Out-Null
    Cdp "Page.navigate" @{ url = $url + "?test=0" } | Out-Null; Start-Sleep -Seconds 4
    if ($setup) { Eval $setup | Out-Null; Start-Sleep -Seconds 3 }
    $img = (Cdp "Page.captureScreenshot" @{ format = "png" }).result.data
    [IO.File]::WriteAllBytes((Join-Path $out "shot_$name.png"), [Convert]::FromBase64String($img))
    $script:log += "$name errors: " + (Eval "JSON.stringify(window.__errs)")
  }
  # 1 menu phone; 2 menu desktop; 3 gameplay phone (demo mode, video may not load headless -> simulate)
  Shot "menu_phone" 390 844 $true $null
  Shot "menu_phone360" 360 740 $true $null
  Shot "menu_desktop" 1440 900 $false $null
  # framed pose (second hero image) at every viewport: must not overlap the text panel
  $framed = "(async()=>{MenuFX.next();await new Promise(r=>setTimeout(r,1500));const i=document.querySelector('#hero .gImg.on'),p=document.querySelector('.panel'),a=i.getBoundingClientRect(),b=p.getBoundingClientRect();const ov=!(a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom);window.__ov=JSON.stringify({framed:i.classList.contains('framed'),img:[a.left,a.top,a.right,a.bottom].map(Math.round),panel:[b.left,b.top,b.right,b.bottom].map(Math.round),overlap:ov});return 'ok'})()"
  foreach ($v in @(@('framed_1440', 1440, 900, $false), @('framed_1024', 1024, 768, $false), @('framed_phoneL', 844, 390, $true), @('framed_390', 390, 844, $true))) {
    Shot $v[0] $v[1] $v[2] $v[3] $framed; $script:log += "$($v[0]) geometry: " + (Eval "window.__ov") }
  $burst = "(async()=>{const h=document.getElementById('hero'),r=h.getBoundingClientRect();const ev=(t,x,y)=>h.dispatchEvent(new PointerEvent(t,{clientX:x,clientY:y,bubbles:true}));document.getElementById('menu').dispatchEvent(new PointerEvent('pointermove',{clientX:r.left+r.width*.8,clientY:r.top+r.height*.3,bubbles:true}));ev('pointerdown',r.left+r.width*.5,r.top+r.height*.45);await new Promise(r=>setTimeout(r,250));return 'ok'})()"
  Cdp "Emulation.setDeviceMetricsOverride" @{ width = 390; height = 844; deviceScaleFactor = 2; mobile = $true } | Out-Null
  Cdp "Page.navigate" @{ url = $url } | Out-Null; Start-Sleep -Seconds 4; Eval $burst | Out-Null
  [IO.File]::WriteAllBytes((Join-Path $out "shot_menu_burst.png"), [Convert]::FromBase64String((Cdp "Page.captureScreenshot" @{ format = "png" }).result.data))
  $script:log += "burst errors: " + (Eval "JSON.stringify(window.__errs)") + " pose idx " + (Eval "String(MenuFX.idx)")
  $play = "(async()=>{try{localStorage.setItem('icmpal.v1.activeProfile',JSON.stringify('guest'));}catch(e){} Game.start('demo','fire'); await new Promise(r=>setTimeout(r,2500)); const v=document.getElementById('vid'); try{ if(v.paused){ SongClock.playing=true; SongClock.anchorMedia=30; SongClock.anchorPerf=performance.now(); Game.state='PLAYING'; } }catch(e){} return 'ok'})()"
  Shot "play_phone" 390 844 $true $play
  $script:log += "notes: " + (Eval "JSON.stringify({full:Beatmap.charts.full.length,fire:Beatmap.charts.fire.length,groove:Beatmap.charts.groove.length,gentle:Beatmap.charts.gentle.length,placeholder:Beatmap.placeholder,samples:Object.keys(DrumSynth.buf)})")
  Cdp "Page.navigate" @{ url = $url + "?test=1" } | Out-Null; Start-Sleep -Seconds 5
  $script:log += "tests: " + (Eval "(document.querySelector('pre')||{}).textContent")
} catch { $script:log += "ERR " + $_ } finally {
  $log | Out-File (Join-Path $out "shots.log") -Encoding utf8
  try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
}
