/**
 * intelliCARE Music Play-a-Long — Google Apps Script backend + dashboards
 * ======================================================================
 * Song: 翎羽悸動 | Fluttering Feathers, Stirring Hearts — performed by Selina Goh 吴宛颖
 * Game:  https://aaron-chen-angus.github.io/intellicare-playalong-selina01/
 * Sheet: https://docs.google.com/spreadsheets/d/1gCxx9j6TEdA7MLkhdHx7HqDFLjKJ5d54oXgezMwnmZA
 *
 * What this script gives you
 *   1. A JSON API for the game (live leaderboard, score submission, cohort norms).
 *   2. A "Dashboard" tab inside the Sheet: KPI tiles, 15 charts, top-10 table, activity heat-map,
 *      pad confusion matrix. Refreshed automatically every 10 minutes (and via the menu).
 *   3. A live, filterable web dashboard at  <your /exec URL>?action=dashboard
 *      (engagement, difficulty, age/gender, reaction time, rhythm, per-pad timing, song sections,
 *       song timeline, learning curve, completion, devices & input, top-10, heat-map, confusion matrix).
 *   4. Analysis-ready data: tidy tabs SectionStats + PadStats (one row per run × section / pad), and
 *      public anonymised exports  <exec>?action=export  (CSV, one row per run, hashed player id, no names/ages)
 *      and  <exec>?action=stats  (JSON of every dashboard aggregate) — for Excel, R, Python, Power BI, Tableau …
 *
 * SET-UP (once)
 *   1. Open the Sheet → Extensions → Apps Script. Delete any code, paste this whole file, Save.
 *   2. In the toolbar choose the function  setup  → Run → allow the permissions.
 *   3. Deploy → New deployment → ⚙ type "Web app" → Execute as: Me · Who has access: Anyone → Deploy.
 *   4. Copy the Web app URL (ends with /exec) and give it to the game (Config.SHEETS_ENDPOINT).
 *   After later edits: Deploy → Manage deployments → ✎ → Version: New version → Deploy (URL stays the same).
 */

// ------------------------------------------------------------------ constants
const SHEET_ID = '1gCxx9j6TEdA7MLkhdHx7HqDFLjKJ5d54oXgezMwnmZA';
const SERVER_VERSION = '1.2.0-s2';
const GAME_URL = 'https://aaron-chen-angus.github.io/intellicare-playalong-selina01/';
const SONG_ID = 'ling-yu-ji-dong';
const SONG_TITLE = '翎羽悸動 | Fluttering Feathers, Stirring Hearts', SONG_ARTIST = 'Selina Goh 吴宛颖';
const TABS = {
  Sessions: ['ts','sessionId','playerId','nickname','age','ageBand','gender','hand','musicExp','mode','songId','difficulty',
    'score','grade','accuracy','maxCombo','fullCombo','perfect','great','good','miss','wrong','stray',
    'meanAsyncMs','sdAsyncMs','R','chordSimulMs','limbIndependence','srtMedian','crtMedian','crtErr',
    'beatsyncSd600','rhythmIndex','coordinationIndex','perPadJSON','confusionJSON','appVersion','userAgent',
    // v1.2 research extras (appended — older columns never move)
    'stars','maxScore','scorePct','failed','completionPct','heartbeatCount','notesTotal','runNumber','xp',
    'deviceType','os','browser','inputMethod','screen','orientation','lang','tzOffsetMin','localHour','weekday',
    'pad4','noteSpeed','calibrated','deviceLatencyMs','deviceOffsetMs','sectionsJSON','timelineJSON'],
  // tidy (long-format) tables: one row per run × song section, and per run × pad — ready for pivot tables / R / Python
  SectionStats: ['ts','sessionId','ageBand','gender','difficulty','runNumber','sectionIdx','section','notes','accuracy'],
  PadStats: ['ts','sessionId','ageBand','gender','difficulty','runNumber','lane','notes','hits','hitRate','meanErrMs','sdErrMs'],
  Leaderboard: ['ts','sessionId','playerId','nickname','avatarColor','ageBand','gender','showGender','songId','difficulty',
    'season','score','accuracy','maxCombo','srtMedian','crtMedian','rhythmIndex','hidden'],
  Players: ['playerId','nickname','firstSeen','lastSeen','sessions','dailyCount','lastSubmitTs'],
  Charts: ['songId','difficulty','noteCount','maxScore'],
  NormsAgg: ['metric','ageBand','gender','n','p10','p20','p30','p40','p50','p60','p70','p80','p90','mean','sd','updated'],
  Config: ['key','value'],
  Log: ['ts','reason','payload']
};
const AGE_BANDS = ['5-12','13-17','18-29','30-39','40-49','50-59','60-69','70-79','80+'];
const LANES = ['kick','snare','hihat','tom','cymbal'];
const LANE_NAMES = { kick: 'Kick', snare: 'Snare', hihat: 'Hi-hat', tom: 'Tom', cymbal: 'Cymbal' };
const SONG_DIFFS = { gentle: 1, groove: 1, fire: 1 };
const BOARDS = { score: ['score', false], accuracy: ['accuracy', false], combo: ['maxCombo', false],
                 srt: ['srtMedian', true], crt: ['crtMedian', true], rhythm: ['rhythmIndex', false] };
const NORM_METRICS = { srt: 'srtMedian', crt: 'crtMedian', beatsync: 'beatsyncSd600', rhythm: 'rhythmIndex', coordination: 'coordinationIndex' };
// maxScore = full combo, all PERFECT, no Heartbeat = 1200·N − 18000 for N ≥ 30 notes (the server allows 2× for Heartbeat Mode)
const CHART_DEFAULTS = [['gentle', 356, 409200], ['groove', 816, 961200], ['fire', 1135, 1344000]];
const DEFAULT_MAX_SCORE = 5000000, RATE_SECONDS = 20, RATE_PER_DAY = 60;
const THEME = { bg: '#0B0A18', tile: '#1A1636', ink: '#FFFFFF', dim: '#A9A3CF', pink: '#FF5FA2', lilac: '#C9A7FF', chrome: '#D9DEE8', blue: '#3D8BFF',
  lanes: ['#FF7A1A', '#FF3B5C', '#FFD23F', '#3D8BFF', '#2EE6A6'] };

const SS_ = () => SpreadsheetApp.openById(SHEET_ID);
const json_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
const isTrue_ = v => v === true || String(v).toLowerCase() === 'true';

// ------------------------------------------------------------------ menu
function onOpen() {
  SpreadsheetApp.getUi().createMenu('🎵 intelliCARE')
    .addItem('Refresh dashboard now', 'refreshDashboard')
    .addItem('Rebuild dashboard layout', 'buildDashboard')
    .addItem('Open live web dashboard', 'showWebDashboardLink')
    .addSeparator().addItem('Run setup (safe to re-run)', 'setup').addToUi();
}
function showWebDashboardLink() {
  const url = ScriptApp.getService().getUrl();
  const html = url ? '<p style="font-family:sans-serif">Live dashboard:<br><a target="_blank" href="' + url + '?action=dashboard">' + url + '?action=dashboard</a></p>'
                   : '<p style="font-family:sans-serif">Deploy the script as a Web app first (Deploy → New deployment).</p>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(520).setHeight(140), 'intelliCARE dashboard');
}

// ------------------------------------------------------------------ setup
/** Run once from the editor. Safe to re-run: never deletes data. */
function setup() {
  const ss = SS_();
  Object.keys(TABS).forEach(name => {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name), head = TABS[name];
    // header row: written on first run, and extended in place when a newer version appends columns (data never moves)
    const cur = sh.getLastRow() ? sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0] : [];
    if (sh.getLastRow() === 0 || head.some((h, i) => cur[i] !== h && (cur[i] === '' || cur[i] === undefined))) { if (sh.getMaxColumns() < head.length) sh.insertColumnsAfter(sh.getMaxColumns(), head.length - sh.getMaxColumns()); sh.getRange(1, 1, 1, head.length).setValues([head]); }
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#12102A').setFontColor('#ffffff');
  });
  // age bands must stay text ("5-12" would otherwise become 12 May)
  ss.getSheetByName('Leaderboard').getRange('F:F').setNumberFormat('@');
  ss.getSheetByName('Sessions').getRange('F:F').setNumberFormat('@');
  ss.getSheetByName('NormsAgg').getRange('B:B').setNumberFormat('@');
  ss.getSheetByName('SectionStats').getRange('C:C').setNumberFormat('@'); ss.getSheetByName('PadStats').getRange('C:C').setNumberFormat('@');
  // Leaderboard: checkbox columns (validation only, so appendRow keeps writing right after the last real row)
  const lb = ss.getSheetByName('Leaderboard'), cb = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  const hc = TABS.Leaderboard.indexOf('hidden') + 1, gc = TABS.Leaderboard.indexOf('showGender') + 1;
  lb.getRange(2, hc, lb.getMaxRows() - 1, 1).setDataValidation(cb);
  lb.getRange(2, gc, lb.getMaxRows() - 1, 1).setDataValidation(cb);
  repairEmptyRows_(lb);
  lb.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$R2=TRUE')
    .setBackground('#f4c7c3').setRanges([lb.getRange('A2:R')]).build()]);
  // Config defaults
  const cfg = ss.getSheetByName('Config');
  const have = cfg.getLastRow() > 1 ? cfg.getRange(2, 1, cfg.getLastRow() - 1, 1).getValues().map(r => r[0]) : [];
  [['currentSeason', 'S1'], ['seasonStart', Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd')],
   ['facilitatorPinHash', ''], ['profanityList', 'fuck,shit,bitch,cunt,dick,asshole,bastard,slut,nigger,fag']]
    .forEach(kv => { if (have.indexOf(kv[0]) < 0) cfg.appendRow(kv); });
  // Charts: score ceilings for the shipped chart
  const ch = ss.getSheetByName('Charts'); const rows = ch.getLastRow() > 1 ? ch.getRange(2, 1, ch.getLastRow() - 1, 4).getValues() : [];
  CHART_DEFAULTS.forEach(d => { const i = rows.findIndex(r => r[0] === SONG_ID && r[1] === d[0]);
    if (i < 0) ch.appendRow([SONG_ID, d[0], d[1], d[2]]); else if (!(Number(rows[i][3]) > 0) || Number(rows[i][3]) === DEFAULT_MAX_SCORE) ch.getRange(i + 2, 3, 1, 2).setValues([[d[1], d[2]]]); });
  // triggers
  ScriptApp.getProjectTriggers().filter(t => ['hourlyNorms', 'refreshDashboard'].indexOf(t.getHandlerFunction()) >= 0).forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('hourlyNorms').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('refreshDashboard').timeBased().everyMinutes(10).create();
  const pr = PropertiesService.getScriptProperties(); if (!pr.getProperty('version')) pr.setProperty('version', '0');
  buildDashboard();
  Logger.log('Setup complete.');
}
/** clears rows below the last real entry (e.g. pre-filled FALSE checkboxes from older versions) */
function repairEmptyRows_(sh) {
  const n = sh.getLastRow(); if (n < 2) return;
  const ids = sh.getRange(2, 2, n - 1, 1).getValues(); let last = 1;
  ids.forEach((r, i) => { if (String(r[0]).trim()) last = i + 2; });
  if (n > last) sh.getRange(last + 1, 1, n - last, sh.getLastColumn()).clearContent();
}

