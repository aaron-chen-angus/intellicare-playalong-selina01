# tools/ — chart generation, checks and backend (Song 2 · 翎羽悸動 | Fluttering Feathers, Stirring Hearts)

Everything runs on a Windows PC with PowerShell + Microsoft Edge (headless). Nothing to install.
Run any script with `powershell -ExecutionPolicy Bypass -File tools\<script>.ps1`. Outputs go to `tools/_check/` (git-ignored).

| File | Purpose |
|---|---|
| `song.json` | Song metadata (title, artist, video URL, duration) used by the chart tools — one place per song |
| `analyze.html` + `run_analyze.ps1` | Drum stem (`sounds/*drums.wav|mp3|m4a|flac`) → template NMF with the 5 kit samples → raw notes. `-WithVideo` also decodes the video (`%TEMP%\icm_video.mp4`) for alignment |
| `chart.html` + `run_chart.ps1` | Tempo grid (circular-resultant fit), 4/4 downbeat test (kick on 1 & 3, snare on 2 & 4), **piecewise** stem→video alignment (20 s windows), and a 16-step pattern line for every bar → `_check/chart_log.txt` |
| `build_chart.html` + `run_build.ps1` | Snaps notes to a locally-corrected 16th grid, removes crosstalk, builds gentle / groove / fire, writes all times in video time → `_check/beatmap_final.json` + `build_log.txt` (QA). Section names are a parameter |
| `embed.ps1` | Pastes a beatmap (and optionally `samples.json`) into `index.html`: `embed.ps1 -Beatmap tools\_check\beatmap_final.json` |
| `sync_check.html` + `run_sync.ps1` | Independent check: finds kick onsets in the **video soundtrack** and measures the chart error at 5 spots (target mean |error| < 30 ms) |
| `run_tests.ps1` | Runs `index.html?test=1` headlessly → `_check/tests.txt` |
| `shots.ps1` | Screenshots (phone 360/390, landscape phone, 1024, 1440; framed pose overlap check) + JS error capture → `_check/shots.log` |
| `stage_images.ps1` | Hi-res cut-outs in `assets/src/` → `assets/stage/` (hero 640 px, framed pose 512 px, avatar 320×320) |
| `prep_assets.ps1` | Base64 of the 5 drum samples → `_check/samples.json` (only if the samples change) |
| `apps_script.gs` | Google Apps Script backend: API, Sheet Dashboard tab, web dashboard, anonymised exports |
| `sheets_template.md` | Tab / column reference for the Google Sheet |
| `ping_backend.ps1` | Read-only smoke test of the deployed Web App → `_check/backend.txt` |
| `gs_check.html` | Parses `apps_script.gs` and runs it against a mocked Sheet (syntax + aggregates + export privacy) |
| `cdp_run.ps1` | Helper: open a page in headless Edge, wait for `document.title = DONE`, return a JS expression |
| `beatmap_pipeline.ipynb` | Colab fallback (Demucs separation + ADTOF) when no isolated drum stem exists; cell 8 makes a 720p web copy of the video |

## Song 2 chart, as shipped

`run_analyze.ps1 -WithVideo` → `run_chart.ps1` → `run_build.ps1` → `embed.ps1 -Beatmap tools\_check\beatmap_final.json` → `run_tests.ps1` → `run_sync.ps1`

- 124.06 BPM, 4/4; drums enter at bar 16 (≈ 31.4 s video time); bridge (bars 73–80) is half-time: kick on 1, the "and" of 2 and of 4.
- Alignment: video time = stem time − 0.537 s (30 windows agree within 2 ms) → notes are stored in video time, `offsetMs = 0`.
- Notes: gentle 356 · groove 816 · fire 1135 (maxScore 409,200 · 961,200 · 1,344,000). No tom notes: the tom template only shadowed the kick.
- Sync check against the video soundtrack: mean |error| 13.8 ms over 5 spots.

## Editing the chart by ear

Open the app with `?editor=1` → **Chart Editor**. **Off −1 / +1** nudges the whole chart; tap to add, drag to move, **Del** to remove; **＋Section** renames the section at the playhead; **♥ Bud** flags Plume notes. Press **Generate** (shows note counts + maxScore → copy into the Sheet's **Charts** tab), then **Copy inline** and replace the `<script id="beatmap">` block in `index.html`. Drafts autosave in the browser (`icmpal.v1.chart.ling-yu-ji-dong`).

## Another song

Put the drum stem in `sounds/` as `<title>drums.wav`, edit `tools/song.json`, then run the chain above; read `_check/chart_log.txt` to choose section bars and pass them to `run_build.ps1 -Sections '[[bar,"Name"],…]'`. Update `Config` in `index.html` (song, `SONG_ID`, hero images, `OTHER_SONGS`) and the constants at the top of `apps_script.gs`.

## Video buffering

The master MP4 is 487 MB (18 Mbit/s); `moov` is already at the front. Phones stall because the bitrate is higher than a typical connection, and browsers do not keep a full copy of a file that large. Make a 720p web copy (HandBrake preset "Fast 720p30" + "Web Optimized", or notebook cell 8; ≈ 100 MB), upload it next to the master and set `Config.VIDEO_WEB`. If the CloudFront bucket also sends `Access-Control-Allow-Origin: *`, players can use Settings → **Save video to this device** for completely stutter-free play.
