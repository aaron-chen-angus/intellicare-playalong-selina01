# Google Sheet template — intelliCARE Music Play-a-Long · 翎羽悸動 | Fluttering Feathers, Stirring Hearts

Sheet: https://docs.google.com/spreadsheets/d/1gCxx9j6TEdA7MLkhdHx7HqDFLjKJ5d54oXgezMwnmZA
Game: https://aaron-chen-angus.github.io/intellicare-playalong-selina01/ · Backend: `tools/apps_script.gs` (server 1.2.0-s2, `SONG_ID = ling-yu-ji-dong`)

Running `setup()` in `tools/apps_script.gs` creates every tab below (existing tabs and data are kept; newer versions only append columns). You do not need to type anything by hand.

| Tab | Purpose | Public? |
|---|---|---|
| **Dashboard** | Live dashboard inside the Sheet (see below) | Aggregates |
| **Sessions** | Full SessionRecords, only from players who gave remote consent | Private (anonymised copy via `?action=export`) |
| **SectionStats** | Tidy table: one row per run × song section (accuracy per section) | Private (in the export) |
| **PadStats** | Tidy table: one row per run × pad (hit rate, mean/SD timing error) | Private (in the export) |
| **Leaderboard** | One row per accepted submission. Boards are computed from it | Public fields only, via API |
| **Players** | Rate-limit bookkeeping (`dailyCount` = `yyyy-MM-dd|count`, `lastSubmitTs` = epoch ms) | Private |
| **Charts** | `songId, difficulty, noteCount, maxScore`: the score ceiling used for validation | Private |
| **NormsAgg** | Hourly deciles per metric × age band × gender (n ≥ 30) | Aggregates via `?action=norms` |
| **Config** | `currentSeason`, `seasonStart`, `facilitatorPinHash`, `profanityList` | Private |
| **Log** | Rejected submissions and reasons | Private |
| **DashData** | Chart source tables written by `refreshDashboard()`. Do not edit | — |

## Column order

**Sessions:** ts, sessionId, playerId, nickname, age, ageBand, gender, hand, musicExp, mode, songId, difficulty, score, grade, accuracy, maxCombo, fullCombo, perfect, great, good, miss, wrong, stray, meanAsyncMs, sdAsyncMs, R, chordSimulMs, limbIndependence, srtMedian, crtMedian, crtErr, beatsyncSd600, rhythmIndex, coordinationIndex, perPadJSON, confusionJSON, appVersion, userAgent, **stars, maxScore, scorePct, failed, completionPct, heartbeatCount, notesTotal, runNumber, xp, deviceType, os, browser, inputMethod, screen, orientation, lang, tzOffsetMin, localHour, weekday, pad4, noteSpeed, calibrated, deviceLatencyMs, deviceOffsetMs, sectionsJSON, timelineJSON** (bold = new in v1.2)

**SectionStats:** ts, sessionId, ageBand, gender, difficulty, runNumber, sectionIdx, section, notes, accuracy

**PadStats:** ts, sessionId, ageBand, gender, difficulty, runNumber, lane, notes, hits, hitRate, meanErrMs, sdErrMs

**Leaderboard:** ts, sessionId, playerId, nickname, avatarColor, ageBand, gender, showGender (checkbox), songId, difficulty, season, score, accuracy, maxCombo, srtMedian, crtMedian, rhythmIndex, hidden (checkbox)

**Players:** playerId, nickname, firstSeen, lastSeen, sessions, dailyCount, lastSubmitTs · **Charts:** songId, difficulty, noteCount, maxScore · **NormsAgg:** metric, ageBand, gender, n, p10…p90, mean, sd, updated · **Config:** key, value · **Log:** ts, reason, payload

Field notes: `runNumber` = the player's n-th run of this song on that device profile; `completionPct` = share of notes reached before the run ended (100 unless the player failed); `timelineJSON` = accuracy in 10 equal slices of the song; `weekday` 0 = Monday; `localHour` = the player's local clock; `inputMethod` = touch / keyboard / midi / mouse.

## Charts (score ceilings written by `setup()`)

| difficulty | noteCount | maxScore (1200·N − 18000) |
|---|---|---|
| gentle | 356 | 409,200 |
| groove | 816 | 961,200 |
| fire | 1135 | 1,344,000 |

## Validation and formatting applied by `setup()`

- Header rows are frozen, bold, dark background. Age-band columns are text (so "5-12" is not read as a date).
- `Leaderboard.hidden` and `Leaderboard.showGender` have checkbox validation; a hidden row turns light red.

## Facilitator tasks

- **Hide a row:** tick `hidden` on that Leaderboard row. It disappears from boards, dashboards and the export.
- **New season:** change `Config → currentSeason` (e.g. `S2`).
- **Profanity list:** comma-separated, in `Config → profanityList`.

## Dashboards and open data (v1.2)

| Tab / URL | What it shows |
|---|---|
| **Dashboard** (first tab) | 8 KPI tiles; runs per day, difficulty mix, accuracy by age band × gender, reaction time by age band, Rhythm & Coordination Index, accuracy distribution, hit rate per pad, timing by age band; **accuracy by song section, accuracy across the song, learning curve, early/late per pad, completion by difficulty, device and input mix**; top-10, weekday × 3-hour heat-map, pad confusion matrix. Refreshed every 10 min or via **🎵 intelliCARE → Refresh dashboard now** |
| `<exec>?action=dashboard` | Live, filterable web dashboard (period, difficulty, age band, gender) with all of the above plus OS mix and 4 extra KPIs (returning players, runs per player, completion rate, full combos). Auto-refreshes every 60 s; ⤓ CSV and { } JSON buttons |
| `<exec>?action=export` | Anonymised CSV, one row per consented run (68+ flat columns incl. per-pad hit rate/timing, 10 timeline slices, one column per song section) |
| `<exec>?action=export&kind=tests` | Anonymised CSV of Reflex and Beat-Sync tests |
| `<exec>?action=stats[&period=d7|d30|today&difficulty=…&ageBand=…&gender=…]` | JSON of every dashboard aggregate |

Privacy: exports contain no nicknames, exact ages or user agents; `playerKey` is a salted SHA-256 hash (salt kept in Script Properties), stable across exports but not reversible. Hidden rows are excluded. Small cohorts (e.g. one 80+ player) can still be recognisable, so share exports with that in mind.