// ------------------------------------------------------------------ helpers
function table_(name) {
  const sh = SS_().getSheetByName(name);
  if (!sh) throw 'Missing tab ' + name + ' (run setup())';
  const v = sh.getDataRange().getValues(), head = v[0] || TABS[name];
  const rows = v.slice(1).map(r => { const o = {}; head.forEach((h, i) => o[h] = r[i]);
    if (o.ageBand instanceof Date) o.ageBand = (o.ageBand.getMonth() + 1) + '-' + o.ageBand.getDate(); // legacy auto-dates
    return o; });
  return { sh: sh, head: head, rows: rows };
}
function cfg_(key) { const r = table_('Config').rows.filter(x => x.key === key)[0]; return r ? String(r.value) : ''; }
function ver_() { return Number(PropertiesService.getScriptProperties().getProperty('version') || 0); }
function bumpVersion_() { PropertiesService.getScriptProperties().setProperty('version', String(ver_() + 1)); }
function log_(body, reason) { try { SS_().getSheetByName('Log').appendRow([new Date(), String(reason), JSON.stringify(body).slice(0, 2000)]); } catch (e) {} }
const num_ = (v, lo, hi, d) => { v = Number(v); if (!isFinite(v)) return d; return Math.min(hi, Math.max(lo, v)); };
const str_ = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
const median_ = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean_ = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const r1_ = v => v == null || !isFinite(v) ? null : Math.round(v * 10) / 10;
function cleanNick_(n) {
  n = str_(n, 16); if (n.length < 2) return null;
  const bad = cfg_('profanityList').split(',').map(s => s.trim().toLowerCase()).filter(Boolean), low = n.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const b of bad) if (low.indexOf(b) >= 0) return null; return n;
}

// ------------------------------------------------------------------ validation + writes
function validate_(e) {
  if (!e || typeof e !== 'object') return { ok: false, reason: 'no entry' };
  const nick = cleanNick_(e.nickname); if (!nick) return { ok: false, reason: 'bad nickname' };
  const sid = str_(e.sessionId, 64), pid = str_(e.playerId, 64); if (sid.length < 8 || pid.length < 8) return { ok: false, reason: 'bad ids' };
  const out = {
    ts: new Date(), sessionId: sid, playerId: pid, nickname: nick,
    avatarColor: /^#[0-9a-fA-F]{6}$/.test(e.avatarColor) ? e.avatarColor : '#3D8BFF',
    ageBand: AGE_BANDS.indexOf(e.ageBand) >= 0 ? e.ageBand : '', gender: ['M', 'F', 'O', 'NA'].indexOf(e.gender) >= 0 ? e.gender : 'NA',
    showGender: e.showGender === true, songId: str_(e.songId || SONG_ID, 64),
    difficulty: ['gentle', 'groove', 'fire', 'reflex', 'beatsync'].indexOf(e.difficulty) >= 0 ? e.difficulty : '', season: cfg_('currentSeason'),
    score: num_(e.score, 0, 1e9, 0), accuracy: num_(e.accuracy, 0, 100, 0), maxCombo: num_(e.maxCombo, 0, 100000, 0),
    srtMedian: num_(e.srtMedian, 0, 3000, 0), crtMedian: num_(e.crtMedian, 0, 4000, 0), rhythmIndex: num_(e.rhythmIndex, 0, 100, 0)
  };
  if (out.srtMedian && out.srtMedian < 100) return { ok: false, reason: 'srt out of range' };
  if (out.crtMedian && out.crtMedian < 150) return { ok: false, reason: 'crt out of range' };
  if (out.score > 0) { const row = table_('Charts').rows.filter(r => r.songId === out.songId && r.difficulty === out.difficulty)[0];
    const max = row && Number(row.maxScore) > 0 ? Number(row.maxScore) : DEFAULT_MAX_SCORE; if (out.score > max * 2) return { ok: false, reason: 'score exceeds chart maximum' }; }
  const pl = table_('Players'), idx = pl.rows.findIndex(r => r.playerId === pid), now = new Date(), today = Utilities.formatDate(now, SS_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  if (idx >= 0) { const r = pl.rows[idx]; if (now.getTime() - (Number(r.lastSubmitTs) || 0) < RATE_SECONDS * 1000) return { ok: false, reason: 'rate limit (20 s)' };
    const cnt = String(r.dailyCount).indexOf(today) === 0 ? Number(String(r.dailyCount).split('|')[1]) || 0 : 0; if (cnt >= RATE_PER_DAY) return { ok: false, reason: 'daily limit' }; }
  out._today = today; return { ok: true, entry: out };
}
function touchPlayer_(en) {
  const t = table_('Players'), idx = t.rows.findIndex(r => r.playerId === en.playerId), now = new Date();
  if (idx < 0) t.sh.appendRow([en.playerId, en.nickname, now, now, 1, en._today + '|1', now.getTime()]);
  else { const r = t.rows[idx], cnt = (String(r.dailyCount).indexOf(en._today) === 0 ? Number(String(r.dailyCount).split('|')[1]) || 0 : 0) + 1;
    t.sh.getRange(idx + 2, 2, 1, 6).setValues([[en.nickname, r.firstSeen, now, (Number(r.sessions) || 0) + 1, en._today + '|' + cnt, now.getTime()]]); }
}
function seen_(sid) { const sh = SS_().getSheetByName('Leaderboard'); if (sh.getLastRow() < 2) return false; return sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues().some(r => r[0] === sid); }
function append_(name, obj) { SS_().getSheetByName(name).appendRow(TABS[name].map(h => obj[h] === undefined ? '' : obj[h])); }
function appendSession_(r) {
  if (!r || typeof r !== 'object') return;
  const c = r.counts || {}, t = r.timing || {}, co = r.coordination || {}, rf = r.reflex || {}, bs = r.beatsync || {};
  const dv = r.device || {}, st = r.settings || {}, pl = r.player || {};
  const secs = (Array.isArray(r.sections) ? r.sections : []).slice(0, 40).map(s => ({ i: num_(s.i, 0, 99, 0), name: str_(s.name, 24), n: num_(s.n, 0, 1e5, 0), acc: s.acc == null ? null : num_(s.acc, 0, 100, null) }));
  const tl = (Array.isArray(r.timeline) ? r.timeline : []).slice(0, 10).map(v => v == null ? null : num_(v, 0, 100, null));
  append_('Sessions', { ts: new Date(), sessionId: str_(r.sessionId, 64), playerId: str_(r.playerId, 64), nickname: str_(r.nickname, 16),
    age: num_(r.age, 0, 120, ''), ageBand: AGE_BANDS.indexOf(r.ageBand) >= 0 ? r.ageBand : '', gender: str_(r.gender, 3), hand: str_(r.hand, 2), musicExp: str_(r.musicExp, 6),
    mode: str_(r.mode, 10), songId: str_(r.songId, 64), difficulty: str_(r.difficulty, 10), score: num_(r.score, 0, 1e9, 0), grade: str_(r.grade, 2),
    accuracy: num_(r.accuracy, 0, 100, 0), maxCombo: num_(r.maxCombo, 0, 1e5, 0), fullCombo: r.fullCombo === true,
    perfect: num_(c.PERFECT, 0, 1e5, 0), great: num_(c.GREAT, 0, 1e5, 0), good: num_(c.GOOD, 0, 1e5, 0), miss: num_(c.MISS, 0, 1e5, 0), wrong: num_(c.WRONG, 0, 1e5, 0), stray: num_(c.STRAY, 0, 1e5, 0),
    meanAsyncMs: num_(t.meanAsyncMs, -2000, 2000, ''), sdAsyncMs: num_(t.sdAsyncMs, 0, 2000, ''), R: num_(t.R, 0, 1, ''),
    chordSimulMs: num_(co.chordSimulMs, 0, 2000, ''), limbIndependence: num_(co.limbIndependence, 0, 5, ''),
    srtMedian: num_(rf.srt && rf.srt.median, 0, 3000, ''), crtMedian: num_(rf.crt && rf.crt.median, 0, 4000, ''), crtErr: num_(rf.crt && rf.crt.errRate, 0, 1, ''),
    beatsyncSd600: num_(bs.ioi600 && bs.ioi600.sd, 0, 1000, ''), rhythmIndex: num_(r.rhythmIndex, 0, 100, ''), coordinationIndex: num_(r.coordinationIndex, 0, 100, ''),
    perPadJSON: JSON.stringify(r.perPad || {}).slice(0, 4000), confusionJSON: JSON.stringify(r.confusion || {}).slice(0, 4000),
    appVersion: str_(r.appVersion, 12), userAgent: str_(r.userAgent, 200),
    // v1.2 extras
    stars: num_(r.stars, 0, 5, ''), maxScore: num_(r.maxScore, 0, 1e9, ''), scorePct: Number(r.maxScore) > 0 ? r1_(Math.min(200, Number(r.score) / Number(r.maxScore) * 100)) : '',
    failed: r.failed === true, completionPct: num_(r.completionPct, 0, 100, ''), heartbeatCount: num_(r.heartbeatCount, 0, 1000, ''), notesTotal: num_(r.notesTotal, 0, 1e5, ''),
    runNumber: num_(pl.runNumber, 1, 1e5, ''), xp: num_(pl.xp, 0, 1e9, ''),
    deviceType: oneOf_(dv.type, ['phone', 'tablet', 'desktop']), os: oneOf_(dv.os, ['iOS', 'Android', 'Windows', 'macOS', 'ChromeOS', 'Linux', 'Other']),
    browser: oneOf_(dv.browser, ['Chrome', 'Safari', 'Edge', 'Firefox', 'Samsung', 'Other']), inputMethod: oneOf_(dv.input, ['touch', 'keyboard', 'midi', 'mouse']),
    screen: /^\d{2,5}x\d{2,5}$/.test(dv.screen) ? dv.screen : '', orientation: oneOf_(dv.orientation, ['portrait', 'landscape']), lang: oneOf_(dv.lang, ['en', 'zh']),
    tzOffsetMin: num_(dv.tzOffsetMin, -840, 840, ''), localHour: num_(dv.localHour, 0, 23, ''), weekday: num_(dv.weekday, 0, 6, ''),
    pad4: st.pad4 === true, noteSpeed: num_(st.noteSpeed, .5, 5, ''), calibrated: st.calibrated === true, deviceLatencyMs: num_(st.deviceLatencyMs, -500, 500, ''), deviceOffsetMs: num_(r.deviceOffsetMs, -500, 500, ''),
    sectionsJSON: JSON.stringify(secs).slice(0, 4000), timelineJSON: JSON.stringify(tl).slice(0, 400) });
  // tidy tables (batch write)
  const base = [new Date(), str_(r.sessionId, 64), AGE_BANDS.indexOf(r.ageBand) >= 0 ? r.ageBand : '', str_(r.gender, 3), str_(r.difficulty, 10), num_(pl.runNumber, 1, 1e5, '')];
  const rowsS = secs.map(s => base.concat([s.i, s.name, s.n, s.acc == null ? '' : s.acc]));
  const pp = r.perPad || {}, rowsP = LANES.filter(l => pp[l] && Number(pp[l].notes) > 0).map(l => { const p = pp[l];
    return base.concat([l, num_(p.notes, 0, 1e5, 0), num_(p.hits, 0, 1e5, 0), r1_(Number(p.hits) / Number(p.notes) * 100), num_(r1_(p.meanErrMs), -500, 500, ''), num_(r1_(p.sdErrMs), 0, 1000, '')]); });
  appendRows_('SectionStats', rowsS); appendRows_('PadStats', rowsP);
}
const oneOf_ = (v, list) => list.indexOf(v) >= 0 ? v : '';
function appendRows_(name, rows) { if (!rows.length) return; const sh = SS_().getSheetByName(name); if (!sh) return; sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows); }

// ------------------------------------------------------------------ leaderboards (public)
function periodOk_(row, period, season, tz) {
  if (period === 'season') return String(row.season) === season;
  const ts = new Date(row.ts).getTime(), now = Date.now();
  if (period === 'week') return now - ts < 7 * 864e5;
  if (period === 'today') return Utilities.formatDate(new Date(row.ts), tz, 'yyyyMMdd') === Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  return true;
}
function boardRows_(p, rowsIn) {
  const b = BOARDS[p.board || 'score'] || BOARDS.score, col = b[0], lower = b[1], season = cfg_('currentSeason'), tz = SS_().getSpreadsheetTimeZone();
  const isTest = p.board === 'srt' || p.board === 'crt' || p.board === 'rhythm', best = {};
  (rowsIn || table_('Leaderboard').rows).forEach(r => {
    if (!r.sessionId || isTrue_(r.hidden)) return;
    if (!isTest && r.songId !== (p.song || SONG_ID)) return;
    if (!isTest && p.difficulty && r.difficulty !== p.difficulty) return;
    const v = Number(r[col]); if (!(v > 0)) return;
    if (!periodOk_(r, p.period || 'all', season, tz)) return;
    if (p.ageBand && r.ageBand !== p.ageBand) return;
    if (p.gender && !(r.gender === p.gender && isTrue_(r.showGender))) return;
    const cur = best[r.playerId]; if (!cur || (lower ? v < cur.value : v > cur.value)) best[r.playerId] = { row: r, value: v };
  });
  return Object.keys(best).map(k => best[k]).sort((a, c) => lower ? a.value - c.value : c.value - a.value);
}
function getBoard_(p) {
  const key = ['b', ver_(), p.board, p.song, p.difficulty, p.period, p.ageBand, p.gender].join('|'), cache = CacheService.getScriptCache(), limit = num_(p.limit, 1, 50, 10);
  let res = cache.get(key); const tz = SS_().getSpreadsheetTimeZone();
  if (res) res = JSON.parse(res);
  else { const arr = boardRows_(p);
    res = { updated: new Date().toISOString(), version: ver_(), n: arr.length, all: arr.map((x, i) => ({ rank: i + 1, pid: x.row.playerId, nickname: x.row.nickname, avatarColor: x.row.avatarColor,
      ageBand: x.row.ageBand, gender: isTrue_(x.row.showGender) ? x.row.gender : undefined, value: x.value, date: Utilities.formatDate(new Date(x.row.ts), tz, 'yyyy-MM-dd'),
      isNew: Date.now() - new Date(x.row.ts).getTime() < 60000, sid: x.row.sessionId })) };
    try { cache.put(key, JSON.stringify(res), 15); } catch (e) {} }
  const out = { ok: true, updated: res.updated, version: res.version, n: res.n, rows: res.all.slice(0, limit).map(r => { const c = Object.assign({}, r); delete c.pid; return c; }), me: null };
  if (p.playerId) { const m = res.all.filter(r => r.pid === p.playerId)[0]; if (m) out.me = { rank: m.rank, value: m.value }; }
  return out;
}
function ranks_(en) {
  const out = {}, rows = table_('Leaderboard').rows;
  Object.keys(BOARDS).forEach(b => {
    if (!(Number(en[BOARDS[b][0]]) > 0)) return;
    const all = boardRows_({ board: b, song: en.songId, difficulty: (b === 'score' || b === 'accuracy' || b === 'combo') ? en.difficulty : '', period: 'all' }, rows);
    const mine = all.findIndex(x => x.row.playerId === en.playerId); if (mine < 0) return;
    const band = all.filter(x => x.row.ageBand === en.ageBand), bi = band.findIndex(x => x.row.playerId === en.playerId);
    out[b] = { global: mine + 1, n: all.length, pct: Math.round((1 - mine / Math.max(1, all.length)) * 100), band: en.ageBand, bandRank: bi + 1, bandN: band.length };
  });
  return out;
}

// ------------------------------------------------------------------ cohort norms (hourly)
function hourlyNorms() {
  const rows = table_('Sessions').rows, sh = SS_().getSheetByName('NormsAgg'), out = [], lowerBetter = { srtMedian: 1, crtMedian: 1, beatsyncSd600: 1 };
  Object.keys(NORM_METRICS).forEach(m => {
    const col = NORM_METRICS[m], best = {};
    rows.forEach(r => { const v = Number(r[col]); if (!(v > 0) || !r.ageBand) return; const cur = best[r.playerId];
      if (!cur || (lowerBetter[col] ? v < cur.v : v > cur.v)) best[r.playerId] = { v: v, ageBand: r.ageBand, gender: r.gender }; });
    const cells = {}; Object.keys(best).forEach(k => { const x = best[k]; [[x.ageBand, x.gender], [x.ageBand, 'ALL']].forEach(c => { const kk = c.join('|'); (cells[kk] = cells[kk] || []).push(x.v); }); });
    Object.keys(cells).forEach(k => { const v = cells[k].sort((a, b) => a - b); if (v.length < 30) return;
      const q = f => v[Math.min(v.length - 1, Math.floor(f * v.length))], mu = mean_(v), sd = Math.sqrt(v.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (v.length - 1)), p = k.split('|');
      out.push([m, p[0], p[1], v.length, q(.1), q(.2), q(.3), q(.4), q(.5), q(.6), q(.7), q(.8), q(.9), +mu.toFixed(2), +sd.toFixed(2), new Date()]); });
  });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, TABS.NormsAgg.length).clearContent();
  if (out.length) sh.getRange(2, 1, out.length, TABS.NormsAgg.length).setValues(out);
  bumpVersion_();
}
function getNorms_(p) {
  const rows = table_('NormsAgg').rows.filter(r => r.metric === p.metric && (!p.ageBand || r.ageBand === p.ageBand) && (!p.gender || r.gender === p.gender));
  return { ok: true, updated: new Date().toISOString(), cells: rows.map(r => ({ ageBand: r.ageBand, gender: r.gender, n: r.n, mean: r.mean, sd: r.sd, deciles: [r.p10, r.p20, r.p30, r.p40, r.p50, r.p60, r.p70, r.p80, r.p90] })) };
}

// ================================================================== DASHBOARD DATA (shared by the Sheet tab and the web dashboard)
/** Aggregates only — no player IDs, ages or raw records leave this function (top-10 shows public nicknames). */
function dashAgg_(f) {
  f = f || {}; const ss = SS_(), tz = ss.getSpreadsheetTimeZone(), now = new Date(), day = d => Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  const today = day(now), maxAge = { d7: 7, d30: 30 }[f.period] || 36500;
  const inPeriod = d => d instanceof Date && (f.period === 'today' ? day(d) === today : now - d <= maxAge * 864e5);
  const who = r => (!f.ageBand || r.ageBand === f.ageBand) && (!f.gender || r.gender === f.gender);
  const lbAll = table_('Leaderboard').rows.filter(r => r.sessionId), hiddenIds = {};
  lbAll.forEach(r => { if (isTrue_(r.hidden)) hiddenIds[r.sessionId] = 1; });
  const lb = lbAll.filter(r => !hiddenIds[r.sessionId] && inPeriod(r.ts) && who(r));
  const runs = lb.filter(r => SONG_DIFFS[r.difficulty] && (!f.difficulty || r.difficulty === f.difficulty) && Number(r.score) > 0);
  const tests = lb.filter(r => Number(r.srtMedian) > 0 || Number(r.crtMedian) > 0);
  const sess = table_('Sessions').rows.filter(r => r.sessionId && !hiddenIds[r.sessionId] && inPeriod(r.ts) && who(r) && (!f.difficulty || r.difficulty === f.difficulty));
  const nums = (arr, k) => arr.map(r => Number(r[k])).filter(v => v > 0);
  // KPIs
  const players = {}; lb.forEach(r => players[r.playerId] = 1);
  const kpi = { plays: runs.length, players: Object.keys(players).length, today: runs.filter(r => day(r.ts) === today).length,
    avgAcc: r1_(mean_(nums(runs, 'accuracy'))), bestScore: runs.reduce((m, r) => Math.max(m, Number(r.score) || 0), 0),
    medSrt: r1_(median_(nums(tests, 'srtMedian'))), medCrt: r1_(median_(nums(tests, 'crtMedian'))),
    avgRhythm: r1_(mean_(nums(lb, 'rhythmIndex'))), tests: tests.length, consented: sess.length };
  // plays per day
  const nDays = f.period === 'd7' ? 7 : f.period === 'today' ? 1 : 30, counts = {};
  runs.forEach(r => { const k = day(r.ts); counts[k] = (counts[k] || 0) + 1; });
  const daily = []; for (let i = nDays - 1; i >= 0; i--) { const d = new Date(now.getTime() - i * 864e5), k = day(d); daily.push([Utilities.formatDate(d, tz, 'd MMM'), counts[k] || 0]); }
  // difficulty split
  const byDiff = { gentle: 0, groove: 0, fire: 0 }; lb.filter(r => SONG_DIFFS[r.difficulty] && Number(r.score) > 0).forEach(r => byDiff[r.difficulty]++);
  // by age band
  const bands = AGE_BANDS.map(b => { const rb = runs.filter(r => r.ageBand === b), tb = tests.filter(r => r.ageBand === b), sb = sess.filter(r => r.ageBand === b), lbb = lb.filter(r => r.ageBand === b);
    return { band: b, n: rb.length, accAll: r1_(mean_(nums(rb, 'accuracy'))), accM: r1_(mean_(nums(rb.filter(r => r.gender === 'M'), 'accuracy'))), accF: r1_(mean_(nums(rb.filter(r => r.gender === 'F'), 'accuracy'))),
      srt: r1_(median_(nums(tb, 'srtMedian'))), crt: r1_(median_(nums(tb, 'crtMedian'))), rhythm: r1_(mean_(nums(lbb, 'rhythmIndex'))), coord: r1_(mean_(nums(sb, 'coordinationIndex'))),
      async: r1_(mean_(sb.map(r => r.meanAsyncMs).filter(v => v !== '' && isFinite(v)).map(Number))), sd: r1_(mean_(nums(sb, 'sdAsyncMs'))) }; });
  // accuracy histogram (10 bins)
  const accHist = new Array(10).fill(0); runs.forEach(r => { accHist[Math.min(9, Math.floor((Number(r.accuracy) || 0) / 10))]++; });
  // top 10 (best score per player)
  const best = {}; runs.forEach(r => { const b = best[r.playerId] || (best[r.playerId] = { nickname: r.nickname, ageBand: r.ageBand, score: 0, acc: 0, plays: 0, diff: r.difficulty });
    b.plays++; if (Number(r.score) > b.score) { b.score = Number(r.score); b.diff = r.difficulty; } b.acc = Math.max(b.acc, Number(r.accuracy) || 0); });
  const top = Object.keys(best).map(k => best[k]).sort((a, b) => b.score - a.score).slice(0, 10);
  // activity heat-map (Mon..Sun × 24 h)
  const heat = []; for (let i = 0; i < 7; i++) heat.push(new Array(24).fill(0));
  lb.forEach(r => { const d = Number(Utilities.formatDate(r.ts, tz, 'u')) - 1, h = Number(Utilities.formatDate(r.ts, tz, 'H')); if (d >= 0 && d < 7) heat[d][h]++; });
  // per-pad accuracy + confusion (consented sessions only)
  const pad = {}, conf = {}; LANES.forEach(l => { pad[l] = { notes: 0, hits: 0 }; conf[l] = {}; LANES.concat(['none']).forEach(p => conf[l][p] = 0); });
  sess.forEach(r => { try { const pp = JSON.parse(r.perPadJSON || '{}'); LANES.forEach(l => { if (pp[l]) { pad[l].notes += Number(pp[l].notes) || 0; pad[l].hits += Number(pp[l].hits) || 0; } }); } catch (e) {}
    try { const cm = JSON.parse(r.confusionJSON || '{}'); LANES.forEach(e => { if (cm[e]) Object.keys(conf[e]).forEach(p => conf[e][p] += Number(cm[e][p]) || 0); }); } catch (e) {} });
  const padAcc = LANES.map(l => ({ lane: l, name: LANE_NAMES[l], acc: pad[l].notes ? r1_(pad[l].hits / pad[l].notes * 100) : null, notes: pad[l].notes }));
  // ---- v1.2 research aggregates (consented song sessions) ----
  const songSess = sess.filter(r => SONG_DIFFS[r.difficulty]);
  // where in the song do players struggle? (mean section accuracy, song order)
  const secMap = {}; songSess.forEach(r => { try { JSON.parse(r.sectionsJSON || '[]').forEach(s => { if (!(s.n > 0) || s.acc == null) return; const k = s.name; const m = secMap[k] || (secMap[k] = { i: s.i, name: k, sum: 0, n: 0 }); m.sum += Number(s.acc); m.n++; m.i = Math.min(m.i, s.i); }); } catch (e) {} });
  const sections = Object.keys(secMap).map(k => secMap[k]).sort((a, b) => a.i - b.i).map(m => ({ name: m.name, acc: r1_(m.sum / m.n), runs: m.n }));
  // accuracy across the song (10 equal time slices)
  const tlS = new Array(10).fill(0), tlN = new Array(10).fill(0); songSess.forEach(r => { try { JSON.parse(r.timelineJSON || '[]').forEach((v, i) => { if (v != null && i < 10) { tlS[i] += Number(v); tlN[i]++; } }); } catch (e) {} });
  const timeline = tlS.map((s, i) => [(i * 10) + '–' + (i * 10 + 10) + '%', tlN[i] ? r1_(s / tlN[i]) : null]);
  // learning curve: mean accuracy by the player's n-th run of this song (all leaderboard runs, ordered by time)
  const byP = {}; lbAll.filter(r => !hiddenIds[r.sessionId] && SONG_DIFFS[r.difficulty] && Number(r.score) > 0 && r.songId === SONG_ID).sort((a, b) => new Date(a.ts) - new Date(b.ts))
    .forEach(r => { (byP[r.playerId] = byP[r.playerId] || []).push(r); });
  const LC = 10, lcS = {}, lcN = {}; Object.keys(SONG_DIFFS).forEach(d => { lcS[d] = new Array(LC).fill(0); lcN[d] = new Array(LC).fill(0); });
  Object.keys(byP).forEach(pid => { const cnt = {}; byP[pid].forEach(r => { cnt[r.difficulty] = (cnt[r.difficulty] || 0) + 1; if (!inPeriod(r.ts) || !who(r)) return; const k = Math.min(LC, cnt[r.difficulty]) - 1; lcS[r.difficulty][k] += Number(r.accuracy) || 0; lcN[r.difficulty][k]++; }); });
  const learning = []; for (let k = 0; k < LC; k++) learning.push([k === LC - 1 ? LC + '+' : String(k + 1)].concat(['gentle', 'groove', 'fire'].map(d => lcN[d][k] ? r1_(lcS[d][k] / lcN[d][k]) : null)));
  // per-pad timing bias (− early, + late) and spread, weighted by hits
  const pt = {}; LANES.forEach(l => pt[l] = { w: 0, m: 0, s: 0 });
  songSess.forEach(r => { try { const pp = JSON.parse(r.perPadJSON || '{}'); LANES.forEach(l => { const p = pp[l]; if (!p || !(p.hits > 0) || p.meanErrMs == null || !isFinite(p.meanErrMs)) return; pt[l].w += p.hits; pt[l].m += p.hits * p.meanErrMs; if (isFinite(p.sdErrMs)) pt[l].s += p.hits * p.sdErrMs; }); } catch (e) {} });
  const padTiming = LANES.map(l => ({ lane: l, name: LANE_NAMES[l], meanErr: pt[l].w ? r1_(pt[l].m / pt[l].w) : null, sdErr: pt[l].w ? r1_(pt[l].s / pt[l].w) : null }));
  // completion (finished vs failed) per difficulty
  const completion = ['gentle', 'groove', 'fire'].map(d => { const a = songSess.filter(r => r.difficulty === d); return { d, finished: a.filter(r => !isTrue_(r.failed)).length, failed: a.filter(r => isTrue_(r.failed)).length, fc: a.filter(r => isTrue_(r.fullCombo)).length }; });
  // device / input / OS mix
  const tally = k => { const o = {}; songSess.forEach(r => { const v = r[k] || 'unknown'; o[v] = (o[v] || 0) + 1; }); return Object.keys(o).map(x => [x, o[x]]).sort((a, b) => b[1] - a[1]); };
  const devices = tally('deviceType'), inputs = tally('inputMethod'), oses = tally('os');
  // retention
  const days = {}; lb.forEach(r => { (days[r.playerId] = days[r.playerId] || {})[day(r.ts)] = 1; });
  kpi.returning = Object.keys(days).filter(p => Object.keys(days[p]).length >= 2).length;
  kpi.runsPerPlayer = kpi.players ? r1_(runs.length / kpi.players) : null;
  kpi.fullCombos = songSess.filter(r => isTrue_(r.fullCombo)).length;
  kpi.completion = songSess.length ? r1_(songSess.filter(r => !isTrue_(r.failed)).length / songSess.length * 100) : null;
  return { ok: true, updated: Utilities.formatDate(now, tz, 'd MMM yyyy, HH:mm'), filters: f, kpi, daily, byDiff, bands, accHist, top, heat, padAcc, conf, lanes: LANES,
    sections, timeline, learning, padTiming, completion, devices, inputs, oses, song: { id: SONG_ID, title: SONG_TITLE, artist: SONG_ARTIST } };
}
/** called by the web dashboard (google.script.run) */
function getDashData(f) {
  const key = 'dash|' + ver_() + '|' + JSON.stringify(f || {}), c = CacheService.getScriptCache(), hit = c.get(key);
  if (hit) return JSON.parse(hit);
  const d = dashAgg_(f || {}); try { c.put(key, JSON.stringify(d), 60); } catch (e) {} return d;
}

// ================================================================== DASHBOARD TAB (inside the Sheet)
const DASH = 'Dashboard', DDATA = 'DashData';
const chartStyle_ = (b, title, colors) => b.setOption('title', title).setOption('width', 790).setOption('height', 320)
  .setOption('backgroundColor', THEME.tile).setOption('titleTextStyle', { color: THEME.ink, fontSize: 14, bold: true })
  .setOption('legend', { position: 'bottom', textStyle: { color: THEME.dim, fontSize: 11 } })
  .setOption('hAxis', { textStyle: { color: THEME.dim, fontSize: 10 }, gridlines: { color: '#2A2550' }, baselineColor: '#3A3466' })
  .setOption('vAxis', { textStyle: { color: THEME.dim, fontSize: 10 }, gridlines: { color: '#2A2550' }, baselineColor: '#3A3466', minValue: 0 })
  .setOption('colors', colors || [THEME.pink, THEME.blue, '#2EE6A6', '#FFD23F', '#FF7A1A']).setOption('chartArea', { left: 56, top: 44, width: '84%', height: '62%' });
/** Builds the layout + charts. Run from setup() or the menu; data is filled by refreshDashboard(). */
function buildDashboard() {
  const ss = SS_();
  let d = ss.getSheetByName(DDATA); if (!d) d = ss.insertSheet(DDATA); d.clear(); if (d.getMaxColumns() < 60) d.insertColumnsAfter(d.getMaxColumns(), 60 - d.getMaxColumns()); d.getRange('A:BH').setNumberFormat('@');
  let s = ss.getSheetByName(DASH); if (!s) s = ss.insertSheet(DASH, 0); s.getCharts().forEach(c => s.removeChart(c)); s.clear(); s.clearConditionalFormatRules();
  ss.setActiveSheet(s); ss.moveActiveSheet(1);
  s.setHiddenGridlines(true); if (s.getMaxColumns() < 24) s.insertColumnsAfter(s.getMaxColumns(), 24 - s.getMaxColumns());
  if (s.getMaxRows() < 200) s.insertRowsAfter(s.getMaxRows(), 200 - s.getMaxRows());
  s.setColumnWidths(1, 24, 68); s.getRange('A1:X200').setBackground(THEME.bg).setFontColor(THEME.ink).setFontFamily('Arial').setVerticalAlignment('middle');
  s.setRowHeight(1, 46); s.setRowHeight(2, 24); s.setRowHeight(6, 44);
  s.getRange('A1:X1').merge().setValue('intelliCARE Music Play-a-Long · 翎羽悸動 · Live Dashboard').setFontSize(20).setFontWeight('bold').setHorizontalAlignment('left');
  s.getRange('A2:X2').merge().setValue(SONG_TITLE + ' — performed by ' + SONG_ARTIST).setFontColor(THEME.pink).setFontSize(12).setFontWeight('bold');
  s.getRange('A3:X3').merge().setFontColor(THEME.dim).setFontSize(9);
  // KPI tiles (8 × 3 columns)
  ['SONG RUNS', 'PLAYERS', 'RUNS TODAY', 'AVG ACCURACY', 'BEST SCORE', 'MEDIAN SIMPLE RT', 'MEDIAN 4-CHOICE RT', 'AVG RHYTHM INDEX'].forEach((label, i) => {
    const c = 1 + i * 3; s.getRange(5, c, 3, 3).setBackground(THEME.tile);
    s.getRange(5, c, 1, 3).merge().setValue(label).setFontSize(8).setFontColor(THEME.dim).setFontWeight('bold').setHorizontalAlignment('center');
    s.getRange(6, c, 1, 3).merge().setFontSize(22).setFontWeight('bold').setHorizontalAlignment('center').setFontColor([THEME.pink, THEME.blue, '#2EE6A6', '#FFD23F', '#FF7A1A', THEME.pink, THEME.blue, '#2EE6A6'][i]);
    s.getRange(7, c, 1, 3).merge().setFontSize(8).setFontColor(THEME.dim).setHorizontalAlignment('center'); });
  // DashData headers (fixed shapes so the charts never need rebuilding)
  d.getRange('A1:B1').setValues([['Day', 'Song runs']]); d.getRange('D1:E1').setValues([['Difficulty', 'Runs']]);
  d.getRange('G1:J1').setValues([['Age band', 'Male', 'Female', 'All']]); d.getRange('L1:N1').setValues([['Age band', 'Simple RT (ms)', '4-choice RT (ms)']]);
  d.getRange('P1:R1').setValues([['Age band', 'Rhythm Index', 'Coordination Index']]); d.getRange('T1:U1').setValues([['Accuracy %', 'Runs']]);
  d.getRange('W1:X1').setValues([['Pad', 'Accuracy %']]); d.getRange('Z1:AB1').setValues([['Age band', 'Mean asynchrony (ms)', 'Timing SD (ms)']]);
  d.getRange('AD1:AE1').setValues([['Section', 'Accuracy %']]); d.getRange('AG1:AH1').setValues([['Song position', 'Accuracy %']]);
  d.getRange('AJ1:AM1').setValues([['Run #', 'Gentle', 'Groove', 'Fire']]); d.getRange('AO1:AQ1').setValues([['Pad', 'Mean error (ms)', 'Spread SD (ms)']]);
  d.getRange('AS1:AV1').setValues([['Difficulty', 'Finished', 'Failed', 'Full combo']]); d.getRange('AX1:AY1').setValues([['Device', 'Runs']]); d.getRange('BA1:BB1').setValues([['Input', 'Runs']]);
  refreshDashboard(); // fill data before charts
  const C = Charts.ChartType, add = (type, rng, row, col, title, colors, extra) => { let b = s.newChart().setChartType(type); rng.forEach(r => b = b.addRange(d.getRange(r)));
    b = chartStyle_(b.setNumHeaders(1).setPosition(row, col, 4, 0), title, colors); if (extra) b = extra(b); s.insertChart(b.build()); };
  const sec = (row, col, text) => s.getRange(row, col, 1, 12).merge().setValue(text).setFontSize(11).setFontWeight('bold').setFontColor(THEME.pink);
  sec(9, 1, '▍ ENGAGEMENT'); sec(9, 13, '▍ DIFFICULTY MIX');
  add(C.AREA, ['A1:B31'], 10, 1, 'Song runs per day (last 30 days)', [THEME.pink], b => b.setOption('areaOpacity', .35).setOption('legend', { position: 'none' }));
  add(C.PIE, ['D1:E4'], 10, 13, 'Runs by difficulty', ['#2EE6A6', THEME.blue, '#FF3B5C'], b => b.setOption('pieHole', .55).setOption('pieSliceBorderColor', THEME.tile).setOption('legend', { position: 'right', textStyle: { color: THEME.dim } }));
  sec(27, 1, '▍ ACCURACY BY AGE BAND & GENDER'); sec(27, 13, '▍ REACTION TIME BY AGE BAND');
  add(C.COLUMN, ['G1:J10'], 28, 1, 'Average song accuracy (%)', [THEME.blue, THEME.pink, '#2EE6A6'], b => b.setOption('vAxis', { minValue: 0, maxValue: 100, textStyle: { color: THEME.dim }, gridlines: { color: '#2A2550' } }));
  add(C.LINE, ['L1:N10'], 28, 13, 'Median reaction time (ms, lower is faster)', ['#FFD23F', '#FF7A1A'], b => b.setOption('pointSize', 7).setOption('lineWidth', 3).setOption('interpolateNulls', true));
  sec(45, 1, '▍ RHYTHM & COORDINATION'); sec(45, 13, '▍ ACCURACY DISTRIBUTION');
  add(C.COLUMN, ['P1:R10'], 46, 1, 'Rhythm Index & Coordination Index (0–100, heuristic)', [THEME.pink, '#2EE6A6']);
  add(C.COLUMN, ['T1:U11'], 46, 13, 'How accurate are the runs? (number of runs per 10 % bin)', [THEME.blue], b => b.setOption('legend', { position: 'none' }).setOption('bar', { groupWidth: '92%' }));
  sec(63, 1, '▍ PAD ACCURACY (consented sessions)'); sec(63, 13, '▍ TIMING BY AGE BAND (consented sessions)');
  add(C.BAR, ['W1:X6'], 64, 1, 'Hit rate per pad (%)', [THEME.pink], b => b.setOption('legend', { position: 'none' }).setOption('hAxis', { minValue: 0, maxValue: 100, textStyle: { color: THEME.dim }, gridlines: { color: '#2A2550' } }));
  add(C.COLUMN, ['Z1:AB10'], 64, 13, 'Mean asynchrony (− = early) and timing variability', ['#FFD23F', THEME.blue]);
  // table blocks (filled by refreshDashboard)
  sec(81, 1, '▍ TOP 10 PLAYERS (best score)'); sec(81, 13, '▍ WHEN DO PEOPLE PLAY? (runs by weekday × 3-hour block)');
  sec(96, 1, '▍ EXPECTED PAD → PAD ACTUALLY HIT (all consented hits)');
  // v1.2 research panels
  sec(105, 1, '▍ WHERE IN THE SONG DO PLAYERS STRUGGLE? (accuracy by section)'); sec(105, 13, '▍ ACCURACY ACROSS THE SONG (10 time slices)');
  add(C.COLUMN, ['AD1:AE15'], 106, 1, 'Mean accuracy per song section (%)', [THEME.lilac], b => b.setOption('legend', { position: 'none' }).setOption('vAxis', { minValue: 0, maxValue: 100, textStyle: { color: THEME.dim }, gridlines: { color: '#2A2550' } }));
  add(C.LINE, ['AG1:AH11'], 106, 13, 'Mean accuracy by song position (%)', [THEME.pink], b => b.setOption('legend', { position: 'none' }).setOption('pointSize', 6).setOption('lineWidth', 3).setOption('curveType', 'function'));
  sec(123, 1, '▍ LEARNING CURVE (n-th run of this song)'); sec(123, 13, '▍ EARLY OR LATE? (timing per pad)');
  add(C.LINE, ['AJ1:AM11'], 124, 1, 'Mean accuracy by run number (%)', ['#2EE6A6', THEME.blue, '#FF3B5C'], b => b.setOption('pointSize', 6).setOption('lineWidth', 3).setOption('interpolateNulls', true));
  add(C.COLUMN, ['AO1:AQ6'], 124, 13, 'Mean hit error (− early, + late) and spread (ms)', ['#FFD23F', THEME.lilac]);
  sec(141, 1, '▍ COMPLETION BY DIFFICULTY'); sec(141, 13, '▍ DEVICE & INPUT MIX');
  add(C.COLUMN, ['AS1:AV4'], 142, 1, 'Finished / failed / full-combo runs', ['#2EE6A6', '#FF3B5C', '#FFD23F']);
  add(C.PIE, ['AX1:AY5'], 142, 13, 'Runs by device', [THEME.pink, THEME.lilac, THEME.blue, '#2EE6A6'], b => b.setOption('pieHole', .55).setOption('width', 390).setOption('pieSliceBorderColor', THEME.tile));
  add(C.PIE, ['BA1:BB5'], 142, 19, 'Runs by input', ['#FFD23F', '#FF7A1A', '#2EE6A6', THEME.blue], b => b.setOption('pieHole', .55).setOption('width', 390).setOption('pieSliceBorderColor', THEME.tile));
  sec(159, 1, '▍ OPEN DATA'); s.getRange(160, 1, 3, 24).merge().setWrap(true).setFontColor(THEME.dim).setFontSize(10).setVerticalAlignment('top')
    .setValue('Analysis-ready tabs: SectionStats (one row per run × section) and PadStats (one row per run × pad). Public anonymised downloads from the web app: <exec URL>?action=export (CSV, one row per run), ?action=export&kind=tests (Reflex / Beat-Sync tests) and ?action=stats (JSON of every aggregate on this page). Player ids are salted hashes; no names or exact ages are exported.');
  refreshDashboard();
  s.setFrozenRows(3);
}
/** Writes the latest aggregates into DashData + the Dashboard tables (time-driven every 10 min). */
function refreshDashboard() {
  const ss = SS_(), d = ss.getSheetByName(DDATA), s = ss.getSheetByName(DASH); if (!d || !s) return;
  const a = dashAgg_({}), k = a.kpi, blank = v => v == null ? '' : v;
  s.getRange('A3').setValue('Last refreshed ' + a.updated + ' · refreshes every 10 min · menu 🎵 intelliCARE → Refresh dashboard now · live filterable view: <web app URL>?action=dashboard');
  const tiles = [[k.plays, 'all difficulties'], [k.players, 'unique players'], [k.today, 'song runs today'], [k.avgAcc == null ? '–' : k.avgAcc + '%', 'mean of all runs'],
    [k.bestScore ? k.bestScore.toLocaleString() : '–', 'single run'], [k.medSrt == null ? '–' : k.medSrt + ' ms', 'Reflex Test'], [k.medCrt == null ? '–' : k.medCrt + ' ms', 'Reflex Test'], [k.avgRhythm == null ? '–' : k.avgRhythm, 'heuristic, 0–100']];
  tiles.forEach((t, i) => { s.getRange(6, 1 + i * 3).setValue(t[0]); s.getRange(7, 1 + i * 3).setValue(t[1]); });
  const put = (rng, rows) => { const r = d.getRange(rng); r.clearContent(); r.setValues(rows); };
  d.getRange('B:B').setNumberFormat('0'); d.getRange('E:E').setNumberFormat('0'); d.getRange('H:K').setNumberFormat('0.0'); d.getRange('M:N').setNumberFormat('0'); d.getRange('Q:R').setNumberFormat('0.0');
  d.getRange('U:U').setNumberFormat('0'); d.getRange('X:X').setNumberFormat('0.0'); d.getRange('AA:AB').setNumberFormat('0.0');
  const daily = a.daily.slice(-30); while (daily.length < 30) daily.unshift(['', 0]); put('A2:B31', daily);
  put('D2:E4', [['Gentle', a.byDiff.gentle], ['Groove', a.byDiff.groove], ['Fire', a.byDiff.fire]]);
  put('G2:J10', a.bands.map(b => [b.band, blank(b.accM), blank(b.accF), blank(b.accAll)]));
  put('L2:N10', a.bands.map(b => [b.band, blank(b.srt), blank(b.crt)]));
  put('P2:R10', a.bands.map(b => [b.band, blank(b.rhythm), blank(b.coord)]));
  put('T2:U11', a.accHist.map((n, i) => [(i * 10) + '–' + (i * 10 + 10), n]));
  put('W2:X6', a.padAcc.map(p => [p.name, blank(p.acc)]));
  put('Z2:AB10', a.bands.map(b => [b.band, blank(b.async), blank(b.sd)]));
  // v1.2 blocks (fixed shapes; unused rows blank)
  const pad_ = (arr, n, w) => { const o = arr.slice(0, n); while (o.length < n) o.push(new Array(w).fill('')); return o; };
  d.getRange('AE:AE').setNumberFormat('0.0'); d.getRange('AH:AH').setNumberFormat('0.0'); d.getRange('AK:AM').setNumberFormat('0.0'); d.getRange('AP:AQ').setNumberFormat('0.0'); d.getRange('AT:AV').setNumberFormat('0'); d.getRange('AY:AY').setNumberFormat('0'); d.getRange('BB:BB').setNumberFormat('0');
  put('AD2:AE15', pad_(a.sections.map(x => [x.name, blank(x.acc)]), 14, 2));
  put('AG2:AH11', a.timeline.map(x => [x[0], blank(x[1])]));
  put('AJ2:AM11', a.learning.map(x => [x[0], blank(x[1]), blank(x[2]), blank(x[3])]));
  put('AO2:AQ6', a.padTiming.map(x => [x.name, blank(x.meanErr), blank(x.sdErr)]));
  put('AS2:AV4', a.completion.map(x => [x.d, x.finished, x.failed, x.fc]));
  put('AX2:AY5', pad_(a.devices.map(x => [x[0], x[1]]), 4, 2)); put('BA2:BB5', pad_(a.inputs.map(x => [x[0], x[1]]), 4, 2));
  // top-10 table at A82
  const tb = s.getRange(82, 1, 11, 12); tb.breakApart(); tb.clearContent().setBackground(THEME.bg);
  const hdr = [['#', 'Nickname', '', '', 'Age band', '', 'Best score', '', 'Best acc.', '', 'Runs', 'Level']];
  s.getRange(82, 1, 1, 12).setValues(hdr).setFontWeight('bold').setFontColor(THEME.dim).setFontSize(9).setBackground(THEME.tile);
  for (let i = 0; i < 10; i++) { const t = a.top[i], row = 83 + i; s.getRange(row, 2, 1, 3).merge(); s.getRange(row, 5, 1, 2).merge(); s.getRange(row, 7, 1, 2).merge(); s.getRange(row, 9, 1, 2).merge();
    s.getRange(row, 1, 1, 12).setValues([[t ? i + 1 : '', t ? t.nickname : '', '', '', t ? t.ageBand : '', '', t ? t.score : '', '', t ? t.acc / 100 : '', '', t ? t.plays : '', t ? t.diff : '']])
      .setFontColor(i < 3 ? ['#FFD23F', '#E6E9F5', '#E0A060'][i] : THEME.ink).setFontWeight(i < 3 ? 'bold' : 'normal').setBackground(i % 2 ? '#14112A' : THEME.bg); }
  s.getRange(83, 7, 10, 1).setNumberFormat('#,##0'); s.getRange(83, 9, 10, 1).setNumberFormat('0.0%'); s.getRange(82, 12).setValue('Difficulty');
  // heat-map at M82: weekday × 3-hour blocks
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], hm = [['', '00–03', '03–06', '06–09', '09–12', '12–15', '15–18', '18–21', '21–24']];
  a.heat.forEach((row, i) => { const r = [days[i]]; for (let b = 0; b < 8; b++) r.push(row[b * 3] + row[b * 3 + 1] + row[b * 3 + 2]); hm.push(r); });
  s.getRange(82, 13, 8, 9).setValues(hm).setHorizontalAlignment('center').setFontSize(10); s.getRange(82, 13, 1, 9).setFontColor(THEME.dim).setFontWeight('bold').setFontSize(9);
  s.getRange(83, 13, 7, 1).setFontColor(THEME.dim).setFontWeight('bold');
  // confusion matrix at A97
  const cm = [['Expected ↓ / Hit →'].concat(LANES.map(l => LANE_NAMES[l])).concat(['Missed'])];
  LANES.forEach(e => cm.push([LANE_NAMES[e]].concat(LANES.concat(['none']).map(p => a.conf[e][p]))));
  s.getRange(97, 1, 6, 7).setValues(cm).setHorizontalAlignment('center').setFontSize(10); s.getRange(97, 1, 1, 7).setFontColor(THEME.dim).setFontWeight('bold').setFontSize(9);
  s.getRange(98, 1, 5, 1).setFontWeight('bold').setFontColor(THEME.dim);
  s.getRange(97, 9, 6, 15).merge().setValue('How to read: each row is the pad the song expected. Green diagonal = correct pad. Bright off-diagonal cells show which pads get mixed up (e.g. Hi-hat hit when Cymbal was due). "Missed" = note not hit at all.\n\nAll indices are heuristic engagement measures — not a medical or clinical assessment.')
    .setWrap(true).setFontColor(THEME.dim).setFontSize(10).setVerticalAlignment('top');
  // conditional formatting: heat-map + confusion (pink gradient), diagonal green
  const grad = (r, max) => SpreadsheetApp.newConditionalFormatRule().setGradientMinpoint(THEME.bg).setGradientMaxpoint(max).setRanges([r]).build();
  const diag = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(ROW()-97=COLUMN()-1,B98>0)').setBackground('#167a57').setFontColor('#ffffff').setRanges([s.getRange(98, 2, 5, 5)]).build();
  s.setConditionalFormatRules([diag, grad(s.getRange(83, 14, 7, 8), THEME.pink), grad(s.getRange(98, 2, 5, 6), '#FF3B5C')]);
}

// ================================================================== WEB DASHBOARD (?action=dashboard)
function dashboardPage_() {
  const exec = ScriptApp.getService().getUrl() || '';
  return HtmlService.createHtmlOutput(DASH_HTML.replace('__GAME__', GAME_URL).split('__EXEC__').join(exec)).setTitle('intelliCARE · 翎羽悸動 · Live Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
const DASH_HTML = `<!DOCTYPE html><html><head><base target="_top"><meta charset="utf-8">
<script src="https://www.gstatic.com/charts/loader.js"></script>
<style>
*{box-sizing:border-box}body{margin:0;background:radial-gradient(120% 60% at 50% -10%,#2a1650 0,#0b0a18 55%) fixed,#0b0a18;color:#fff;font-family:"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",Arial,sans-serif}
header{padding:22px 26px 8px;display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;justify-content:space-between}
h1{margin:0;font-size:22px;letter-spacing:.04em}h1 small{display:block;font-size:12px;letter-spacing:.3em;color:#a9a3cf;font-weight:700}
.song{color:#FF5FA2;font-weight:800;font-size:14px;margin-top:4px}.song span{color:#a9a3cf;font-weight:500}
.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
select{background:#1a1636;color:#fff;border:1px solid #3a3466;border-radius:10px;padding:8px 10px;font-size:13px}
.live{font-size:11px;font-weight:800;padding:5px 10px;border-radius:99px;background:#12452f;color:#4dff9e;letter-spacing:.08em}
a.btn{color:#fff;text-decoration:none;background:linear-gradient(180deg,#ff86bb,#e0245e);padding:8px 14px;border-radius:10px;font-weight:800;font-size:13px}
a.btn.ghost{background:#1a1636;border:1px solid #3a3466;color:#C9A7FF}
main{padding:10px 26px 30px;display:grid;gap:16px;grid-template-columns:repeat(12,1fr)}
.card{background:linear-gradient(180deg,rgba(32,26,66,.92),rgba(20,16,42,.92));border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:14px 16px;box-shadow:0 20px 40px rgba(0,0,0,.35)}
.kpi{grid-column:span 3}.kpi b{display:block;font-size:30px;font-weight:900;margin-top:4px}.kpi span{font-size:11px;letter-spacing:.18em;color:#a9a3cf;font-weight:800}.kpi i{font-style:normal;font-size:11px;color:#8d87b3}
.w6{grid-column:span 6}.w12{grid-column:span 12}.w4{grid-column:span 4}.w8{grid-column:span 8}
.card h3{margin:0 0 6px;font-size:13px;letter-spacing:.14em;color:#C9A7FF}.chart{height:300px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:7px 6px;text-align:left;border-bottom:1px solid rgba(255,255,255,.06)}th{color:#a9a3cf;font-size:11px;letter-spacing:.1em}
.hm td{text-align:center;padding:5px 2px;font-size:11px;border:2px solid #0b0a18;border-radius:4px}.hm th{text-align:center}
.r1{color:#ffd23f;font-weight:800}.r2{color:#e6e9f5;font-weight:800}.r3{color:#e0a060;font-weight:800}
.note{font-size:11px;color:#8d87b3;margin-top:8px}
@media(max-width:900px){.kpi{grid-column:span 6}.w6,.w4,.w8{grid-column:span 12}main{padding:10px 12px}}
</style></head><body>
<header><div><h1><small>INTELLICARE MUSIC PLAY-A-LONG</small>Live Dashboard</h1><div class="song">翎羽悸動 | Fluttering Feathers, Stirring Hearts <span>— performed by Selina Goh 吴宛颖</span></div></div>
<div class="filters">
<select id="period"><option value="">All time</option><option value="d30">Last 30 days</option><option value="d7">Last 7 days</option><option value="today">Today</option></select>
<select id="difficulty"><option value="">All difficulties</option><option value="gentle">Gentle</option><option value="groove">Groove</option><option value="fire">Fire</option></select>
<select id="ageBand"><option value="">All ages</option><option>5-12</option><option>13-17</option><option>18-29</option><option>30-39</option><option>40-49</option><option>50-59</option><option>60-69</option><option>70-79</option><option>80+</option></select>
<select id="gender"><option value="">All genders</option><option value="F">Female</option><option value="M">Male</option><option value="O">Other</option><option value="NA">Not stated</option></select>
<span class="live" id="live">● LIVE</span><a class="btn ghost" href="__EXEC__?action=export" title="Anonymised CSV: one row per run">⤓ CSV</a><a class="btn ghost" href="__EXEC__?action=stats" title="All dashboard aggregates as JSON">{ } JSON</a><a class="btn" href="__GAME__">▶ Play the game</a></div></header>
<main>
<div class="card kpi"><span>SONG RUNS</span><b id="k1">–</b><i id="k1s"></i></div>
<div class="card kpi"><span>PLAYERS</span><b id="k2">–</b><i>unique players</i></div>
<div class="card kpi"><span>AVG ACCURACY</span><b id="k3">–</b><i>best score <span id="k3s"></span></i></div>
<div class="card kpi"><span>REFLEX (MEDIAN)</span><b id="k4">–</b><i id="k4s"></i></div>
<div class="card kpi"><span>RETURNING PLAYERS</span><b id="k5">–</b><i id="k5s"></i></div>
<div class="card kpi"><span>RUNS PER PLAYER</span><b id="k6">–</b><i>average</i></div>
<div class="card kpi"><span>COMPLETION RATE</span><b id="k7">–</b><i>runs finished without failing</i></div>
<div class="card kpi"><span>FULL COMBOS</span><b id="k8">–</b><i>no miss, no wrong pad</i></div>
<div class="card w8"><h3>SONG RUNS PER DAY</h3><div id="c1" class="chart"></div></div>
<div class="card w4"><h3>DIFFICULTY MIX</h3><div id="c2" class="chart"></div></div>
<div class="card w6"><h3>ACCURACY BY AGE BAND &amp; GENDER</h3><div id="c3" class="chart"></div></div>
<div class="card w6"><h3>REACTION TIME BY AGE BAND</h3><div id="c4" class="chart"></div></div>
<div class="card w6"><h3>RHYTHM &amp; COORDINATION INDEX</h3><div id="c5" class="chart"></div><div class="note">Heuristic engagement composites (0–100), not validated psychometric scales.</div></div>
<div class="card w6"><h3>ACCURACY DISTRIBUTION</h3><div id="c6" class="chart"></div></div>
<div class="card w6"><h3>HIT RATE PER PAD</h3><div id="c7" class="chart"></div><div class="note" id="consent"></div></div>
<div class="card w6"><h3>TIMING BY AGE BAND</h3><div id="c8" class="chart"></div><div class="note">Mean asynchrony: negative = early. SD = timing variability.</div></div>
<div class="card w6"><h3>TOP 10 PLAYERS</h3><table id="top"></table></div>
<div class="card w6"><h3>WHEN DO PEOPLE PLAY?</h3><table class="hm" id="heat"></table></div>
<div class="card w12"><h3>WHERE IN THE SONG DO PLAYERS STRUGGLE? (ACCURACY BY SECTION)</h3><div id="c9" class="chart"></div><div class="note">Mean accuracy per song section, in song order. The Bridge changes to a half-time feel (kick on 1, the “and” of 2 and of 4).</div></div>
<div class="card w6"><h3>ACCURACY ACROSS THE SONG</h3><div id="c10" class="chart"></div><div class="note">Mean accuracy in 10 equal time slices — fatigue / warm-up effects.</div></div>
<div class="card w6"><h3>LEARNING CURVE</h3><div id="c11" class="chart"></div><div class="note">Mean accuracy by a player’s 1st, 2nd … 10th+ run of this song, per difficulty.</div></div>
<div class="card w6"><h3>EARLY OR LATE? TIMING PER PAD</h3><div id="c12" class="chart"></div><div class="note">Mean hit error per pad (− = early, + = late) and its spread (SD).</div></div>
<div class="card w6"><h3>COMPLETION BY DIFFICULTY</h3><div id="c13" class="chart"></div></div>
<div class="card w4"><h3>DEVICE</h3><div id="c14" class="chart"></div></div>
<div class="card w4"><h3>INPUT METHOD</h3><div id="c15" class="chart"></div></div>
<div class="card w4"><h3>OPERATING SYSTEM</h3><div id="c16" class="chart"></div></div>
<div class="card w12"><h3>EXPECTED PAD → PAD ACTUALLY HIT</h3><table class="hm" id="conf"></table><div class="note">Green diagonal = correct pad. Bright off-diagonal cells = pads that get mixed up. For fun and engagement — not a medical or clinical assessment. Updated <span id="upd"></span>.</div></div>
</main>
<script>
var LANE_COL={kick:'#FF7A1A',snare:'#FF3B5C',hihat:'#FFD23F',tom:'#3D8BFF',cymbal:'#2EE6A6'};
var BASE={backgroundColor:'transparent',legend:{position:'bottom',textStyle:{color:'#a9a3cf'}},chartArea:{left:48,top:16,width:'86%',height:'70%'},
 hAxis:{textStyle:{color:'#a9a3cf'},gridlines:{color:'#2a2550'},baselineColor:'#3a3466'},vAxis:{textStyle:{color:'#a9a3cf'},gridlines:{color:'#2a2550'},baselineColor:'#3a3466',minValue:0},
 animation:{duration:600,easing:'out',startup:true},fontName:'Segoe UI'};
function opt(o){var r=JSON.parse(JSON.stringify(BASE));for(var k in o)r[k]=o[k];return r;}
function f(){return{period:val('period'),difficulty:val('difficulty'),ageBand:val('ageBand'),gender:val('gender')};}
function val(id){return document.getElementById(id).value;}
function n(v){return v==null||v===''?null:v;}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function load(){document.getElementById('live').textContent='◌ SYNCING';google.script.run.withSuccessHandler(draw).withFailureHandler(function(e){document.getElementById('live').textContent='○ OFFLINE';}).getDashData(f());}
function draw(d){
 var K=d.kpi;document.getElementById('live').textContent='● LIVE';
 document.getElementById('k1').textContent=K.plays.toLocaleString();document.getElementById('k1s').textContent=K.today+' today';
 document.getElementById('k2').textContent=K.players.toLocaleString();
 document.getElementById('k3').textContent=K.avgAcc==null?'–':K.avgAcc+'%';document.getElementById('k3s').textContent=K.bestScore?K.bestScore.toLocaleString():'–';
 document.getElementById('k4').textContent=K.medSrt==null?'–':K.medSrt+' ms';document.getElementById('k4s').textContent='simple · 4-choice '+(K.medCrt==null?'–':K.medCrt+' ms')+' · '+K.tests+' tests';
 document.getElementById('upd').textContent=d.updated;document.getElementById('consent').textContent='From '+K.consented+' consented session records.';
 var G=google.visualization,t;
 t=new G.DataTable();t.addColumn('string','Day');t.addColumn('number','Runs');t.addRows(d.daily);
 new G.AreaChart(document.getElementById('c1')).draw(t,opt({colors:['#FF5FA2'],areaOpacity:.3,legend:{position:'none'},lineWidth:3,pointSize:4}));
 t=G.arrayToDataTable([['Difficulty','Runs'],['Gentle',d.byDiff.gentle],['Groove',d.byDiff.groove],['Fire',d.byDiff.fire]]);
 new G.PieChart(document.getElementById('c2')).draw(t,opt({pieHole:.6,colors:['#2EE6A6','#3D8BFF','#FF3B5C'],pieSliceBorderColor:'#14102a',pieSliceText:'none',legend:{position:'bottom',textStyle:{color:'#a9a3cf'}},chartArea:{width:'90%',height:'78%'}}));
 var rows=[['Age band','Male','Female','All']];d.bands.forEach(function(b){rows.push([b.band,n(b.accM),n(b.accF),n(b.accAll)]);});
 new G.ColumnChart(document.getElementById('c3')).draw(G.arrayToDataTable(rows),opt({colors:['#3D8BFF','#FF5FA2','#2EE6A6'],vAxis:{minValue:0,maxValue:100,textStyle:{color:'#a9a3cf'},gridlines:{color:'#2a2550'}}}));
 rows=[['Age band','Simple RT (ms)','4-choice RT (ms)']];d.bands.forEach(function(b){rows.push([b.band,n(b.srt),n(b.crt)]);});
 new G.LineChart(document.getElementById('c4')).draw(G.arrayToDataTable(rows),opt({colors:['#FFD23F','#FF7A1A'],pointSize:8,lineWidth:3,interpolateNulls:true}));
 rows=[['Age band','Rhythm Index','Coordination Index']];d.bands.forEach(function(b){rows.push([b.band,n(b.rhythm),n(b.coord)]);});
 new G.ColumnChart(document.getElementById('c5')).draw(G.arrayToDataTable(rows),opt({colors:['#FF5FA2','#2EE6A6'],vAxis:{minValue:0,maxValue:100,textStyle:{color:'#a9a3cf'},gridlines:{color:'#2a2550'}}}));
 rows=[['Accuracy','Runs']];d.accHist.forEach(function(c,i){rows.push([(i*10)+'–'+(i*10+10)+'%',c]);});
 new G.ColumnChart(document.getElementById('c6')).draw(G.arrayToDataTable(rows),opt({colors:['#3D8BFF'],legend:{position:'none'},bar:{groupWidth:'90%'}}));
 rows=[['Pad','Hit rate %',{role:'style'}]];d.padAcc.forEach(function(p){rows.push([p.name,n(p.acc),LANE_COL[p.lane]]);});
 new G.BarChart(document.getElementById('c7')).draw(G.arrayToDataTable(rows),opt({legend:{position:'none'},hAxis:{minValue:0,maxValue:100,textStyle:{color:'#a9a3cf'},gridlines:{color:'#2a2550'}},chartArea:{left:70,top:10,width:'78%',height:'80%'}}));
 rows=[['Age band','Mean asynchrony (ms)','Timing SD (ms)']];d.bands.forEach(function(b){rows.push([b.band,n(b.async),n(b.sd)]);});
 new G.ColumnChart(document.getElementById('c8')).draw(G.arrayToDataTable(rows),opt({colors:['#FFD23F','#3D8BFF'],vAxis:{textStyle:{color:'#a9a3cf'},gridlines:{color:'#2a2550'}}}));
 var h='<tr><th>#</th><th>Player</th><th>Age</th><th>Best score</th><th>Best acc.</th><th>Runs</th></tr>';
 d.top.forEach(function(p,i){h+='<tr><td class="r'+(i+1)+'">'+(i+1)+'</td><td>'+esc(p.nickname)+'</td><td>'+esc(p.ageBand)+'</td><td>'+p.score.toLocaleString()+'</td><td>'+p.acc.toFixed(1)+'%</td><td>'+p.plays+'</td></tr>';});
 document.getElementById('top').innerHTML=d.top.length?h:'<tr><td>No runs yet for these filters.</td></tr>';
 var mx=1;d.heat.forEach(function(r){r.forEach(function(v){if(v>mx)mx=v;});});var days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
 h='<tr><th></th>';for(var x=0;x<24;x+=3)h+='<th colspan="3">'+(x<10?'0':'')+x+'h</th>';h+='</tr>';
 d.heat.forEach(function(r,i){h+='<tr><th>'+days[i]+'</th>';r.forEach(function(v){h+='<td style="background:rgba(255,95,162,'+(v?0.12+0.88*v/mx:0.04)+')">'+(v||'')+'</td>';});h+='</tr>';});
 document.getElementById('heat').innerHTML=h;
 var L=d.lanes,names={kick:'Kick',snare:'Snare',hihat:'Hi-hat',tom:'Tom',cymbal:'Cymbal',none:'Missed'};h='<tr><th>Expected ↓ / Hit →</th>';L.concat(['none']).forEach(function(p){h+='<th>'+names[p]+'</th>';});h+='</tr>';
 L.forEach(function(e){var tot=0;L.concat(['none']).forEach(function(p){tot+=d.conf[e][p];});h+='<tr><th style="color:'+LANE_COL[e]+'">'+names[e]+'</th>';
  L.concat(['none']).forEach(function(p){var v=d.conf[e][p],a=tot?v/tot:0,c=p===e?'46,230,166':'255,59,92';h+='<td style="background:rgba('+c+','+(v?0.12+0.85*a:0.03)+')">'+(v?v.toLocaleString():'')+'</td>';});h+='</tr>';});
 document.getElementById('conf').innerHTML=h;
 // ---- v1.2 panels ----
 var pc=function(v,s){return v==null?'–':v+(s||'');};
 document.getElementById('k5').textContent=pc(K.returning);document.getElementById('k5s').textContent='played on 2+ days';
 document.getElementById('k6').textContent=pc(K.runsPerPlayer);document.getElementById('k7').textContent=pc(K.completion,'%');document.getElementById('k8').textContent=pc(K.fullCombos);
 rows=[['Section','Accuracy %',{role:'style'},{role:'annotation'}]];d.sections.forEach(function(s){rows.push([s.name,s.acc,/bridge/i.test(s.name)?'#C9A7FF':/chorus/i.test(s.name)?'#FF5FA2':'#3D8BFF',s.acc==null?'':s.acc+'%']);});
 if(rows.length>1)new G.ColumnChart(document.getElementById('c9')).draw(G.arrayToDataTable(rows),opt({legend:{position:'none'},annotations:{textStyle:{color:'#fff',fontSize:10}},vAxis:{minValue:0,maxValue:100,textStyle:{color:'#a9a3cf'},gridlines:{color:'#2a2550'}}}));
 else document.getElementById('c9').innerHTML='<div class="note">No consented runs yet.</div>';
 rows=[['Song position','Accuracy %']].concat(d.timeline);new G.LineChart(document.getElementById('c10')).draw(G.arrayToDataTable(rows),opt({colors:['#FF5FA2'],legend:{position:'none'},lineWidth:3,pointSize:6,curveType:'function',interpolateNulls:true,vAxis:{minValue:0,maxValue:100,textStyle:{color:'#a9a3cf'},gridlines:{color:'#2a2550'}}}));
 rows=[['Run #','Gentle','Groove','Fire']].concat(d.learning);new G.LineChart(document.getElementById('c11')).draw(G.arrayToDataTable(rows),opt({colors:['#2EE6A6','#3D8BFF','#FF3B5C'],lineWidth:3,pointSize:6,interpolateNulls:true,vAxis:{minValue:0,maxValue:100,textStyle:{color:'#a9a3cf'},gridlines:{color:'#2a2550'}}}));
 rows=[['Pad','Mean error (ms)','Spread SD (ms)']];d.padTiming.forEach(function(p){rows.push([p.name,n(p.meanErr),n(p.sdErr)]);});
 new G.ColumnChart(document.getElementById('c12')).draw(G.arrayToDataTable(rows),opt({colors:['#FFD23F','#C9A7FF'],vAxis:{textStyle:{color:'#a9a3cf'},gridlines:{color:'#2a2550'}}}));
 rows=[['Difficulty','Finished','Failed','Full combo']];d.completion.forEach(function(c){rows.push([c.d[0].toUpperCase()+c.d.slice(1),c.finished,c.failed,c.fc]);});
 new G.ColumnChart(document.getElementById('c13')).draw(G.arrayToDataTable(rows),opt({colors:['#2EE6A6','#FF3B5C','#FFD23F']}));
 var pie=function(id,arr,cols){var t=[['Kind','Runs']].concat(arr);if(arr.length)new G.PieChart(document.getElementById(id)).draw(G.arrayToDataTable(t),opt({pieHole:.55,colors:cols,pieSliceBorderColor:'#14102a',chartArea:{width:'90%',height:'76%'}}));else document.getElementById(id).innerHTML='<div class="note">No data yet.</div>';};
 pie('c14',d.devices,['#FF5FA2','#C9A7FF','#3D8BFF','#2EE6A6']);pie('c15',d.inputs,['#FFD23F','#FF7A1A','#2EE6A6','#3D8BFF']);pie('c16',d.oses,['#3D8BFF','#2EE6A6','#FF5FA2','#C9A7FF','#FFD23F','#FF7A1A','#D9DEE8']);
}
google.charts.load('current',{packages:['corechart']});google.charts.setOnLoadCallback(load);
['period','difficulty','ageBand','gender'].forEach(function(id){document.getElementById(id).addEventListener('change',load);});
setInterval(function(){if(!document.hidden)load();},60000);
</script></body></html>`;

// ================================================================== PUBLIC ANONYMISED EXPORT (?action=export)
/** One row per consented run (kind=runs, default) or per Reflex/Beat-Sync test (kind=tests).
 *  Anonymised: no nickname, no exact age, no user agent; playerKey = salted SHA-256 of the player id (stable, not reversible).
 *  Hidden (moderated) sessions are excluded. Columns are flat so the file opens directly in Excel / R / Python / Power BI. */
function exportCsv_(p) {
  const kind = p.kind === 'tests' ? 'tests' : 'runs', tz = SS_().getSpreadsheetTimeZone();
  const hidden = {}; table_('Leaderboard').rows.forEach(r => { if (isTrue_(r.hidden)) hidden[r.sessionId] = 1; });
  const salt = salt_(), key = id => { const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + id, Utilities.Charset.UTF_8); return d.slice(0, 6).map(b => ('0' + (b & 255).toString(16)).slice(-2)).join(''); };
  const rows = table_('Sessions').rows.filter(r => r.sessionId && !hidden[r.sessionId] && (kind === 'runs' ? SONG_DIFFS[r.difficulty] : (r.difficulty === 'reflex' || r.difficulty === 'beatsync')));
  const esc = v => { v = v == null ? '' : v instanceof Date ? Utilities.formatDate(v, tz, "yyyy-MM-dd'T'HH:mm") : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const common = ['ts', 'playerKey', 'ageBand', 'gender', 'hand', 'musicExp'];
  let head, line;
  if (kind === 'tests') { head = common.concat(['test', 'srtMedianMs', 'crtMedianMs', 'crtErrRate', 'beatsyncSd600Ms', 'deviceType', 'os', 'inputMethod']);
    line = r => [r.ts, key(r.playerId), r.ageBand, r.gender, r.hand, r.musicExp, r.difficulty, r.srtMedian, r.crtMedian, r.crtErr, r.beatsyncSd600, r.deviceType, r.os, r.inputMethod]; }
  else {
    const secNames = {}; rows.forEach(r => { try { JSON.parse(r.sectionsJSON || '[]').forEach(s => { if (!(s.name in secNames) || s.i < secNames[s.name]) secNames[s.name] = s.i; }); } catch (e) {} });
    const secs = Object.keys(secNames).sort((a, b) => secNames[a] - secNames[b]);
    head = common.concat(['songId', 'difficulty', 'runNumber', 'score', 'maxScore', 'scorePct', 'grade', 'stars', 'accuracy', 'maxCombo', 'fullCombo', 'failed', 'completionPct',
      'perfect', 'great', 'good', 'miss', 'wrong', 'stray', 'meanAsyncMs', 'sdAsyncMs', 'R', 'chordSimulMs', 'limbIndependence', 'rhythmIndex', 'coordinationIndex', 'heartbeatCount',
      'deviceType', 'os', 'browser', 'inputMethod', 'orientation', 'lang', 'localHour', 'weekday', 'pad4', 'noteSpeed', 'calibrated', 'appVersion'])
      .concat(LANES.map(l => l + '_hitRate')).concat(LANES.map(l => l + '_meanErrMs'))
      .concat(['t00_10', 't10_20', 't20_30', 't30_40', 't40_50', 't50_60', 't60_70', 't70_80', 't80_90', 't90_100']).concat(secs.map(s => 'sec_' + s.replace(/[^A-Za-z0-9]+/g, '_')));
    line = r => { let pp = {}, tl = [], sm = {}; try { pp = JSON.parse(r.perPadJSON || '{}'); } catch (e) {} try { tl = JSON.parse(r.timelineJSON || '[]'); } catch (e) {} try { JSON.parse(r.sectionsJSON || '[]').forEach(s => sm[s.name] = s.acc); } catch (e) {}
      return [r.ts, key(r.playerId), r.ageBand, r.gender, r.hand, r.musicExp, r.songId, r.difficulty, r.runNumber, r.score, r.maxScore, r.scorePct, r.grade, r.stars, r.accuracy, r.maxCombo, r.fullCombo, r.failed, r.completionPct,
        r.perfect, r.great, r.good, r.miss, r.wrong, r.stray, r.meanAsyncMs, r.sdAsyncMs, r.R, r.chordSimulMs, r.limbIndependence, r.rhythmIndex, r.coordinationIndex, r.heartbeatCount,
        r.deviceType, r.os, r.browser, r.inputMethod, r.orientation, r.lang, r.localHour, r.weekday, r.pad4, r.noteSpeed, r.calibrated, r.appVersion]
        .concat(LANES.map(l => pp[l] && pp[l].notes ? r1_(pp[l].hits / pp[l].notes * 100) : '')).concat(LANES.map(l => pp[l] && pp[l].meanErrMs != null ? r1_(pp[l].meanErrMs) : ''))
        .concat([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => tl[i] == null ? '' : tl[i])).concat(secs.map(s => sm[s] == null ? '' : sm[s])); };
  }
  const csv = [head.join(',')].concat(rows.map(r => line(r).map(esc).join(','))).join('\r\n');
  return ContentService.createTextOutput('\ufeff' + csv).setMimeType(ContentService.MimeType.CSV).downloadAsFile('intellicare_' + SONG_ID + '_' + kind + '.csv');
}
function salt_() { const pr = PropertiesService.getScriptProperties(); let s = pr.getProperty('exportSalt'); if (!s) { s = Utilities.getUuid(); pr.setProperty('exportSalt', s); } return s; }

// ================================================================== web app entry points
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action === 'dashboard') return dashboardPage_();
    if (p.action === 'leaderboard') return json_(getBoard_(p));
    if (p.action === 'norms') return json_(getNorms_(p));
    if (p.action === 'stats') return json_(getDashData({ period: p.period || '', difficulty: p.difficulty || '', ageBand: p.ageBand || '', gender: p.gender || '' }));
    if (p.action === 'export') return exportCsv_(p);
    return json_({ ok: true, version: ver_(), season: cfg_('currentSeason'), server: SERVER_VERSION });
  } catch (err) { return json_({ ok: false, error: String(err) }); }
}
function doPost(e) {
  const lock = LockService.getScriptLock(); let body = null;
  try {
    body = JSON.parse(e.postData.contents); if (body.action !== 'submit') throw 'bad action';
    lock.waitLock(10000);
    const v = validate_(body.entry); if (!v.ok) { log_(body, v.reason); return json_({ ok: false, error: v.reason }); }
    const en = v.entry;
    if (seen_(en.sessionId)) return json_({ ok: true, dedup: true, ranks: ranks_(en) });
    if (body.record) { body.record.sessionId = en.sessionId; body.record.playerId = en.playerId; body.record.nickname = en.nickname; appendSession_(body.record); }
    touchPlayer_(en); append_('Leaderboard', Object.assign({}, en, { hidden: false })); bumpVersion_();
    return json_({ ok: true, ranks: ranks_(en) });
  } catch (err) { try { log_(body || {}, 'exception: ' + err); } catch (x) {} return json_({ ok: false, error: String(err) }); }
  finally { try { lock.releaseLock(); } catch (x) {} }
}
