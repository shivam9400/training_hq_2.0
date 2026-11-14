/**
 * Training HQ (friend edition): Strava-synced training dashboard (Google Apps Script).
 * Bound to a Google Sheet. Files in this project: Code.gs (this file) and Index.html.
 *
 * What it does
 *  - Builds the day-by-day plan in a Sheet (Plan tab); every date can hold several sessions ("slots").
 *  - Pulls your activities from Strava and fills the Strava columns by date.
 *  - Serves a web-app dashboard (Index.html): log check-ins, mark sessions, edit / add / swap sessions.
 *  - Applies simple rules to your check-ins (readiness, load, safety keywords).
 *  - Settings, weekly focus lines and HR tests live in their own tabs, so you can change them without code.
 */

// ------------------------------------------------------------------ settings
var TZ = 'Asia/Kolkata';
var CONFIG = {
  name: 'Athlete',
  appTitle: 'My Training HQ',
  appSub: '',
  timezone: 'Asia/Kolkata',
  useStrava: true,                       // false = log by hand only
  smogReminder: false,                   // Nov-Jan air-quality reminder
  planStart: '',
  stravaAfter: '',               // sync activities from this date (blank = two weeks before the first plan date)
  testsNote: '',
  // Must be on the callback domain set in your Strava app (script.google.com).
  // If you ever switch the app's domain to localhost, change this to 'http://localhost'.
  redirectUri: 'https://script.google.com/macros/d/training-hq/usercallback',
  baselineRestHR: 60, flagRestHR: 0,    // resting HR at/above this = recovery flag (0 = off)
  baselineHRV: 0, flagHRV: 0,           // HRV at/below this = recovery flag (0 = off)
  flagSleep: 6,                          // sleep below this (hours) = flag
  flagSoreness: 4,                       // soreness at/above this (1-5) = flag
  easyHRCap: 0, easyHRWarn: 0            // easy runs averaging above this are "running hot" (0 = off)
};
// [config key, label shown in the Settings tab, default, note]
var SETTINGS_DEF = [
  ['appTitle', 'Dashboard name', 'My Training HQ', 'Shown at the top of the dashboard'],
  ['appSub', 'Season label', '', 'Small text next to the name'],
  ['name', 'Your first name', 'Athlete', 'Used in the greeting'],
  ['timezone', 'Time zone', 'Asia/Kolkata', 'e.g. Asia/Kolkata, Europe/London, America/New_York'],
  ['useStrava', 'Use Strava sync (Yes/No)', 'Yes', 'Set to No to log sessions by hand only'],
  ['smogReminder', 'Show air-quality reminder Nov-Jan (Yes/No)', 'No', 'Useful in cities with winter smog'],
  ['baselineRestHR', 'Baseline resting HR', 60, 'Your normal morning resting HR'],
  ['flagRestHR', 'Resting HR flag at or above', 0, 'One flag = easy day, two flags = rest. 0 = switch off'],
  ['baselineHRV', 'Baseline HRV (ms)', 0, 'Your normal HRV (0 = not tracked)'],
  ['flagHRV', 'HRV flag at or below', 0, 'Well below your baseline. 0 = switch off'],
  ['flagSleep', 'Sleep flag below (hours)', 6, ''],
  ['flagSoreness', 'Soreness flag at or above (1-5)', 4, ''],
  ['easyHRCap', 'Easy run HR cap', 0, 'Easy runs should stay at or below this. 0 = switch off'],
  ['easyHRWarn', 'Easy run warning above', 0, 'Easy runs averaging above this raise a coach flag. 0 = switch off'],
  ['testsNote', 'Checkpoint note (optional)', '', 'Shown under the fitness checkpoints on the Progress tab'],
  ['stravaAfter', 'Strava sync start date', '', 'yyyy-mm-dd; earlier activities are ignored. Blank = two weeks before your first plan date']
];
var BOOL_SETTINGS = ['useStrava', 'smogReminder'];
var NUMERIC_SETTINGS = ['baselineRestHR', 'flagRestHR', 'baselineHRV', 'flagHRV', 'flagSleep', 'flagSoreness', 'easyHRCap', 'easyHRWarn'];

var TYPES = ['Run', 'Strength', 'Race', 'Rest'];
// Plan tab layout (v2). Plan text = columns 1-12, Strava = 13-19, your own entries = 20-27.
var COL = { DATE: 1, DAY: 2, SLOT: 3, WK: 4, PHASE: 5, TYPE: 6, SESSION: 7, DETAILS: 8, TARGET: 9, PMIN: 10, PKM: 11, LOCK: 12,
  AUTO: 13, AKM: 14, AMIN: 15, AHR: 16, MHR: 17, PACE: 18, LINK: 19,
  OVR: 20, RHR: 21, HRV: 22, SLEEP: 23, SORE: 24, RPE: 25, TESTHR: 26, NOTES: 27 };
var NCOLS = 27;
var HEADERS = ['Date', 'Day', 'Slot', 'Wk', 'Phase', 'Type', 'Session', 'What to do', 'Target (HR / pace)', 'Planned min', '≈ km', 'Locked (✎ = my edit)',
  'Strava status', 'Actual km', 'Actual min', 'Avg HR', 'Max HR', 'Pace /km', 'Strava link',
  'Your status (override)', 'Resting HR', 'HRV (ms)', 'Sleep (h)', 'Soreness (1-5)', 'RPE (1-10)', 'Test / race avg HR', 'Notes'];
var RUN_SPORTS = ['Run', 'TrailRun', 'VirtualRun'];
var SAFETY_WORDS = ['chest', 'dizz', 'faint', 'palpitat', 'breathless', 'short of breath', 'sharp pain', 'swelling', 'swollen',
  'numb', 'wound', 'bleed', 'fever', 'blackout'];
var CAUTION_WORDS = ['heavy', 'tight', 'sore', 'niggle', 'tired', 'exhaust', 'pain', 'ache', 'cramp'];

// ------------------------------------------------------------------ menu
function onOpen() {
  var m = SpreadsheetApp.getUi().createMenu(EDITION.menu)
    .addItem('1. Set up sheets (first time)', 'setupSheets')
    .addItem('2. Connect Strava: step A', 'connectStravaStepA')
    .addItem('3. Connect Strava: step B (paste address)', 'connectStravaStepB')
    .addItem('4. Sync Strava now', 'syncStravaFromMenu')
    .addItem('5. Auto-sync every 30 minutes', 'installAutoSync')
    .addSeparator()
    .addItem('Health Sync: 1. Set Drive folder', 'healthConfigureFolder')
    .addItem('Health Sync: 2. Preview exports', 'healthPreviewMenu')
    .addItem('Health Sync: 3. Import CSV files', 'healthImportMenu')
    .addItem('Health Sync: 4. Auto-import every 30 min', 'healthInstallTrigger')
    .addSeparator()
    .addItem('Build plan from "Plan input"', 'buildPlanFromInput');
  if (!EDITION.simple) m.addItem('Update plan text (keeps logs and your edits)', 'refreshPlanText');
  m.addItem('Check plan for problems', 'checkPlan')
    .addItem('Check dashboard data (diagnostics)', 'checkDashboard')
    .addItem('Show dashboard link', 'showWebAppUrl')
    .addToUi();
}

function getSS_() {
  var id = PropertiesService.getScriptProperties().getProperty('SS_ID');
  if (id) return SpreadsheetApp.openById(id);
  return SpreadsheetApp.getActive();
}

// ------------------------------------------------------------------ small helpers
function pad2_(n) { return (n < 10 ? '0' : '') + n; }
function num_(v) { if (v === '' || v === null || v === undefined) return null; var n = Number(v); return isNaN(n) ? null : n; }
function round1_(x) { return Math.round(x * 10) / 10; }
function fmtPace_(secPerKm) { var s = Math.round(secPerKm); return Math.floor(s / 60) + ':' + pad2_(s % 60); }
function isoToDay_(iso) { var p = String(iso).split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
function dayToIso_(n) { var d = new Date(n * 86400000); return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate()); }
function dowName_(iso) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(isoToDay_(iso) * 86400000).getUTCDay()]; }
function todayIso_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function isRun_(a) { return RUN_SPORTS.indexOf(a.sport) >= 0; }
function effStatus_(p) { return p.ovr || p.auto || ''; }
// Pace must look like 9:45. If Sheets turned it into a time value, work it out again from distance and minutes.
function cleanPace_(pace, km, min) {
  var s = String(pace || '');
  if (/^\d{1,2}:\d{2}$/.test(s)) return s;
  if (km > 0 && min > 0) return fmtPace_(min * 60 / km);
  return '';
}
function sumBy_(arr, key) { var s = 0; arr.forEach(function (x) { s += (Number(x[key]) || 0); }); return s; }
// A cell that Sheets turned into a Date is converted back to yyyy-MM-dd; everything else is shown as text.
function toIso_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v);
}
// google.script.run returns NOTHING if the result contains a Date, undefined or NaN. This makes the data safe.
function jsonSafe_(v) {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return Utilities.formatDate(v, TZ, "yyyy-MM-dd'T'HH:mm:ss");
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (Array.isArray(v)) return v.map(jsonSafe_);
  if (typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { o[k] = jsonSafe_(v[k]); }); return o; }
  return v;
}
function countUnsafe_(v) {
  if (v === undefined) return 1;
  if (v instanceof Date) return 1;
  if (typeof v === 'number') return isFinite(v) ? 0 : 1;
  if (Array.isArray(v)) return v.reduce(function (s, x) { return s + countUnsafe_(x); }, 0);
  if (v && typeof v === 'object') return Object.keys(v).reduce(function (s, k) { return s + countUnsafe_(v[k]); }, 0);
  return 0;
}

// ------------------------------------------------------------------ settings tab -> CONFIG
function applySettingsRows_(rows) {      // rows: [[label, value], ...] (display values)
  var byLabel = {};
  rows.forEach(function (r) { byLabel[String(r[0]).trim()] = String(r[1]).trim(); });
  SETTINGS_DEF.forEach(function (d) {
    var raw = byLabel[d[1]];
    if (raw === undefined || raw === '') return;
    if (NUMERIC_SETTINGS.indexOf(d[0]) >= 0) { var n = Number(raw); if (!isNaN(n)) CONFIG[d[0]] = n; }
    else if (BOOL_SETTINGS.indexOf(d[0]) >= 0) CONFIG[d[0]] = /^(y|yes|true|on|1)$/i.test(raw);
    else if (d[0] === 'timezone') { try { Utilities.formatDate(new Date(), raw, 'yyyy'); CONFIG.timezone = raw; TZ = raw; } catch (e) { /* unknown time zone: keep the old one */ } }
    else CONFIG[d[0]] = raw;
  });
  return CONFIG;
}
function loadConfig_() {
  var sh = getSS_().getSheetByName('Settings');
  if (sh && sh.getLastRow() >= 2) applySettingsRows_(sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues());
  return CONFIG;
}

// ------------------------------------------------------------------ sheet setup
function setupSheets() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var existing = ss.getSheetByName('Plan');
  if (existing && existing.getLastRow() > 1) {
    var r = ui.alert('Plan sheet already exists',
      'Running setup again ERASES your logs. To change the plan text only, use "Update plan text (keeps logs and your edits)". Erase and rebuild anyway?',
      ui.ButtonSet.YES_NO);
    if (r !== ui.Button.YES) return;
  }
  ss.setSpreadsheetTimeZone(TZ);
  PropertiesService.getScriptProperties().setProperty('SS_ID', ss.getId());
  buildPlanSheet_(ss);
  buildStravaSheet_(ss);
  buildRacesSheet_(ss);
  buildGoalsSheet_(ss);
  buildSettingsSheet_(ss);
  buildWeeksSheet_(ss);
  buildTestsSheet_(ss);
  buildPlanInputSheet_(ss);
  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
  ss.setActiveSheet(ss.getSheetByName('Plan'));
  ui.alert('Sheets ready', EDITION.simple ? 'Next: fill in the Settings tab, paste your plan into the "Plan input" tab, then use the menu item: Build plan from "Plan input".' : 'Next: Training HQ → Connect Strava: step A.', ui.ButtonSet.OK);
}

function planRowsFromPlan_() {
  return PLAN.map(function (r) {
    return [r[0], dowName_(r[0]), 1, r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8] === null ? '' : r[8], '',
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
  });
}

function buildPlanSheet_(ss, rowsOpt) {
  var sh = ss.getSheetByName('Plan') || ss.insertSheet('Plan');
  sh.clear();
  sh.clearConditionalFormatRules();
  if (sh.getMaxColumns() < NCOLS) sh.insertColumnsAfter(sh.getMaxColumns(), NCOLS - sh.getMaxColumns());
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
  var rows = rowsOpt || planRowsFromPlan_();
  var n = rows.length;
  sh.getRange(1, 1, 1, NCOLS).setValues([HEADERS]);
  if (n) {
    sh.getRange(2, 1, n, 1).setNumberFormat('@');
    sh.getRange(2, COL.PACE, n, 1).setNumberFormat('@');
    sh.getRange(2, 1, n, NCOLS).setValues(rows);
  }
  var head = sh.getRange(1, 1, 1, NCOLS);
  head.setFontWeight('bold').setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('center');
  sh.getRange(1, 1, 1, COL.LOCK).setBackground('#1f4e5f').setFontColor('#ffffff');
  sh.getRange(1, COL.AUTO, 1, 7).setBackground('#2b6cb0').setFontColor('#ffffff');
  sh.getRange(1, COL.OVR, 1, 8).setBackground('#fde68a').setFontColor('#1f2937');
  sh.setRowHeight(1, 40);
  var m = Math.max(n, 1);
  sh.getRange(2, COL.OVR, m, 8).setBackground('#fffbea');
  sh.getRange(2, COL.AUTO, m, 7).setBackground('#eef5fb');
  var widths = [95, 45, 40, 35, 130, 75, 170, 480, 190, 70, 55, 90, 95, 70, 70, 60, 60, 70, 200, 110, 80, 70, 70, 90, 80, 100, 300];
  for (var i = 0; i < widths.length; i++) sh.setColumnWidth(i + 1, widths[i]);
  sh.getRange(2, 1, m, NCOLS).setVerticalAlignment('top');
  [COL.SESSION, COL.DETAILS, COL.TARGET, COL.NOTES].forEach(function (c) { sh.getRange(2, c, m, 1).setWrap(true); });
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);
  function dv(col, builder) { sh.getRange(2, col, m, 1).setDataValidation(builder.setAllowInvalid(false).build()); }
  dv(COL.TYPE, SpreadsheetApp.newDataValidation().requireValueInList(TYPES, true));
  dv(COL.LOCK, SpreadsheetApp.newDataValidation().requireValueInList(['✎', 'Y'], true));
  dv(COL.OVR, SpreadsheetApp.newDataValidation().requireValueInList(['Done', 'Partial', 'Skipped'], true));
  dv(COL.RHR, SpreadsheetApp.newDataValidation().requireNumberBetween(30, 200));
  dv(COL.HRV, SpreadsheetApp.newDataValidation().requireNumberBetween(5, 300));
  dv(COL.SLEEP, SpreadsheetApp.newDataValidation().requireNumberBetween(0, 16));
  dv(COL.SORE, SpreadsheetApp.newDataValidation().requireNumberBetween(1, 5));
  dv(COL.RPE, SpreadsheetApp.newDataValidation().requireNumberBetween(1, 10));
  dv(COL.TESTHR, SpreadsheetApp.newDataValidation().requireNumberBetween(60, 230));
  var rules = [];
  function textRule(colLetter, text, bg) {
    return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text).setBackground(bg)
      .setRanges([sh.getRange(colLetter + '2:' + colLetter + (m + 1))]).build();
  }
  ['M', 'T'].forEach(function (c) {          // Strava status (M) and your override (T)
    rules.push(textRule(c, 'Done', '#b7e1cd'));
    rules.push(textRule(c, 'Partial', '#fde68a'));
    rules.push(textRule(c, 'Short', '#fde68a'));
    rules.push(textRule(c, 'Missed', '#f4b6b6'));
    rules.push(textRule(c, 'Skipped', '#f4b6b6'));
    rules.push(textRule(c, 'Extra run', '#cfe2ff'));
  });
  rules.push(textRule('F', 'Race', '#ffe699'));
  rules.push(textRule('F', 'Run', '#ddebf7'));
  rules.push(textRule('F', 'Strength', '#e4dfec'));
  rules.push(textRule('F', 'Rest', '#ededed'));
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenCellNotEmpty().setBackground('#ffd8a8')
    .setRanges([sh.getRange('L2:L' + (m + 1))]).build());
  sh.setConditionalFormatRules(rules);
}

function buildStravaSheet_(ss) {
  var sh = ss.getSheetByName('Strava') || ss.insertSheet('Strava');
  sh.clear();
  var h = ['Activity ID', 'Date', 'Start', 'Name', 'Sport', 'Distance km', 'Moving min', 'Avg HR', 'Max HR', 'Elevation m', 'Relative effort', 'Avg speed m/s'];
  sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#2b6cb0').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.setColumnWidth(4, 260);
  sh.getRange(1, 14).setValue('This tab is rewritten on every sync. Do not type here.').setFontStyle('italic').setFontColor('#6b7280');
}

function buildRacesSheet_(ss) {
  var sh = ss.getSheetByName('Races') || ss.insertSheet('Races');
  sh.clear();
  var h = ['Date', 'Race', 'Distance km', 'Goal', 'Notes'];
  sh.getRange(1, 1, 1, 5).setValues([h]).setFontWeight('bold').setBackground('#1f4e5f').setFontColor('#ffffff');
  sh.getRange(2, 1, 60, 1).setNumberFormat('@');
  if (RACES.length) sh.getRange(2, 1, RACES.length, 5).setValues(RACES);
  sh.setColumnWidth(1, 100); sh.setColumnWidth(2, 220); sh.setColumnWidth(4, 320); sh.setColumnWidth(5, 380);
  sh.setFrozenRows(1);
}

function buildGoalsSheet_(ss) {
  var sh = ss.getSheetByName('Goals') || ss.insertSheet('Goals');
  sh.clear();
  sh.getRange(1, 1, 1, 4).setValues([['Goal', 'Target', 'Status', 'Result / date']]).setFontWeight('bold').setBackground('#1f4e5f').setFontColor('#ffffff');
  sh.getRange(2, 1, 30, 4).setNumberFormat('@');
  if (GOALS.length) sh.getRange(2, 1, GOALS.length, 4).setValues(GOALS);
  sh.getRange(2, 3, 30, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Not yet', 'In progress', 'Achieved'], true).build());
  sh.getRange(1, 6, 1, 2).setValues([['Reference results', 'Value']]).setFontWeight('bold').setBackground('#f28c28').setFontColor('#ffffff');
  sh.getRange(2, 6, 30, 2).setNumberFormat('@');
  if (REFS.length) sh.getRange(2, 6, REFS.length, 2).setValues(REFS);
  sh.setColumnWidth(1, 160); sh.setColumnWidth(2, 140); sh.setColumnWidth(3, 110); sh.setColumnWidth(4, 220);
  sh.setColumnWidth(6, 240); sh.setColumnWidth(7, 160);
  sh.setFrozenRows(1);
}

function buildSettingsSheet_(ss) {
  var sh = ss.getSheetByName('Settings') || ss.insertSheet('Settings');
  sh.clear();
  sh.getRange(1, 1, 1, 3).setValues([['Setting', 'Value', 'Notes']]).setFontWeight('bold').setBackground('#1f4e5f').setFontColor('#ffffff');
  var rows = SETTINGS_DEF.map(function (d) {
    var v = (EDITION.settings && EDITION.settings[d[0]] !== undefined) ? EDITION.settings[d[0]] : d[2];
    if (typeof v === 'boolean') v = v ? 'Yes' : 'No';
    return [d[1], v, d[3]];
  });
  sh.getRange(2, 2, rows.length, 1).setNumberFormat('@');
  sh.getRange(2, 1, rows.length, 3).setValues(rows);
  sh.getRange(2, 2, rows.length, 1).setBackground('#fffbea').setFontColor('#0000ff');
  sh.setColumnWidth(1, 300); sh.setColumnWidth(2, 200); sh.setColumnWidth(3, 440);
  sh.setFrozenRows(1);
}

function buildWeeksSheet_(ss, rowsOpt) {
  var sh = ss.getSheetByName('Weeks') || ss.insertSheet('Weeks');
  sh.clear();
  sh.getRange(1, 1, 1, 4).setValues([['Week', 'Focus', 'Key sessions', 'Motivation line (shown on Today)']]).setFontWeight('bold').setBackground('#1f4e5f').setFontColor('#ffffff');
  var rows = rowsOpt || [];
  if (!rowsOpt) {
    Object.keys(WEEKS).map(Number).sort(function (a, b) { return a - b; }).forEach(function (w) {
      rows.push([w, WEEKS[w].focus, WEEKS[w].key, WEEKS[w].motivation]);
    });
  }
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 4).setValues(rows);
    sh.getRange(2, 2, rows.length, 3).setBackground('#fffbea').setFontColor('#0000ff').setWrap(true);
  }
  sh.setColumnWidth(1, 60); sh.setColumnWidth(2, 260); sh.setColumnWidth(3, 320); sh.setColumnWidth(4, 520);
  sh.setFrozenRows(1);
}

function buildTestsSheet_(ss) {
  var sh = ss.getSheetByName('Tests') || ss.insertSheet('Tests');
  sh.clear();
  sh.getRange(1, 1, 1, 4).setValues([['Date', 'Label', 'Session', 'Target avg HR (blank = info only)']]).setFontWeight('bold').setBackground('#1f4e5f').setFontColor('#ffffff');
  sh.getRange(2, 1, 30, 1).setNumberFormat('@');
  var rows = TESTS.map(function (t) { return [t.iso, t.label, t.session, t.target === null ? '' : t.target]; });
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 4).setValues(rows);
    sh.getRange(2, 1, rows.length, 4).setBackground('#fffbea').setFontColor('#0000ff');
  }
  sh.setColumnWidth(1, 100); sh.setColumnWidth(2, 140); sh.setColumnWidth(3, 260); sh.setColumnWidth(4, 240);
  sh.setFrozenRows(1);
}

// ------------------------------------------------------------------ "Plan input": paste a plan, then build the Plan tab from it
var INPUT_HEADERS = ['Date', 'Type', 'Session', 'Planned min', 'Target (HR / pace)', 'What to do', 'Phase (optional)'];

function buildPlanInputSheet_(ss) {
  var sh = ss.getSheetByName('Plan input') || ss.insertSheet('Plan input');
  if (sh.getLastRow() > 1) return;      // never wipe a plan the user has pasted
  sh.clear();
  sh.getRange(1, 1, 1, INPUT_HEADERS.length).setValues([INPUT_HEADERS]).setFontWeight('bold').setBackground('#1f4e5f').setFontColor('#ffffff').setWrap(true);
  sh.getRange(2, 1, 400, 1).setNumberFormat('@');
  sh.getRange(2, 2, 400, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(TYPES, true).setAllowInvalid(true).build());
  sh.getRange(2, 1, 400, INPUT_HEADERS.length).setBackground('#fffbea').setFontColor('#0000ff').setVerticalAlignment('top');
  sh.getRange(2, 6, 400, 1).setWrap(true);
  var w = [100, 90, 200, 90, 180, 480, 140];
  for (var i = 0; i < w.length; i++) sh.setColumnWidth(i + 1, w[i]);
  sh.setFrozenRows(1);
  var help = [
    ['HOW TO USE THIS TAB'],
    ['1. One row per session. Several sessions on one day are fine (just repeat the date).'],
    ['2. Date as yyyy-mm-dd (for example 2026-11-02). Type: Run, Strength, Race or Rest.'],
    ['3. Run and Race rows need Planned min above 0. Target and What to do are optional but helpful.'],
    ['4. Days you leave out are filled in as rest days. Weeks are numbered from the first date.'],
    ['5. When done, choose the menu item: Build plan from "Plan input".'],
    ['Tip: ask any AI to produce your plan as a table with exactly these columns, then paste it here.']
  ];
  sh.getRange(1, 9, help.length, 1).setValues(help).setFontColor('#6b7280');
  sh.getRange(1, 9).setFontWeight('bold');
  sh.setColumnWidth(9, 560);
}

var GENERIC_MOTIVATION = [
  'Start easy. Consistency beats intensity.', 'Show up, even on the slow days.', 'Small steps add up.', 'Rest is part of the plan.',
  'Trust the process.', 'Strong and steady wins.', 'Progress is quiet. Keep going.', 'Today counts, whatever it looks like.'];

// Pure: turns the rows of the "Plan input" tab into plan rows. Returns { plan, errors, races, weeks }.
function buildPlanRowsFromInput_(rows) {
  var errors = [], items = [];
  rows.forEach(function (r, i) {
    var rowNo = i + 2;
    var dateCell = r[0], typeCell = String(r[1] || '').trim(), session = String(r[2] || '').trim();
    var blank = (dateCell === '' || dateCell === null || dateCell === undefined) && !typeCell && !session && String(r[3] || '') === '' && !String(r[5] || '').trim();
    if (blank) return;
    var iso = toIso_(dateCell);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) { errors.push('Row ' + rowNo + ': the date "' + iso + '" must look like 2026-11-02.'); return; }
    var chk = isoToDay_(iso); if (isNaN(chk) || dayToIso_(chk) !== iso) { errors.push('Row ' + rowNo + ': "' + iso + '" is not a real date.'); return; }
    var type = TYPES.filter(function (t) { return t.toLowerCase() === typeCell.toLowerCase(); })[0];
    if (!type) { errors.push('Row ' + rowNo + ': Type "' + typeCell + '" must be Run, Strength, Race or Rest.'); return; }
    if (!session) { errors.push('Row ' + rowNo + ': the session needs a name.'); return; }
    var minsRaw = r[3];
    var mins = (minsRaw === '' || minsRaw === null || minsRaw === undefined) ? 0 : Number(minsRaw);
    if (isNaN(mins) || mins < 0 || mins > 900) { errors.push('Row ' + rowNo + ': Planned min must be a number between 0 and 900.'); return; }
    if ((type === 'Run' || type === 'Race') && mins <= 0) { errors.push('Row ' + rowNo + ': a ' + type + ' needs Planned min above 0.'); return; }
    items.push({ iso: iso, day: chk, order: i, type: type, session: session, mins: mins, target: String(r[4] || ''), details: String(r[5] || ''), phase: String(r[6] || '').trim() });
  });
  if (!items.length) { if (!errors.length) errors.push('The Plan input tab has no sessions yet.'); return { plan: [], errors: errors, races: [], weeks: [] }; }
  items.sort(function (a, b) { return a.day - b.day || a.order - b.order; });
  var first = items[0].day, last = items[items.length - 1].day;
  if (last - first > 400) errors.push('The plan spans more than 400 days. Please check the dates.');
  if (errors.length) return { plan: [], errors: errors, races: [], weeks: [] };
  var byDay = {}; items.forEach(function (it) { (byDay[it.day] = byDay[it.day] || []).push(it); });
  var dow0 = new Date(first * 86400000).getUTCDay();             // Sun=0
  var monday0 = first - ((dow0 + 6) % 7);
  var plan = [], races = [], weekSeen = {}, lastPhase = 'Plan';
  for (var d = first; d <= last; d++) {
    var iso2 = dayToIso_(d), wk = Math.floor((d - monday0) / 7) + 1;
    var list = byDay[d] || [{ iso: iso2, day: d, type: 'Rest', session: 'Rest day', mins: 0, target: '', details: 'Rest day. Optional easy walk and mobility.', phase: '' }];
    list.forEach(function (it, k) {
      if (it.phase) lastPhase = it.phase;
      plan.push({ iso: iso2, slot: k + 1, wk: wk, phase: it.phase || lastPhase, type: it.type, session: it.session, details: it.details, target: it.target, pMin: it.mins });
      if (it.type === 'Race') races.push([iso2, it.session, '', '', '']);
    });
    weekSeen[wk] = true;
  }
  var weeks = Object.keys(weekSeen).map(Number).sort(function (a, b) { return a - b; }).map(function (w) { return [w, '', '', GENERIC_MOTIVATION[(w - 1) % GENERIC_MOTIVATION.length]]; });
  return { plan: plan, errors: [], races: races, weeks: weeks };
}

function buildPlanFromInput() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var inp = ss.getSheetByName('Plan input');
  if (!inp) { ui.alert('The "Plan input" tab is missing. Run "1. Set up sheets" first.'); return; }
  PropertiesService.getScriptProperties().setProperty('SS_ID', ss.getId());
  var last = inp.getLastRow();
  var vals = last >= 2 ? inp.getRange(2, 1, last - 1, 7).getValues() : [];
  var res = buildPlanRowsFromInput_(vals);
  if (res.errors.length) {
    ui.alert('Please fix these in the "Plan input" tab', res.errors.slice(0, 12).join('\n') + (res.errors.length > 12 ? '\n…and ' + (res.errors.length - 12) + ' more.' : ''), ui.ButtonSet.OK);
    return;
  }
  var existing = ss.getSheetByName('Plan');
  if (existing && existing.getLastRow() > 1) {
    var r = ui.alert('Replace the current plan?', 'The Plan tab already has sessions. Building from "Plan input" REPLACES it and clears your logs and notes. Continue?', ui.ButtonSet.YES_NO);
    if (r !== ui.Button.YES) return;
  }
  var rows = res.plan.map(function (p) {
    return [p.iso, dowName_(p.iso), p.slot, p.wk, p.phase, p.type, p.session, p.details, p.target, p.pMin, '', '',
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
  });
  buildPlanSheet_(ss, rows);
  buildWeeksSheet_(ss, res.weeks);
  var rs = ss.getSheetByName('Races');
  if (rs && res.races.length && rs.getLastRow() < 2) { rs.getRange(2, 1, res.races.length, 1).setNumberFormat('@'); rs.getRange(2, 1, res.races.length, 5).setValues(res.races); }
  ss.setActiveSheet(ss.getSheetByName('Plan'));
  ui.alert('Plan built', rows.length + ' sessions over ' + res.weeks.length + ' weeks' + (res.races.length ? ', ' + res.races.length + ' race(s) added to the Races tab (add the distance and goal there)' : '') +
    '.\nOpen your dashboard and reload. Next: connect Strava if you want auto-sync (menu items 2 to 5).', ui.ButtonSet.OK);
}

// ------------------------------------------------------------------ keep logs and edits when the plan text changes
function refreshPlanText() {
  var ui = SpreadsheetApp.getUi();
  var sh = SpreadsheetApp.getActive().getSheetByName('Plan');
  if (!sh) { ui.alert('Run "1. Set up sheets" first.'); return; }
  if (String(sh.getRange(1, 3).getValue()) !== 'Slot') { ui.alert('The Plan tab does not have the expected layout. Run "1. Set up sheets" on a fresh copy.'); return; }
  var res = refreshPlanCore_(sh, PLAN);
  ui.alert('Plan text updated', res.updated + ' days updated, ' + res.skipped + ' skipped because they are marked ✎ (your edits), ' +
    res.added + ' added.\nYour logs and notes were not touched.', ui.ButtonSet.OK);
}

// sh: Plan sheet; planData: PLAN-style rows [iso, wk, phase, type, session, details, target, pMin, pKm]
function refreshPlanCore_(sh, planData) {
  var last = sh.getLastRow();
  var existing = last > 1 ? sh.getRange(2, 1, last - 1, COL.LOCK).getValues() : [];
  var idx = {};
  existing.forEach(function (r, i) { idx[toIso_(r[0]) + '|' + (Number(r[2]) || 1)] = i; });
  var updated = 0, skipped = 0, added = [];
  planData.forEach(function (p) {
    var key = p[0] + '|1';
    var km = p[8] === null ? '' : p[8];
    if (key in idx) {
      var r = existing[idx[key]];
      if (r[COL.LOCK - 1] !== '' && r[COL.LOCK - 1] !== null && r[COL.LOCK - 1] !== undefined) { skipped++; return; }
      r[COL.WK - 1] = p[1]; r[COL.PHASE - 1] = p[2]; r[COL.TYPE - 1] = p[3]; r[COL.SESSION - 1] = p[4];
      r[COL.DETAILS - 1] = p[5]; r[COL.TARGET - 1] = p[6]; r[COL.PMIN - 1] = p[7]; r[COL.PKM - 1] = km;
      updated++;
    } else {
      added.push([p[0], dowName_(p[0]), 1, p[1], p[2], p[3], p[4], p[5], p[6], p[7], km, '']);
    }
  });
  if (existing.length) sh.getRange(2, 1, existing.length, COL.LOCK).setValues(existing);
  added.forEach(function (row) {
    var nr = sh.getLastRow() + 1;
    sh.getRange(nr, 1).setNumberFormat('@');
    sh.getRange(nr, 1, 1, COL.LOCK).setValues([row]);
  });
  if (added.length) sh.getRange(2, 1, sh.getLastRow() - 1, NCOLS).sort([{ column: 1, ascending: true }, { column: 3, ascending: true }]);
  return { updated: updated, skipped: skipped, added: added.length };
}

// ------------------------------------------------------------------ plan health check
function checkPlan() {
  var ui = SpreadsheetApp.getUi();
  try {
    var plan = readPlan_(getSS_());
    var issues = checkPlan_(plan);
    var msg = issues.length ? (issues.length + ' problem(s) found:\n\n' + issues.slice(0, 15).join('\n') + (issues.length > 15 ? '\n…and ' + (issues.length - 15) + ' more.' : ''))
      : 'No problems found. ' + plan.length + ' sessions over ' + (plan.length ? plan[0].iso + ' to ' + plan[plan.length - 1].iso : 'no dates') + '.';
    ui.alert('Plan check', msg, ui.ButtonSet.OK);
  } catch (e) { ui.alert('Plan check failed', String(e && e.message ? e.message : e), ui.ButtonSet.OK); }
}

function checkPlan_(plan) {
  var issues = [];
  var seen = {}, perDate = {}, prevWk = 0, prevIso = '';
  plan.forEach(function (p) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.iso)) { issues.push('Bad date "' + p.iso + '": use yyyy-mm-dd.'); return; }
    if (TYPES.indexOf(p.type) < 0) issues.push(p.iso + ' slot ' + p.slot + ': Type "' + p.type + '" must be Run, Strength, Race or Rest.');
    var key = p.iso + '|' + p.slot;
    if (seen[key]) issues.push(p.iso + ': two rows share slot ' + p.slot + '.');
    seen[key] = true;
    (perDate[p.iso] = perDate[p.iso] || []).push(p);
    if ((p.type === 'Run' || p.type === 'Race') && !(p.pMin > 0)) issues.push(p.iso + ' "' + p.session + '": a ' + p.type + ' needs planned minutes above 0.');
    if (!p.session) issues.push(p.iso + ' slot ' + p.slot + ': the session has no name.');
    if (prevIso && p.iso < prevIso) issues.push(p.iso + ': rows are not in date order (sort the Plan tab by Date).');
    if (p.wk < prevWk && p.iso > prevIso) issues.push(p.iso + ': week number goes backwards (' + prevWk + ' to ' + p.wk + ').');
    if (p.iso >= prevIso) { prevIso = p.iso; prevWk = Math.max(prevWk, p.wk); }
  });
  Object.keys(perDate).sort().forEach(function (iso) {
    var rows = perDate[iso];
    var slots = rows.map(function (r) { return r.slot; }).sort(function (a, b) { return a - b; });
    for (var i = 0; i < slots.length; i++) if (slots[i] !== i + 1) { issues.push(iso + ': slots should be 1' + (slots.length > 1 ? ' to ' + slots.length : '') + ' without gaps.'); break; }
    if (rows.length > 4) issues.push(iso + ': more than 4 sessions on one day.');
  });
  var dates = Object.keys(perDate).filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }).sort();
  if (dates.length > 1) {
    var have = {}; dates.forEach(function (d) { have[d] = true; });
    for (var n = isoToDay_(dates[0]); n < isoToDay_(dates[dates.length - 1]); n++) {
      var iso = dayToIso_(n);
      if (!have[iso]) { issues.push(iso + ': no row for this date (a gap in the plan).'); if (issues.length > 40) break; }
    }
  }
  return issues;
}

// ------------------------------------------------------------------ edit operations (core functions take a sheet so they can be tested)
function planKeys_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 3).getValues().map(function (r, i) {
    return { row: i + 2, iso: toIso_(r[0]), slot: Number(r[2]) || 1 };
  });
}
function findRow_(sh, iso, slot) {
  var ks = planKeys_(sh);
  for (var i = 0; i < ks.length; i++) if (ks[i].iso === iso && (slot === null || slot === undefined || ks[i].slot === Number(slot))) return ks[i].row;
  return 0;
}
// Validates the editable fields and returns them in column order: type, session, details, target, planned min, km.
function sessionFields_(f) {
  var type = String(f.type || '');
  if (TYPES.indexOf(type) < 0) throw new Error('Type must be Run, Strength, Race or Rest.');
  var name = String(f.session || '').trim();
  if (!name) throw new Error('Please give the session a name.');
  var mins = (f.pMin === '' || f.pMin === null || f.pMin === undefined) ? 0 : Number(f.pMin);
  if (isNaN(mins) || mins < 0 || mins > 900) throw new Error('Planned minutes must be a number between 0 and 900.');
  if ((type === 'Run' || type === 'Race') && mins <= 0) throw new Error('A run or race needs planned minutes above 0.');
  var km = (f.pKm === '' || f.pKm === null || f.pKm === undefined) ? '' : Number(f.pKm);
  if (km !== '' && isNaN(km)) km = '';
  return [type, name, String(f.details || ''), String(f.target || ''), mins, km];
}

function updateSessionCore_(sh, iso, slot, f) {
  var row = findRow_(sh, iso, slot);
  if (!row) throw new Error('That session was not found.');
  sh.getRange(row, COL.TYPE, 1, 6).setValues([sessionFields_(f)]);
  sh.getRange(row, COL.LOCK).setValue('✎');
}

function addSessionCore_(sh, iso, f) {
  var keys = planKeys_(sh).filter(function (k) { return k.iso === iso; });
  if (!keys.length) throw new Error('That date is not in the plan.');
  if (keys.length >= 4) throw new Error('A day can hold at most 4 sessions.');
  var vals = sessionFields_(f);
  var maxSlot = 0;
  keys.forEach(function (k) { if (k.slot > maxSlot) maxSlot = k.slot; });
  var last = keys[keys.length - 1].row;
  var first = sh.getRange(keys[0].row, 1, 1, COL.LOCK).getValues()[0];
  sh.insertRowAfter(last);
  var nr = last + 1;
  sh.getRange(nr, 1).setNumberFormat('@');
  sh.getRange(nr, 1, 1, COL.LOCK).setValues([[toIso_(first[0]), first[1], maxSlot + 1, first[3], first[4], vals[0], vals[1], vals[2], vals[3], vals[4], vals[5], '✎']]);
}

function deleteSessionCore_(sh, iso, slot) {
  var keys = planKeys_(sh).filter(function (k) { return k.iso === iso; });
  if (keys.length < 2) throw new Error('A day needs at least one session. Change its type to Rest instead.');
  var row = findRow_(sh, iso, slot);
  if (!row) throw new Error('That session was not found.');
  sh.deleteRow(row);
  planKeys_(sh).filter(function (k) { return k.iso === iso; }).forEach(function (k, i) { sh.getRange(k.row, COL.SLOT).setValue(i + 1); });
}

function readSessionFields_(sh, iso) {
  return planKeys_(sh).filter(function (k) { return k.iso === iso; }).map(function (k) {
    return sh.getRange(k.row, COL.TYPE, 1, 6).getValues()[0];
  });
}

// Make the date hold exactly list.length sessions, then write the list into its rows.
function setDateSessionsCore_(sh, iso, list) {
  var keys = planKeys_(sh).filter(function (k) { return k.iso === iso; });
  while (keys.length < list.length) {
    addSessionCore_(sh, iso, { type: 'Rest', session: 'placeholder', pMin: 0 });
    keys = planKeys_(sh).filter(function (k) { return k.iso === iso; });
  }
  while (keys.length > list.length) {
    sh.deleteRow(keys[keys.length - 1].row);
    keys = planKeys_(sh).filter(function (k) { return k.iso === iso; });
  }
  keys.forEach(function (k, i) {
    sh.getRange(k.row, COL.TYPE, 1, 6).setValues([list[i]]);
    sh.getRange(k.row, COL.LOCK).setValue('✎');
  });
}

function swapDaysCore_(sh, a, b, today) {
  if (a === b) throw new Error('Pick a different day to swap with.');
  if (a < today || b < today) throw new Error('Only today and future days can be swapped.');
  var sa = readSessionFields_(sh, a), sb = readSessionFields_(sh, b);
  if (!sa.length || !sb.length) throw new Error('One of those dates is not in the plan.');
  setDateSessionsCore_(sh, a, sb);
  setDateSessionsCore_(sh, b, sa);
}

function saveCheckinCore_(sh, iso, d) {
  var row = findRow_(sh, iso, null);
  if (!row) throw new Error('That date is not in the plan: ' + iso);
  function put(col, v, isNum) {
    if (v === undefined) return;
    var cell = sh.getRange(row, col);
    if (v === '' || v === null) { cell.clearContent(); return; }
    cell.setValue(isNum ? Number(v) : String(v));
  }
  put(COL.RHR, d.rhr, true); put(COL.HRV, d.hrv, true); put(COL.SLEEP, d.sleep, true);
  put(COL.SORE, d.sore, true); put(COL.RPE, d.rpe, true); put(COL.TESTHR, d.testHR, true);
  put(COL.NOTES, d.notes, false);
}

function setStatusCore_(sh, iso, slot, status) {
  var row = findRow_(sh, iso, slot);
  if (!row) throw new Error('That session was not found.');
  var ok = ['Done', 'Partial', 'Skipped', ''];
  if (ok.indexOf(status) < 0) throw new Error('Unknown status');
  var cell = sh.getRange(row, COL.OVR);
  if (status === '') cell.clearContent(); else cell.setValue(status);
}

// ------------------------------------------------------------------ Strava connection
function connectStravaStepA() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var r1 = ui.prompt('Connect Strava (1/2)', 'Paste your Strava Client ID (a number):', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var clientId = r1.getResponseText().trim();
  var r2 = ui.prompt('Connect Strava (2/2)', 'Paste your Strava Client Secret:', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  var secret = r2.getResponseText().trim();
  if (!clientId || !secret) { ui.alert('Both values are needed.'); return; }
  props.setProperties({ CLIENT_ID: clientId, CLIENT_SECRET: secret });
  var url = 'https://www.strava.com/oauth/authorize?client_id=' + encodeURIComponent(clientId) +
    '&response_type=code&redirect_uri=' + encodeURIComponent(CONFIG.redirectUri) +
    '&approval_prompt=force&scope=' + encodeURIComponent('read,activity:read_all');
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;padding:6px">' +
    '<p><b>1.</b> Click the link, log in to Strava and press <b>Authorize</b>.</p>' +
    '<p><a href="' + url.replace(/&/g, '&amp;') + '" target="_blank">Open the Strava authorization page</a></p>' +
    '<p><b>2.</b> Your browser will then show a Google page saying it cannot open the file (or a similar error). That is expected. ' +
    'Copy the <b>whole address</b> from the address bar.</p>' +
    '<p><b>3.</b> Close this box, then choose <b>Training HQ → Connect Strava: step B</b> and paste it. ' +
    'Do this within a few minutes, the code expires quickly.</p></div>').setWidth(460).setHeight(320);
  ui.showModalDialog(html, 'Authorize Strava');
}

function connectStravaStepB() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var cid = props.getProperty('CLIENT_ID'), sec = props.getProperty('CLIENT_SECRET');
  if (!cid || !sec) { ui.alert('Run "Connect Strava: step A" first.'); return; }
  var r = ui.prompt('Connect Strava: step B', 'Paste the full address from the error page (or just the code):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var txt = r.getResponseText().trim();
  var m = txt.match(/[?&]code=([^&\s]+)/);
  var code = m ? m[1] : txt;
  var resp = UrlFetchApp.fetch('https://www.strava.com/oauth/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { client_id: cid, client_secret: sec, code: code, grant_type: 'authorization_code' }
  });
  var body = JSON.parse(resp.getContentText());
  if (resp.getResponseCode() !== 200 || !body.refresh_token) {
    ui.alert('Strava said no', 'Details: ' + resp.getContentText().slice(0, 300) + '\n\nStart again from step A (the code can only be used once).', ui.ButtonSet.OK);
    return;
  }
  props.setProperties({
    ACCESS_TOKEN: body.access_token, REFRESH_TOKEN: body.refresh_token, EXPIRES_AT: String(body.expires_at)
  });
  var who = body.athlete ? (body.athlete.firstname || '') : '';
  ui.alert('Connected' + (who ? ' as ' + who : ''), 'Now choose "4. Sync Strava now".', ui.ButtonSet.OK);
}

function getAccessToken_() {
  var props = PropertiesService.getScriptProperties();
  var refresh = props.getProperty('REFRESH_TOKEN');
  if (!refresh) throw new Error('Strava is not connected yet. Use the Training HQ menu → Connect Strava.');
  var exp = Number(props.getProperty('EXPIRES_AT') || 0);
  if (Date.now() / 1000 < exp - 300 && props.getProperty('ACCESS_TOKEN')) return props.getProperty('ACCESS_TOKEN');
  var resp = UrlFetchApp.fetch('https://www.strava.com/oauth/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { client_id: props.getProperty('CLIENT_ID'), client_secret: props.getProperty('CLIENT_SECRET'),
      grant_type: 'refresh_token', refresh_token: refresh }
  });
  var body = JSON.parse(resp.getContentText());
  if (resp.getResponseCode() !== 200 || !body.access_token) throw new Error('Could not refresh the Strava token: ' + resp.getContentText().slice(0, 200));
  props.setProperties({ ACCESS_TOKEN: body.access_token, REFRESH_TOKEN: body.refresh_token || refresh, EXPIRES_AT: String(body.expires_at) });
  return body.access_token;
}

// ------------------------------------------------------------------ Strava sync
function syncStravaFromMenu() {
  var ui = SpreadsheetApp.getUi();
  try {
    var n = syncStrava();
    ui.alert('Sync complete', n + ' activities read from Strava. The Plan tab and dashboard are updated.', ui.ButtonSet.OK);
  } catch (e) { ui.alert('Sync failed', String(e.message || e), ui.ButtonSet.OK); }
}

// One sync at a time. Remembers the last error so the dashboard can show it.
function syncStravaSafe_() {
  loadConfig_();
  if (CONFIG.useStrava === false) return 0;     // manual-only mode
  var props = PropertiesService.getScriptProperties();
  var lock = (typeof LockService !== 'undefined') ? LockService.getScriptLock() : null;
  if (lock && !lock.tryLock(25000)) return -1;     // another sync is already running
  try {
    var n = syncStrava();
    props.deleteProperty('SYNC_ERROR');
    return n;
  } catch (e) {
    props.setProperty('SYNC_ERROR', Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm") + ' · ' + String(e && e.message ? e.message : e).slice(0, 200));
    throw e;
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (x) {} }
  }
}

// Start date for the Strava sync: the Settings value, else two weeks before the first plan date, else 30 days ago.
function effectiveStravaAfter_() {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(CONFIG.stravaAfter || ''))) return CONFIG.stravaAfter;
  try {
    var sh = getSS_().getSheetByName('Plan');
    if (sh && sh.getLastRow() >= 2) { var first = toIso_(sh.getRange(2, 1).getValue()); if (/^\d{4}-\d{2}-\d{2}$/.test(first)) return dayToIso_(isoToDay_(first) - 14); }
  } catch (e) { /* fall through */ }
  return dayToIso_(isoToDay_(todayIso_()) - 30);
}

function syncStravaScheduled() { syncStravaSafe_(); }

function syncNow() {
  var result = {};
  if (CONFIG.useStrava !== false) result.strava = syncStravaSafe_();
  if (PropertiesService.getScriptProperties().getProperty('HEALTH_FOLDER_ID')) result.health = healthSyncSafe_();
  return result;
}   // called by the dashboard (Sync button and automatic refresh on open)

function installSyncTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncStravaScheduled') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncStravaScheduled').timeBased().everyMinutes(30).create();
}
function hasSyncTrigger_() {
  try {
    return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'syncStravaScheduled'; });
  } catch (e) { return null; }
}
function enableAutoSync() { installSyncTrigger_(); return true; }    // called from the dashboard banner
function installAutoSync() {
  installSyncTrigger_();
  SpreadsheetApp.getUi().alert('Auto-sync on', 'Strava will be synced about every 30 minutes.', SpreadsheetApp.getUi().ButtonSet.OK);
}

function syncStrava() {
  loadConfig_();
  var token = getAccessToken_();
  var afterEpoch = Math.floor(new Date(effectiveStravaAfter_() + 'T00:00:00Z').getTime() / 1000);
  var all = [], page = 1;
  while (page <= 10) {
    var url = 'https://www.strava.com/api/v3/athlete/activities?after=' + afterEpoch + '&per_page=100&page=' + page;
    var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) throw new Error('Strava error ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 300));
    var batch = JSON.parse(resp.getContentText());
    all = all.concat(batch);
    if (batch.length < 100) break;
    page++;
  }
  var ss = getSS_();
  writeStravaSheet_(ss, all);
  applyToPlan_(ss);
  PropertiesService.getScriptProperties().setProperty('LAST_SYNC', Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"));
  return all.length;
}

function writeStravaSheet_(ss, acts) {
  var sh = ss.getSheetByName('Strava');
  if (!sh) { buildStravaSheet_(ss); sh = ss.getSheetByName('Strava'); }
  acts.sort(function (a, b) { return String(a.start_date_local).localeCompare(String(b.start_date_local)); });
  var rows = acts.map(function (a) {
    var s = String(a.start_date_local || '');
    return [a.id, s.substring(0, 10), s.substring(11, 16), a.name || '', a.sport_type || a.type || '',
      round1_((a.distance || 0) / 1000), round1_((a.moving_time || 0) / 60),
      a.average_heartrate ? Math.round(a.average_heartrate) : '', a.max_heartrate ? Math.round(a.max_heartrate) : '',
      Math.round(a.total_elevation_gain || 0), a.suffer_score || '', a.average_speed || ''];
  });
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 12).clearContent();
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 1).setNumberFormat('0');
    sh.getRange(2, 2, rows.length, 2).setNumberFormat('@');
    sh.getRange(2, 1, rows.length, 12).setValues(rows);
  }
}

function readStrava_(ss) {
  var sh = ss.getSheetByName('Strava');
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 12).getValues();
  return v.filter(function (r) { return r[1]; }).map(function (r) {
    return { id: r[0], iso: toIso_(r[1]), time: String(r[2]), name: r[3], sport: r[4], km: Number(r[5]) || 0, min: Number(r[6]) || 0,
      avgHR: num_(r[7]), maxHR: num_(r[8]), elev: Number(r[9]) || 0, effort: num_(r[10]), speed: num_(r[11]) };
  });
}

function readPlan_(ss) {
  var sh = ss.getSheetByName('Plan');
  if (!sh || sh.getLastRow() < 1) return [];
  if (String(sh.getRange(1, 3).getValue()) !== 'Slot') {
    throw new Error('The Plan tab does not have the expected layout. In the Sheet choose Training HQ → 1. Set up sheets (on a fresh copy).');
  }
  if (sh.getLastRow() < 2) return [];
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, NCOLS).getValues();
  return v.filter(function (r) { return r[0]; }).map(function (r) {
    return { iso: toIso_(r[0]), day: String(r[1]), slot: Number(r[2]) || 1, wk: Number(r[3]), phase: r[4], type: r[5], session: r[6],
      details: r[7], target: r[8], pMin: num_(r[9]) || 0, pKm: num_(r[10]), locked: !!r[11],
      auto: r[12] || '', aKm: num_(r[13]), aMin: num_(r[14]), aHR: num_(r[15]), mHR: num_(r[16]),
      pace: (r[17] instanceof Date) ? '' : String(r[17] || ''), link: r[18] || '', ovr: r[19] || '', rhr: num_(r[20]), hrv: num_(r[21]), sleep: num_(r[22]),
      sore: num_(r[23]), rpe: num_(r[24]), testHR: num_(r[25]), notes: String(r[26] || '') };
  });
}

function readRaces_(ss) {
  var sh = ss.getSheetByName('Races');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getDisplayValues().filter(function (r) { return r[0]; }).map(function (r) {
    return { iso: String(r[0]), name: r[1], km: Number(r[2]) || 0, goal: r[3], notes: r[4] };
  }).sort(function (a, b) { return a.iso < b.iso ? -1 : 1; });
}

function readGoals_(ss) {
  var sh = ss.getSheetByName('Goals');
  var goals = [], refs = [];
  if (!sh || sh.getLastRow() < 2) return { goals: goals, refs: refs };
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getDisplayValues();
  v.forEach(function (r) {
    if (r[0]) goals.push({ goal: r[0], target: r[1], status: r[2] || 'Not yet', result: r[3] });
    if (r[5]) refs.push({ label: r[5], value: r[6] });
  });
  return { goals: goals, refs: refs };
}

function readWeeksInfo_(ss) {
  var sh = ss.getSheetByName('Weeks');
  if (!sh || sh.getLastRow() < 2) return null;
  var out = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 4).getDisplayValues().forEach(function (r) {
    var w = Number(r[0]);
    if (w) out[w] = { focus: r[1], key: r[2], motivation: r[3] };
  });
  return out;
}

function readTests_(ss) {
  var sh = ss.getSheetByName('Tests');
  if (!sh || sh.getLastRow() < 2) return null;
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getDisplayValues().filter(function (r) { return r[0]; }).map(function (r) {
    var t = r[3] === '' ? null : Number(r[3]);
    return { iso: String(r[0]), label: r[1], session: r[2], target: (t === null || isNaN(t)) ? null : t };
  });
}

// Pure: works out the Strava-derived columns for each plan row. A date may hold several sessions.
// Run / Race rows take the day's runs, Strength rows take other activities (gym, swim, ...).
// Rest rows take an extra run if there is no run row, otherwise a walk or other activity if there is no strength row.
function computePlanActuals_(plan, strava, today) {
  var byDate = {};
  strava.forEach(function (a) { (byDate[a.iso] = byDate[a.iso] || []).push(a); });
  var hasRunRow = {}, hasStrengthRow = {}, runTaken = {}, othersTaken = {};
  plan.forEach(function (p) {
    if (p.type === 'Run' || p.type === 'Race') hasRunRow[p.iso] = true;
    if (p.type === 'Strength') hasStrengthRow[p.iso] = true;
  });
  return plan.map(function (p) {
    var acts = byDate[p.iso] || [];
    var runs = acts.filter(isRun_);
    var others = acts.filter(function (a) { return !isRun_(a); });
    var main = [], usedRuns = false, usedOthers = false, restRun = false;
    if (p.type === 'Strength') {
      if (!othersTaken[p.iso]) { main = others; othersTaken[p.iso] = true; usedOthers = true; }
    } else if (p.type === 'Run' || p.type === 'Race') {
      if (!runTaken[p.iso]) { main = runs; runTaken[p.iso] = true; usedRuns = true; }
    } else {   // Rest
      if (runs.length && !hasRunRow[p.iso]) { main = runs; restRun = true; }
      else if (others.length && !hasStrengthRow[p.iso] && !othersTaken[p.iso]) { main = others; othersTaken[p.iso] = true; usedOthers = true; }
    }
    var out = { auto: '', km: '', min: '', hr: '', maxhr: '', pace: '', link: '' };
    if (main.length) {
      var min = sumBy_(main, 'min'), km = sumBy_(main, 'km');
      var hrMin = 0, hrSum = 0, mx = 0;
      main.forEach(function (a) { if (a.avgHR) { hrMin += a.min; hrSum += a.avgHR * a.min; } if (a.maxHR && a.maxHR > mx) mx = a.maxHR; });
      out.km = round1_(km);
      out.min = Math.round(min);
      out.hr = hrMin ? Math.round(hrSum / hrMin) : '';
      out.maxhr = mx || '';
      if (p.type !== 'Strength' && km > 0) out.pace = fmtPace_(min * 60 / km);
      out.link = main[0].source === 'Health Connect' ? '' : 'https://www.strava.com/activities/' + main[0].id;
    }
    function byMinutes() { var ratio = p.pMin > 0 ? out.min / p.pMin : 1; return ratio >= 0.85 ? 'Done' : (ratio >= 0.4 ? 'Partial' : 'Short'); }
    if (p.iso > today) out.auto = '';
    else if (p.type === 'Rest') {
      if (restRun) out.auto = 'Extra run';
      else if (main.length) out.auto = p.pMin > 0 ? byMinutes() : '';           // a planned walk is Done; an unplanned one just shows its data
      else out.auto = p.pMin > 0 ? (p.iso === today ? 'Pending' : 'Not logged') : '';
    }
    else if (p.type === 'Strength') out.auto = (usedOthers && others.length) ? 'Done' : (p.iso === today ? 'Pending' : 'Not logged');
    else if (usedRuns && runs.length) out.auto = byMinutes();
    else if (!usedRuns && runs.length) out.auto = 'Not logged';
    else out.auto = (p.iso === today) ? 'Pending' : 'Missed';
    return out;
  });
}

function applyToPlan_(ss) {
  var sh = ss.getSheetByName('Plan');
  var plan = readPlan_(ss);
  var strava = healthMergedActivities_(ss);
  var res = computePlanActuals_(plan, strava, todayIso_());
  var vals = res.map(function (o) { return [o.auto, o.km, o.min, o.hr, o.maxhr, o.pace, o.link]; });
  if (vals.length) {
    sh.getRange(2, COL.PACE, vals.length, 1).setNumberFormat('@');   // keep 9:45 as text, not a time
    sh.getRange(2, COL.AUTO, vals.length, 7).setValues(vals);
  }
}

function checkDashboard() {
  var ui = SpreadsheetApp.getUi();
  try {
    var ss = getSS_();
    loadConfig_();
    var plan = readPlan_(ss), strava = readStrava_(ss), races = readRaces_(ss), g = readGoals_(ss);
    var props = PropertiesService.getScriptProperties();
    var meta = { lastSync: props.getProperty('LAST_SYNC') || '', connected: !!props.getProperty('REFRESH_TOKEN') };
    var raw = buildDashboard_(plan, strava, races, g.goals, g.refs, todayIso_(), meta, { weeks: readWeeksInfo_(ss), tests: readTests_(ss) });
    var unsafe = countUnsafe_(raw);
    var size = JSON.stringify(jsonSafe_(raw)).length;
    ui.alert('Dashboard data check',
      'Plan sessions: ' + plan.length + '\nStrava activities: ' + strava.length + '\nRaces: ' + races.length + '\nGoals: ' + g.goals.length +
      '\nStrava connected: ' + meta.connected + '\nLast sync: ' + (meta.lastSync || 'never') + '\nStrava sync switched on: ' + (CONFIG.useStrava !== false) + '\nAuto-sync trigger: ' + (hasSyncTrigger_() === null ? 'unknown' : (hasSyncTrigger_() ? 'ON (every 30 min)' : 'OFF, use menu item 5')) + '\nLast sync error: ' + (props.getProperty('SYNC_ERROR') || 'none') +
      '\nUnsafe values found and fixed: ' + unsafe + '\nData size: ' + Math.round(size / 1024) + ' KB\n\nIf the plan sessions number is 0, run "1. Set up sheets".',
      ui.ButtonSet.OK);
  } catch (e) { ui.alert('Dashboard data check failed', String(e && e.stack ? e.stack : e), ui.ButtonSet.OK); }
}

function showWebAppUrl() {
  var url = ScriptApp.getService().getUrl();
  var ui = SpreadsheetApp.getUi();
  if (!url) ui.alert('Not deployed yet', 'Use Deploy → New deployment → Web app first (see the setup guide).', ui.ButtonSet.OK);
  else ui.alert('Your dashboard link', url, ui.ButtonSet.OK);
}

// ------------------------------------------------------------------ web app
function doGet() {
  try { loadConfig_(); } catch (e) { /* settings tab not ready yet */ }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(CONFIG.appTitle)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getDashboardData() {
  var ss = getSS_();
  loadConfig_();
  var plan = readPlan_(ss);
  var strava = healthMergedActivities_(ss);
  var races = readRaces_(ss);
  var g = readGoals_(ss);
  var props = PropertiesService.getScriptProperties();
  var meta = { lastSync: props.getProperty('LAST_SYNC') || '', connected: !!props.getProperty('REFRESH_TOKEN'),
    nowIso: Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"), autoSync: hasSyncTrigger_(), syncError: props.getProperty('SYNC_ERROR') || '' };
  var out = buildDashboard_(plan, strava, races, g.goals, g.refs, todayIso_(), meta, { weeks: readWeeksInfo_(ss), tests: readTests_(ss) });
  out.health = healthDashboardInfo_(ss, todayIso_());
  return jsonSafe_(out);
}

function planSheet_() {
  var sh = getSS_().getSheetByName('Plan');
  if (!sh) throw new Error('Plan tab not found.');
  return sh;
}
function saveCheckin(iso, d) { saveCheckinCore_(planSheet_(), String(iso), d); return true; }
function setStatus(iso, slot, status) { setStatusCore_(planSheet_(), String(iso), slot, status); return true; }
function updateSession(iso, slot, f) { updateSessionCore_(planSheet_(), String(iso), slot, f); return true; }
function addSession(iso, f) { addSessionCore_(planSheet_(), String(iso), f); return true; }
function deleteSession(iso, slot) { deleteSessionCore_(planSheet_(), String(iso), slot); return true; }
function swapDays(a, b) { loadConfig_(); swapDaysCore_(planSheet_(), String(a), String(b), todayIso_()); return true; }

function getWeeklySummary() { return buildSummary_(getDashboardData()); }

// ------------------------------------------------------------------ dashboard logic (pure)
function readiness_(plan, today) {
  var t = isoToDay_(today);
  var recent = plan.filter(function (p) { var d = isoToDay_(p.iso); return d <= t && d >= t - 3; });
  var latest = null;
  recent.forEach(function (p) {
    if (isoToDay_(p.iso) >= t - 1 && (p.rhr !== null || p.hrv !== null || p.sleep !== null || p.sore !== null)) latest = p;
  });
  var flags = [];
  if (latest) {
    if (CONFIG.flagRestHR > 0 && latest.rhr !== null && latest.rhr >= CONFIG.flagRestHR) flags.push('Resting HR ' + latest.rhr + ' (baseline ' + CONFIG.baselineRestHR + ')');
    if (CONFIG.flagHRV > 0 && latest.hrv !== null && latest.hrv <= CONFIG.flagHRV) flags.push('HRV ' + latest.hrv + ' (baseline ' + CONFIG.baselineHRV + ')');
    if (latest.sleep !== null && latest.sleep < CONFIG.flagSleep) flags.push('Sleep ' + latest.sleep + ' h');
    if (latest.sore !== null && latest.sore >= CONFIG.flagSoreness) flags.push('Soreness ' + latest.sore + '/5');
  }
  var text = recent.map(function (p) { return (p.notes || '').toLowerCase(); }).join(' | ');
  var safety = SAFETY_WORDS.filter(function (w) { return text.indexOf(w) >= 0; });
  var caution = CAUTION_WORDS.filter(function (w) { return text.indexOf(w) >= 0; });
  var level, title, msg;
  if (safety.length) {
    level = 'STOP'; title = 'Pause and check';
    msg = 'A recent note mentions “' + safety[0] + '”. Skip hard sessions and get it checked before pushing on. If this was a false alarm, edit the note in the Plan sheet.';
  } else if (flags.length >= 2) {
    level = 'REST'; title = 'Rest or walk today';
    msg = flags.join(' · ') + '. Two or more recovery flags: rest or walk, and do not make the session up later.';
  } else if (flags.length === 1) {
    level = 'EASY'; title = 'Keep today easy';
    msg = flags[0] + '. Drop any quality reps and cut the session by about 20%.';
  } else if (caution.length) {
    level = 'WATCH'; title = 'Keep an eye on it';
    msg = 'Your notes mention “' + caution.slice(0, 2).join('”, “') + '”. Start easy and reassess after 10 minutes.';
  } else if (latest) {
    level = 'GO'; title = 'Green light';
    msg = 'Recovery numbers look fine. Run today’s session as planned.';
  } else {
    level = 'NO_DATA'; title = 'Log your check-in';
    msg = 'Add resting HR, sleep and soreness for a readiness call.';
  }
  return { level: level, title: title, text: msg, flags: flags, safety: safety, caution: caution, basedOn: latest ? latest.iso : '' };
}

function coachFlags_(planOut, runsAll, today, todayRow, curWk, meta) {
  var out = [];
  var t = isoToDay_(today);
  var md = today.substring(5);
  if (CONFIG.smogReminder && (md >= '11-01' || md <= '01-31')) out.push({ level: 'info', text: 'Smog season: check the AQI before outdoor runs. Above 200, use a treadmill or cross-train indoors.' });
  if (curWk > 0 && curWk < 99) {
    var wkRows = planOut.filter(function (p) { return p.wk === curWk; });
    var plannedSoFar = 0, actualSoFar = 0, missed = 0;
    wkRows.forEach(function (p) {
      if (p.iso < today && (p.type === 'Run' || p.type === 'Race')) plannedSoFar += p.pMin || 0;
      if (p.iso < today && p.type !== 'Rest' && (p.status === 'Missed' || p.status === 'Skipped')) missed++;
    });
    runsAll.forEach(function (a) {
      var row = planOut.filter(function (p) { return p.iso === a.iso; })[0];
      if (row && row.wk === curWk && a.iso < today) actualSoFar += a.min;
    });
    if (plannedSoFar >= 60 && actualSoFar > plannedSoFar * 1.15) out.push({ src: 'strava', level: 'warn', text: 'You are ahead of plan this week (' + Math.round(actualSoFar) + ' vs ' + plannedSoFar + ' planned run minutes). Hold back, the plan already has the load you need.' });
    if (missed >= 2) out.push({ src: 'strava', level: 'warn', text: 'Two or more sessions missed this week. Do not cram them in: repeat this week’s plan or skip them.' });
  }
  var easyRuns = planOut.filter(function (p) {
    return p.iso <= today && p.aHR && /^(Easy|Recovery|Long|Shakeout|First)/.test(p.session);
  }).slice(-4);
  var hot = easyRuns.filter(function (p) { return p.aHR > CONFIG.easyHRWarn; });
  if (CONFIG.easyHRWarn > 0 && easyRuns.length >= 2 && hot.length >= 2) out.push({ src: 'strava', level: 'warn', text: 'Your easy runs are averaging above ' + CONFIG.easyHRWarn + ' bpm. Slow down: easy should feel conversational (HR ≤ ' + CONFIG.easyHRCap + ').' });
  if (meta.connected && meta.lastSync) {
    var hrs = (Date.now() - new Date(meta.lastSync + '+05:30').getTime()) / 3600000;
    if (hrs > 30) out.push({ src: 'strava', level: 'info', text: 'Strava has not synced for over a day. Press the Sync button or check the hourly trigger.' });
  }
  return out;
}

function buildDashboard_(plan, strava, races, goals, refs, today, meta, ctx) {
  var weeksInfo = (ctx && ctx.weeks) || WEEKS;
  var testList = (ctx && ctx.tests) || TESTS;
  var t = isoToDay_(today);
  var planStart = plan.length ? plan[0].iso : (CONFIG.planStart || today);
  var planEnd = plan.length ? plan[plan.length - 1].iso : planStart;
  var wkOf = {};
  plan.forEach(function (p) { wkOf[p.iso] = p.wk; });
  var runsAll = strava.filter(isRun_);
  var runs = runsAll.filter(function (a) { return a.iso >= planStart && a.iso <= planEnd; });

  var planOut = plan.map(function (p) {
    return { iso: p.iso, slot: p.slot, locked: !!p.locked, dow: p.day || dowName_(p.iso), wk: p.wk, phase: p.phase, type: p.type, session: p.session, details: p.details,
      target: p.target, pMin: p.pMin, pKm: p.pKm, status: effStatus_(p), auto: p.auto, ovr: p.ovr, aKm: p.aKm, aMin: p.aMin, aHR: p.aHR,
      mHR: p.mHR, pace: cleanPace_(p.pace, p.aKm, p.aMin), link: p.link, rhr: p.rhr, hrv: p.hrv, sleep: p.sleep, sore: p.sore, rpe: p.rpe, testHR: p.testHR, notes: p.notes };
  });
  var todayRows = planOut.filter(function (p) { return p.iso === today; });
  var todayRow = todayRows.length ? todayRows[0] : null;
  var curWk = todayRow ? todayRow.wk : (today < planStart ? 0 : 99);
  var totalWeeks = 0;
  plan.forEach(function (p) { if (p.wk > totalWeeks) totalWeeks = p.wk; });

  // weekly roll-up
  var weeks = [];
  for (var w = 1; w <= totalWeeks; w++) {
    var rows = planOut.filter(function (p) { return p.wk === w; });
    if (!rows.length) continue;
    var wr = runs.filter(function (a) { return wkOf[a.iso] === w; });
    var pl = 0, sess = 0, dn = 0, pt = 0;
    rows.forEach(function (p) {
      if (p.type === 'Run' || p.type === 'Race') pl += p.pMin || 0;
      if (p.type !== 'Rest') { sess++; if (p.status === 'Done') dn++; if (p.status === 'Partial') pt++; }
    });
    var info = weeksInfo[w] || WEEKS[w] || {};
    weeks.push({ wk: w, phase: rows[0].phase, focus: info.focus || '', key: info.key || '', start: rows[0].iso, pMin: pl,
      aMin: Math.round(sumBy_(wr, 'min')), aKm: round1_(sumBy_(wr, 'km')), sessions: sess, done: dn, partial: pt });
  }

  // progress
  var due = planOut.filter(function (p) {
    if (p.type === 'Rest') return false;
    if (p.iso < today) return true;
    return p.iso === today && (p.status === 'Done' || p.status === 'Partial');
  });
  var doneN = due.filter(function (p) { return p.status === 'Done'; }).length;
  var partN = due.filter(function (p) { return p.status === 'Partial'; }).length;
  var runRows = planOut.filter(function (p) { return (p.type === 'Run' || p.type === 'Race') && p.iso <= today; });
  if (runRows.length && runRows[runRows.length - 1].iso === today && runRows[runRows.length - 1].status !== 'Done') runRows.pop();
  var streak = 0, i;
  for (i = runRows.length - 1; i >= 0; i--) { if (runRows[i].status === 'Done') streak++; else break; }
  var best = 0, cur = 0;
  runRows.forEach(function (p) { if (p.status === 'Done') { cur++; if (cur > best) best = cur; } else cur = 0; });
  var longestMin = 0, longestKm = 0;
  runs.forEach(function (a) { if (a.min > longestMin) longestMin = a.min; if (a.km > longestKm) longestKm = a.km; });
  var stats = {
    completionPct: due.length ? (doneN + 0.5 * partN) / due.length : 0, doneCount: doneN, partialCount: partN, plannedCount: due.length,
    totalKm: round1_(sumBy_(runs, 'km')), runMin: Math.round(sumBy_(runs, 'min')), runs: runs.length,
    longestMin: Math.round(longestMin), longestKm: round1_(longestKm), streak: streak, bestStreak: best,
    hoursOnFeet: round1_(sumBy_(runs, 'min') / 60)
  };

  // races & hero
  var racesOut = races.map(function (r) { return { iso: r.iso, name: r.name, km: r.km, goal: r.goal, notes: r.notes, daysTo: Math.max(0, isoToDay_(r.iso) - t), past: r.iso < today }; });
  var mainRace = null;
  races.forEach(function (r) { if (!mainRace && r.km > 40) mainRace = r; });
  var daysToMain = null, mainPct = 0;
  if (mainRace) {
    daysToMain = Math.max(0, isoToDay_(mainRace.iso) - t);
    var span = isoToDay_(mainRace.iso) - isoToDay_(planStart);
    mainPct = span > 0 ? Math.min(1, Math.max(0, (t - isoToDay_(planStart)) / span)) : 0;
  }
  var wInfo = weeksInfo[curWk] || WEEKS[curWk] || {};
  var hero = {
    wk: curWk, totalWeeks: totalWeeks, phase: todayRow ? todayRow.phase : (today < planStart ? 'Starts ' + planStart : 'Plan complete'),
    focus: wInfo.focus || '', motivation: wInfo.motivation || 'Keep showing up.', dayOfPlan: plan.length ? Math.max(0, t - isoToDay_(planStart) + 1) : 0,
    totalDays: plan.length, daysToMain: daysToMain, mainName: mainRace ? mainRace.name : '', mainPct: mainPct
  };

  // tests (HR checkpoints)
  var tests = testList.map(function (x) {
    var actual = null;
    planOut.forEach(function (p) { if (p.iso === x.iso && actual === null && p.testHR !== null && p.testHR !== undefined) actual = p.testHR; });
    var st;
    if (actual === null || actual === undefined) st = x.iso < today ? 'Not logged' : 'Upcoming';
    else if (x.target === null) st = 'Logged';
    else st = actual <= x.target ? 'Target met' : 'Keep building';
    return { iso: x.iso, label: x.label, session: x.session, target: x.target, actual: (actual === undefined ? null : actual), status: st };
  });

  // aerobic efficiency on easy-ish runs
  var eff = runsAll.filter(function (a) { return a.min >= 20 && a.min <= 75 && a.avgHR && a.avgHR >= 120 && a.avgHR <= 160 && a.km > 0; })
    .sort(function (a, b) { return (a.iso + a.time) < (b.iso + b.time) ? -1 : 1; })
    .map(function (a) {
      return { iso: a.iso, eff: round1_((a.km * 1000 / a.min) / a.avgHR * 100), hr: a.avgHR, pace: fmtPace_(a.min * 60 / a.km) };
    });

  // recent activities
  var recent = strava.slice().sort(function (a, b) { return (a.iso + a.time) < (b.iso + b.time) ? 1 : -1; }).slice(0, 8).map(function (a) {
    return { iso: a.iso, time: a.time, name: a.name, sport: a.sport, km: a.km, min: a.min, hr: a.avgHR, maxHR: a.maxHR, elev: a.elev,
      pace: ((isRun_(a) || /walk/i.test(String(a.sport || ''))) && a.km > 0 && a.min > 0) ? fmtPace_(a.min * 60 / a.km) : '', link: a.source === 'Health Connect' ? '' : 'https://www.strava.com/activities/' + a.id, source: a.source || 'Strava' };
  });

  // badges
  var badges = [];
  badges.push({ icon: '👟', title: 'Back on the road', desc: 'Log your first run of the plan', earned: runs.length >= 1 });
  [25, 50, 100, 150, 200, 300, 400, 500].forEach(function (k) {
    badges.push({ icon: '📏', title: k + ' km club', desc: 'Run ' + k + ' km in total during the plan', earned: stats.totalKm >= k });
  });
  [90, 120, 150, 180, 210].forEach(function (m) {
    badges.push({ icon: '⏱️', title: (m / 60 >= 2 ? (m / 60) + '-hour' : m + '-minute') + ' long run', desc: 'One run of ' + m + ' minutes or more', earned: longestMin >= m });
  });
  [3, 5, 10, 20].forEach(function (s) {
    badges.push({ icon: '🔥', title: s + '-run streak', desc: s + ' planned runs done in a row', earned: best >= s });
  });
  var perfect = weeks.some(function (wk) { return wk.start < today && wk.sessions > 0 && wk.done === wk.sessions; });
  badges.push({ icon: '✅', title: 'Perfect week', desc: 'Every session in a week done', earned: perfect });
  badges.push({ icon: '💓', title: 'HR test passed', desc: 'Hit the target HR in a checkpoint test', earned: tests.some(function (x) { return x.status === 'Target met'; }) });
  races.forEach(function (r) {
    var fin = runsAll.some(function (a) { return a.iso === r.iso && a.km >= 0.9 * r.km; });
    badges.push({ icon: '🏁', title: r.name + ' finisher', desc: 'Finish the race on ' + r.iso, earned: fin });
  });

  var rd = readiness_(plan, today);
  var flags = coachFlags_(planOut, runsAll, today, todayRow, curWk, meta);

  return {
    now: { today: today, dow: dowName_(today), lastSync: meta.lastSync || '', connected: !!meta.connected, nowIso: meta.nowIso || '', autoSync: (meta.autoSync === undefined ? null : meta.autoSync), syncError: meta.syncError || '', useStrava: CONFIG.useStrava !== false },
    name: CONFIG.name, appTitle: CONFIG.appTitle, appSub: CONFIG.appSub, planStart: planStart, planEnd: planEnd, hero: hero, today: todayRow, todayRows: todayRows, plan: planOut, readiness: rd, flags: flags,
    weeks: weeks, stats: stats, races: racesOut, tests: tests, efficiency: eff, goals: goals, refs: refs, recent: recent, badges: badges,
    testsNote: CONFIG.testsNote || '', thresholds: { restHR: CONFIG.flagRestHR, baselineRestHR: CONFIG.baselineRestHR, baselineHRV: CONFIG.baselineHRV }
  };
}

// The summary is pasted into an AI chat. Strava's API rules do not allow Strava-derived data (distance, time, HR, pace,
// statuses worked out from Strava, totals, streaks) to go into an AI tool, so none of it is included here.
// Only the plan, the athlete's own check-ins, notes, RPE, manual statuses and HR test entries are used.
// The summary is pasted into an AI chat. Strava's API rules do not allow Strava-derived data (distance, time, HR, pace,
// statuses worked out from Strava, totals, streaks) to go into an AI tool, so none of it is included here.
// Only the plan, the athlete's own check-ins, notes, RPE, manual statuses and HR test entries are used.
function buildSummary_(d) {
  var t = isoToDay_(d.now.today);
  var L = [];
  L.push('Weekly check-in for Claude: ' + d.name + ', training plan, week ' + d.hero.wk + ' of ' + d.hero.totalWeeks + ' (' + d.hero.phase + '), generated ' + d.now.today);
  L.push('Note: this summary has only my plan, my own check-ins, notes and manual entries. It does not contain my Strava activity data. Please read my last 7 days of activities through the Strava connector and combine them with this.');
  L.push('');
  L.push('LAST 7 DAYS (what was planned, and what I entered myself)');
  d.plan.filter(function (p) { var x = isoToDay_(p.iso); return x <= t && x > t - 7; }).forEach(function (p) {
    var man = [];
    if (p.rhr !== null) man.push('resting HR ' + p.rhr);
    if (p.hrv !== null) man.push('HRV ' + p.hrv);
    if (p.sleep !== null) man.push('sleep ' + p.sleep + ' h');
    if (p.sore !== null) man.push('soreness ' + p.sore + '/5');
    if (p.rpe !== null) man.push('RPE ' + p.rpe);
    L.push('- ' + p.dow + ' ' + p.iso + ' | ' + p.session + ' (' + p.type + ', planned ' + (p.pMin || 0) + ' min) | my status: ' + (p.ovr ? p.ovr + ' (set manually)' : 'none entered') +
      (man.length ? ' | ' + man.join(', ') : '') + (p.notes ? ' | note: ' + p.notes : ''));
  });
  L.push('');
  L.push('READINESS (from my own check-ins): ' + d.readiness.title + '. ' + d.readiness.text);
  var tl = d.tests.filter(function (x) { return x.actual !== null; });
  if (tl.length) {
    L.push('');
    L.push('HR CHECKPOINTS I ENTERED');
    tl.forEach(function (x) { L.push('- ' + x.label + ' (' + x.iso + ', ' + x.session + '): target ' + (x.target === null ? 'n/a' : x.target) + ', my entry ' + x.actual); });
  }
  var fl = d.flags.filter(function (f) { return f.src !== 'strava'; });
  if (fl.length) {
    L.push('');
    L.push('FLAGS');
    fl.forEach(function (f) { L.push('- ' + f.text); });
  }
  L.push('');
  L.push('NEXT 7 DAYS (planned)');
  d.plan.filter(function (p) { var x = isoToDay_(p.iso); return x > t && x <= t + 7; }).forEach(function (p) {
    L.push('- ' + p.dow + ' ' + p.iso + ' | ' + p.session + ' | ' + (p.pMin || 0) + ' min | ' + p.target);
  });
  L.push('');
  L.push('Please review my week using my Strava activities (via the connector) together with the check-ins above, and suggest any changes to next week (volume, quality sessions, rest) and to my pace and HR targets.');
  return L.join('\n');
}


// ------------------------------------------------------------------ data for this edition
var EDITION = {"menu":"🏃 Training HQ","simple":true,"settings":{"appTitle":"My Training HQ","appSub":"","name":"Friend","timezone":"Asia/Kolkata","useStrava":true,"smogReminder":false,"baselineRestHR":60,"flagRestHR":0,"baselineHRV":0,"flagHRV":0,"flagSleep":6,"flagSoreness":4,"easyHRCap":0,"easyHRWarn":0,"stravaAfter":"","planStart":""}};
var PLAN = [

];
var WEEKS = {};
var RACES = [];
var TESTS = [];
var GOALS = [];
var REFS = [];
Object.keys(EDITION.settings).forEach(function (k) { CONFIG[k] = EDITION.settings[k]; });
 

// ======================================================================
// Health Sync -> Google Drive CSV -> Training HQ (optional integration).
// Unlike Strava, CSV formats are not standardised. Unrecognized CSVs
// are reported, NEVER silently guessed. Run Preview first.
// ======================================================================
var HEALTH_WORKOUT_HEADERS = ['Key','Date','Start','Name','Sport','Distance km','Moving min','Avg HR','Max HR','Source file','Reported distance km','GPS distance km','Distance source'];
var HEALTH_METRIC_HEADERS = ['Date','Resting HR','HRV ms','Sleep h','Steps','Calories kcal','VO2max','Source files'];
var HEALTH_ALIASES = {
 date:['date','day','recorddate','localdate','startdate','starttime','startdatetime','starttimestamp','datetime','timestamp','time'],
 start:['start','starttime','startdatetime','starttimestamp','time','datetime'],
 sport:['sport','sporttype','activitytype','exercisetype','workouttype','type'],
 name:['name','title','activityname','exercisename','workoutname'],
 minutes:['movingmin','durationmin','durationminutes','minutes','elapsedminutes','activeminutes','durationmins'],
 seconds:['durationseconds','movingtime','elapsedtime','durationsec','durationsecs'],
 duration:['duration','durationms','durationmilliseconds'],
 km:['distancekm','kilometers','distancekilometers'],
 meters:['distancem','distancemeters','distanceinmeters'],
 distance:['distance'],
 avgHR:['averageheartrate','avgheartrate','avghr','meanheartrate'],
 maxHR:['maxheartrate','maximumheartrate','maxhr'],
 rhr:['restingheartrate','restinghr','rhr'],
 hrv:['heartratevariability','heartratevariabilityrmssd','hrvrmssd','hrvms','hrv'],
 sleep:['sleephours','totalsleephours','sleepdurationhours','sleepdurationh'],
 sleepMinutes:['sleepminutes','totalsleepminutes'],
 sleepSeconds:['sleepseconds','totalsleepseconds'],
 steps:['steps','stepcount','totalsteps'],
 calories:['calories','calorieskcal','activecalories','activeenergyburnedkcal','energykcal'],
 vo2:['vo2max','vo2maximum','maximaloxygenconsumption']
};
function healthNorm_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g,''); }
function healthCols_(headers) {
  var cols = {};
  Object.keys(HEALTH_ALIASES).forEach(function(k) {
    var options = HEALTH_ALIASES[k];
    for (var j = 0; j < options.length; j++) {
      var idx = headers.map(healthNorm_).indexOf(options[j]);
      if (idx >= 0) { cols[k] = idx; break; }
    }
  });
  return cols;
}
function healthV_(row, cols, k) { return cols[k] === undefined ? '' : String(row[cols[k]] || '').trim(); }
function healthNum_(x) {
  var s = String(x || '').trim().replace(/,/g,'');
  if (!s || !/^-?\d+(?:\.\d+)?$/.test(s)) return null;
  var n = Number(s); return isFinite(n) ? n : null;
}
function healthISO_(value) {
  var s = String(value || '').trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  var iso = m[1]+'-'+m[2]+'-'+m[3];
  var d = new Date(iso+'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0,10) === iso ? iso : '';
}
function healthTime_(value) {
  var s = String(value || '');
  var m = s.match(/(?:T|\s)(\d{2}:\d{2})/);
  return m ? m[1] : '';
}
function healthSport_(s) {
  s = String(s || '').toLowerCase();
  if (/run|jogg|treadmill/.test(s)) return 'Run';
  if (/strength|weight|resistance|gym|functional|circuit/.test(s)) return 'WeightTraining';
  if (/yoga|pilates|stretch/.test(s)) return 'Yoga';
  if (/cycl|bike|spin/.test(s)) return 'Ride';
  if (/walk|hik/.test(s)) return 'Walk';
  if (/swim/.test(s)) return 'Swim';
  // Health Sync exports generic exercise with the literal activity type TRAINING.
  // Keep it as a generic workout rather than assuming it was weight training.
  if (/training|workout|exercise|fitness/.test(s)) return 'Workout';
  return '';
}
function healthFileKind_(name, cols) {
  var f = healthNorm_(name), workout = /activity|exercise|workout|training|session/.test(f);
  // Only treat a file as a workout file with sport + duration information,
  // or when its name says it's workouts and it has a duration.
  if ((cols.sport !== undefined || workout) && (cols.minutes !== undefined || cols.seconds !== undefined || cols.duration !== undefined)) return 'workout';
  if (['rhr','hrv','sleep','sleepMinutes','sleepSeconds','steps','calories','vo2'].some(function(k){return cols[k] !== undefined;})) return 'metrics';
  // Some exporters call a single value column 'Value' and describe its metric in the filename.
  if (cols.date !== undefined && (cols.value !== undefined || /restingheartrate|heartratevariability|hrv|sleep|steps|vo2max/.test(f))) return 'unknown-single-value';
  return 'unknown';
}
function healthSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.setFrozenRows(1);
  }
  // Refresh header when new columns are added to an existing import sheet.
  sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold');
  return sh;
}
function healthFolder_() {
  var id = PropertiesService.getScriptProperties().getProperty('HEALTH_FOLDER_ID');
  if (!id) throw new Error('Set the Drive folder first: Training HQ -> Health Sync: 1. Set Drive folder');
  return DriveApp.getFolderById(id);
}
function healthConfigureFolder() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Health Sync Google Drive folder', 'Paste the URL or folder ID of the PRIVATE folder where Health Sync exports CSV files. You must own or have access to the folder.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var s = r.getResponseText().trim();
  var m = s.match(/\/folders\/([A-Za-z0-9_-]+)/);
  var id = m ? m[1] : s;
  try { var f = DriveApp.getFolderById(id); f.getName(); }
  catch(e) { ui.alert('Cannot open that folder. Check the Google account and URL. '+String(e.message || e)); return; }
  PropertiesService.getScriptProperties().setProperty('HEALTH_FOLDER_ID',id);
  ui.alert('Folder saved. Now choose Health Sync: 2. Preview exports.');
}
// Search Health Sync's automatically created subfolders as well as the selected folder.
function healthExportFiles_() {
  var queue=[healthFolder_()], depth=[0], all=[], scanned=0;
  while(queue.length && scanned<80 && all.length<600) {
    var folder=queue.shift(), level=depth.shift(); scanned++;
    var items=folder.getFiles();
    while(items.hasNext() && all.length<600) {
      var file=items.next(), name=file.getName();
      if (/\.(csv|tcx)$/i.test(name)) all.push(file);
    }
    if(level<4) {
      var sub=folder.getFolders();
      while(sub.hasNext() && queue.length<80) {queue.push(sub.next());depth.push(level+1);}
    }
  }
  all.sort(function(a,b){return b.getLastUpdated().getTime()-a.getLastUpdated().getTime();});
  return all;
}
function healthFiles_() {
  return healthExportFiles_().filter(function(f){return /\.csv$/i.test(f.getName()) && f.getSize()<=3000000;}).slice(0,200);
}
function healthPreviewMenu() {
  var ui = SpreadsheetApp.getUi();
  try {
    var files = healthFiles_();
    if (!files.length) {ui.alert('No CSV files found in the selected Drive folder or its subfolders. Confirm Health Sync exported CSV files and this Google account can read them.');return;}
    var lines = [];
    files.slice(0,12).forEach(function(file) {
      try {
        var csv = Utilities.parseCsv(file.getBlob().getDataAsString('UTF-8').replace(/^\uFEFF/,''));
        var h = csv.length ? csv[0] : [], cols = healthCols_(h);
        lines.push(file.getName()+' ['+healthFileKind_(file.getName(),cols)+']');
        lines.push('  Columns: '+h.slice(0,18).join(' | ').slice(0,500));
      } catch(e) { lines.push(file.getName()+': '+String(e)); }
    });
    ui.alert('Health Sync CSV preview ('+files.length+' files found)',lines.join('\n').slice(0,7500),ui.ButtonSet.OK);
  } catch(e) {ui.alert('Preview failed: '+String(e.message || e));}
}
function healthDuration_(row,cols) {
  var m = healthNum_(healthV_(row,cols,'minutes'));
  if (m !== null) return m;
  var s = healthNum_(healthV_(row,cols,'seconds'));
  if (s !== null) return s/60;
  var raw = healthV_(row,cols,'duration');
  var a = raw.match(/^(\d{1,3}):(\d{2}):(\d{2})$/);
  if (a) return +a[1]*60+(+a[2])+(+a[3])/60;
  // The unit for a plain 'duration' value is ambiguous. Do not assume seconds.
  return null;
}
function healthParseCsv_(file, workouts, daily, report) {
  var content = file.getBlob().getDataAsString('UTF-8').replace(/^\uFEFF/,'');
  var rows = Utilities.parseCsv(content);
  if (rows.length < 2) return;
  var cols = healthCols_(rows[0]), kind = healthFileKind_(file.getName(),cols), accepted = 0;
  if (kind === 'unknown' || kind === 'unknown-single-value' || cols.date === undefined) {
    report.push(['SKIP',file.getName(),kind,'Unrecognized columns: '+rows[0].join(' | ').slice(0,700)]); return;
  }
  rows.slice(1,10001).forEach(function(row) {
    if (!row.length) return;
    var iso = healthISO_(healthV_(row,cols,'date'));
    if (!iso) return;
    if (kind === 'workout') {
      var sportRaw = healthV_(row,cols,'sport') || healthV_(row,cols,'name');
      var sport = healthSport_(sportRaw);
      var min = healthDuration_(row,cols);
      if (!sport || min === null || min <= 0 || min > 1440) return;
      var start = healthTime_(healthV_(row,cols,'start') || healthV_(row,cols,'date'));
      // Reject unknown units in generic distance: no unsafe assumptions.
      var km = healthNum_(healthV_(row,cols,'km'));
      var meters = healthNum_(healthV_(row,cols,'meters'));
      if (km === null && meters !== null) km = meters/1000;
      if (km === null) km = 0;
      if (km < 0 || km > 500) return;
      var avg = healthNum_(healthV_(row,cols,'avgHR'));
      var max = healthNum_(healthV_(row,cols,'maxHR'));
      var name = healthV_(row,cols,'name') || sportRaw || sport;
      var key = [iso,start,sport,Math.round(min),Math.round(km*10)/10].join('|');
      workouts[key] = [key,iso,start,name,sport,Math.round(km*100)/100,Math.round(min*10)/10,avg||'',max||'',file.getName()];
      accepted++;
    } else {
      if (!daily[iso]) daily[iso] = { iso:iso, files:{} };
      var d=daily[iso]; d.files[file.getName()] = true;
      [['rhr','rhr'],['hrv','hrv'],['sleep','sleep'],['steps','steps'],['calories','calories'],['vo2','vo2']].forEach(function(pair) {
        var n = healthNum_(healthV_(row,cols,pair[0]));
        if (n !== null && n >= 0) d[pair[1]] = n;
      });
      var sm = healthNum_(healthV_(row,cols,'sleepMinutes'));
      var ss = healthNum_(healthV_(row,cols,'sleepSeconds'));
      if (sm !== null) d.sleep = sm/60;
      else if (ss !== null) d.sleep = ss/3600;
      accepted++;
    }
  });
  report.push(['READ',file.getName(),kind,accepted+' rows accepted']);
}
function healthReadWorkouts_(ss) {
  var sh=ss.getSheetByName('HealthWorkouts');
  if (!sh || sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,10).getValues().filter(function(r){return r[1];}).map(function(r){
    return {id:'health:'+r[0],iso:toIso_(r[1]),time:String(r[2]||''),name:r[3],sport:r[4],km:Number(r[5])||0,min:Number(r[6])||0,avgHR:num_(r[7]),maxHR:num_(r[8]),elev:0,effort:null,speed:null,source:'Health Connect'};
  });
}
function healthMergedActivities_(ss) {
  var strava=readStrava_(ss), health=healthReadWorkouts_(ss);
  // Prefer Strava if it has essentially the same workout, otherwise include Health Connect.
  health.forEach(function(h) {
    var dup=strava.some(function(s){
      if (s.iso!==h.iso) return false;
      var sameKind = isRun_(s) === isRun_(h) && (isRun_(h) || healthSport_(s.sport)===h.sport);
      var sameTime = s.time && h.time ? Math.abs((+s.time.slice(0,2)*60 + +s.time.slice(3,5))-(+h.time.slice(0,2)*60 + +h.time.slice(3,5)))<=15 : false;
      var durationMatch = Math.abs(s.min-h.min) <= Math.max(3,0.15*h.min);
      return sameKind && durationMatch && sameTime;
    });
    if (!dup) strava.push(h);
  });
  return strava;
}
function healthFillCheckins_(ss, daily) {
  var sh = ss.getSheetByName('Plan'); if(!sh || sh.getLastRow()<2) return;
  var rows=sh.getRange(2,1,sh.getLastRow()-1,1).getValues();
  rows.forEach(function(r,i) {
    var d=daily[toIso_(r[0])]; if(!d) return;
    [[COL.RHR,'rhr'],[COL.HRV,'hrv'],[COL.SLEEP,'sleep']].forEach(function(x){
      var val=d[x[1]]; if (val===undefined || val===null) return;
      var cell=sh.getRange(i+2,x[0]);
      if (cell.isBlank()) cell.setValue(Math.round(val*10)/10);
    });
  });
}
function healthImport_() {
  var files=healthFiles_();
  if(!files.length) throw new Error('No CSV files in the selected Google Drive folder.');
  var report=[], workouts={}, daily={};
  files.forEach(function(file){
    try {healthParseCsv_(file,workouts,daily,report);}
    catch(e){report.push(['ERROR',file.getName(),'CSV parse error',String(e.message || e).slice(0,600)]);}
  });
  var ss=getSS_(), wsh=healthSheet_(ss,'HealthWorkouts',HEALTH_WORKOUT_HEADERS), msh=healthSheet_(ss,'HealthMetrics',HEALTH_METRIC_HEADERS),
      rsh=healthSheet_(ss,'HealthImportLog',['Status','File','Category','Details']);
  var wr=Object.keys(workouts).sort().map(function(k){return workouts[k];});
  var mr=Object.keys(daily).sort().map(function(k){var d=daily[k];return [k,d.rhr||'',d.hrv||'',d.sleep||'',d.steps||'',d.calories||'',d.vo2||'',Object.keys(d.files).join(', ')];});
  // Only replace an existing import if there are usable records. Unknown formats remain in preview/log.
  if (wr.length) {if(wsh.getLastRow()>1)wsh.getRange(2,1,wsh.getLastRow()-1,10).clearContent();wsh.getRange(2,1,wr.length,10).setValues(wr);}
  if (mr.length) {if(msh.getLastRow()>1)msh.getRange(2,1,msh.getLastRow()-1,8).clearContent();msh.getRange(2,1,mr.length,8).setValues(mr);}
  if(rsh.getLastRow()>1)rsh.getRange(2,1,rsh.getLastRow()-1,4).clearContent();
  if(report.length)rsh.getRange(2,1,report.length,4).setValues(report);
  healthFillCheckins_(ss,daily);
  applyToPlan_(ss);
  PropertiesService.getScriptProperties().setProperty('HEALTH_LAST_SYNC',Utilities.formatDate(new Date(),TZ,"yyyy-MM-dd'T'HH:mm:ss"));
  return {files:files.length,workouts:wr.length,metricDays:mr.length,skipped:report.filter(function(x){return x[0]!=='READ';}).length};
}
function healthSyncSafe_() {
  var lock=LockService.getScriptLock(); if(!lock.tryLock(15000))throw new Error('Import already running');
  try {var r=healthImport_();PropertiesService.getScriptProperties().deleteProperty('HEALTH_ERROR');return r;}
  catch(e){PropertiesService.getScriptProperties().setProperty('HEALTH_ERROR',String(e.message||e).slice(0,250));throw e;}
  finally {lock.releaseLock();}
}
function healthImportMenu(){
  var ui=SpreadsheetApp.getUi();
  try {var r=healthSyncSafe_();ui.alert('Health Sync imported',r.files+' files scanned; '+r.workouts+' workouts; '+r.metricDays+' days of metrics; '+r.skipped+' unsupported files. Check HealthImportLog and HealthMetrics tabs.',ui.ButtonSet.OK);}
  catch(e){ui.alert('Health Sync import failed: '+String(e.message||e));}
}
function healthSyncScheduled(){ if(PropertiesService.getScriptProperties().getProperty('HEALTH_FOLDER_ID')) healthSyncSafe_(); }
function healthInstallTrigger(){
  ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()==='healthSyncScheduled')ScriptApp.deleteTrigger(t);});
  ScriptApp.newTrigger('healthSyncScheduled').timeBased().everyMinutes(30).create();
  SpreadsheetApp.getUi().alert('Health Sync importer scheduled approximately every 30 minutes.');
}
function healthDashboardInfo_(ss,iso){
  var props=PropertiesService.getScriptProperties(),sh=ss.getSheetByName('HealthMetrics'), today={};
  if(sh && sh.getLastRow()>1){
    var all=sh.getRange(2,1,sh.getLastRow()-1,7).getValues();
    all.forEach(function(r){if(toIso_(r[0])===iso) today={rhr:num_(r[1]),hrv:num_(r[2]),sleep:num_(r[3]),steps:num_(r[4]),calories:num_(r[5]),vo2:num_(r[6])};});
  }
  var wh=ss.getSheetByName('HealthWorkouts');
  return {configured:!!props.getProperty('HEALTH_FOLDER_ID'),lastSync:props.getProperty('HEALTH_LAST_SYNC')||'',error:props.getProperty('HEALTH_ERROR')||'',today:today,workouts:wh?Math.max(0,wh.getLastRow()-1):0};
}


// =====================================================================
// Health Sync exports: verified format of Nothing SmartCenter (Nov 2026)
// Supports dotted dates, workout summary CSV, daily raw HR CSV, TCX HR/GPS.
// Import only CSV + TCX; do not claim that FIT is decoded.
// =====================================================================
var HEALTH_HR_HEADERS=['Date','Local time','Heart rate','Source file','Source app'];
var HEALTH_TRACK_HEADERS=['Activity key','Date','Local time','Elapsed sec','Latitude','Longitude','Heart rate','Source file'];
function healthISO_(v){
  var s=String(v||'').trim(),m=s.match(/^(\d{4})[.\/-](\d{2})[.\/-](\d{2})/);
  if(!m)return '';
  var iso=m[1]+'-'+m[2]+'-'+m[3], d=new Date(iso+'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0,10)===iso ? iso : '';
}
function healthTime_(v){
  var s=String(v||''),m=s.match(/(?:T|\s)(\d{2}:\d{2})(?::\d{2})?/);
  return m?m[1]:(/^\d{2}:\d{2}/.test(s)?s.slice(0,5):'');
}
function healthCols_(headers){
  var cols={},n=headers.map(healthNorm_);
  Object.keys(HEALTH_ALIASES).forEach(function(k){
    for(var j=0;j<HEALTH_ALIASES[k].length;j++){
      var idx=n.indexOf(HEALTH_ALIASES[k][j]);if(idx>=0){cols[k]=idx;break;}
    }
  });
  var add={sport:['activitytype'],name:['activityname'],seconds:['activetime','elapsedtime'],
    km:['distancekm'],avgHR:['averageheartrate'],maxHR:['maxheartrate'],
    heartRate:['heartrate'],source:['source','sourceapp'], time:['time'],
    workoutSteps:['steps'], workoutCalories:['calorieskcal']};
  Object.keys(add).forEach(function(k){if(cols[k]!==undefined)return;for(var i=0;i<add[k].length;i++){var idx=n.indexOf(add[k][i]);if(idx>=0){cols[k]=idx;break;}}});
  return cols;
}
function healthFileKind_(name,cols){
  if(cols.heartRate!==undefined && cols.date!==undefined && cols.sport===undefined) return 'heart-rate';
  if(cols.sport!==undefined && (cols.seconds!==undefined||cols.minutes!==undefined||cols.duration!==undefined))return 'workout';
  if(['rhr','hrv','sleep','sleepMinutes','sleepSeconds','steps','calories','vo2'].some(function(k){return cols[k]!==undefined;}))return 'metrics';
  return 'unknown';
}
function healthDuration_(row,cols){
  var m=healthNum_(healthV_(row,cols,'minutes'));if(m!==null)return m;
  var sec=healthNum_(healthV_(row,cols,'seconds'));if(sec!==null)return sec/60;
  var raw=healthV_(row,cols,'duration'),a=raw.match(/^(\d{1,3}):(\d{2}):(\d{2})$/);
  return a?+a[1]*60+ +a[2]+ +a[3]/60:null;
}
function healthParseCsv_(file,workouts,daily,report,hr){
  var rows=Utilities.parseCsv(file.getBlob().getDataAsString('UTF-8').replace(/^\uFEFF/,''));
  if(rows.length<2)return;
  var cols=healthCols_(rows[0]),kind=healthFileKind_(file.getName(),cols),accepted=0;
  if(kind==='unknown'||cols.date===undefined){report.push(['SKIP',file.getName(),kind,'Columns: '+rows[0].join(' | ').slice(0,700)]);return;}
  rows.slice(1,100001).forEach(function(row){
    var dateText=healthV_(row,cols,'date'),iso=healthISO_(dateText);if(!iso)return;
    if(kind==='heart-rate'){
      var bpm=healthNum_(healthV_(row,cols,'heartRate'));
      if(bpm===null||bpm<25||bpm>250)return;
      var timeMatch=String(dateText).match(/(?:T|\s)(\d{2}:\d{2}:\d{2})/);
      var fullTime=timeMatch?timeMatch[1]:(healthV_(row,cols,'time')||healthTime_(dateText));
      var key=[iso,fullTime,bpm,healthV_(row,cols,'source')].join('|');
      hr[key]=[iso,fullTime,bpm,file.getName(),healthV_(row,cols,'source')];accepted++;return;
    }
    if(kind==='workout'){
      var sportRaw=healthV_(row,cols,'sport')||healthV_(row,cols,'name'),sport=healthSport_(sportRaw),min=healthDuration_(row,cols);
      if(!sport||min===null||min<=0||min>1440)return;
      var start=healthTime_(dateText)||healthTime_(healthV_(row,cols,'time'));
      var km=healthNum_(healthV_(row,cols,'km'));
      if(km===null){var meters=healthNum_(healthV_(row,cols,'meters'));if(meters!==null)km=meters/1000;}
      if(km===null)km=0;if(km<0||km>500)return;
      var avg=healthNum_(healthV_(row,cols,'avgHR')),max=healthNum_(healthV_(row,cols,'maxHR'));
      var title=healthV_(row,cols,'name');if(!title||title.toLowerCase()==='null')title=sportRaw;
      var key=[iso,start,sport,Math.round(min)].join('|');
      workouts[key]=[key,iso,start,title,sport,Math.round(km*1000)/1000,Math.round(min*100)/100,avg===null?'':avg,max===null?'':max,Math.round(km*1000)/1000,'','Reported (CSV)'];
      accepted++;return;
    }
    if(!daily[iso])daily[iso]={iso:iso,files:{}};
    var d=daily[iso];d.files[file.getName()]=true;
    [['rhr','rhr'],['hrv','hrv'],['sleep','sleep'],['steps','steps'],['calories','calories'],['vo2','vo2']].forEach(function(pair){
      var n=healthNum_(healthV_(row,cols,pair[0]));if(n!==null&&n>=0)d[pair[1]]=n;
    });
    var sm=healthNum_(healthV_(row,cols,'sleepMinutes')),ss=healthNum_(healthV_(row,cols,'sleepSeconds'));
    if(sm!==null)d.sleep=sm/60;else if(ss!==null)d.sleep=ss/3600;
    accepted++;
  });
  report.push(['READ',file.getName(),kind,accepted+' accepted rows']);
}
function healthReadTCX_(file,workouts,track,report){
  try{
    var root=XmlService.parse(file.getBlob().getDataAsString('UTF-8')).getRootElement(),ns=root.getNamespace();
    var activities=root.getChild('Activities',ns);if(!activities)return;
    var as=activities.getChildren('Activity',ns),count=0;
    as.forEach(function(act){
      var id=act.getChildText('Id',ns),when=new Date(id),sport=healthSport_(act.getAttribute('Sport')?act.getAttribute('Sport').getValue():'');
      if(isNaN(when.getTime())||!sport)return;
      var iso=Utilities.formatDate(when,TZ,'yyyy-MM-dd'),start=Utilities.formatDate(when,TZ,'HH:mm');
      var laps=act.getChildren('Lap',ns),secs=0,meters=0,avg='',max='',cal=0;
      laps.forEach(function(l){secs+=Number(l.getChildText('TotalTimeSeconds',ns))||0;meters+=Number(l.getChildText('DistanceMeters',ns))||0;cal+=Number(l.getChildText('Calories',ns))||0;
        var a=l.getChild('AverageHeartRateBpm',ns),m=l.getChild('MaximumHeartRateBpm',ns);
        if(a)avg=Number(a.getChildText('Value',ns))||avg;if(m)max=Number(m.getChildText('Value',ns))||max;
      });
      if(!secs)return;
      var key=[iso,start,sport,Math.round(secs/60)].join('|');
      // Match the CSV by time/sport/duration, NOT by potentially erroneous distance.
      if(!workouts[key])workouts[key]=[key,iso,start,sport,sport,Math.round(meters)/1000,Math.round(secs/60*100)/100,avg,max,file.getName(),Math.round(meters)/1000,'','Reported (TCX)'];
      laps.forEach(function(l){l.getChildren('Track',ns).forEach(function(t){t.getChildren('Trackpoint',ns).forEach(function(pt){
        var time=pt.getChildText('Time',ns);if(!time)return;
        var d=new Date(time);if(isNaN(d.getTime()))return;
        var pos=pt.getChild('Position',ns),lat='',lon='';if(pos){lat=pos.getChildText('LatitudeDegrees',ns)||'';lon=pos.getChildText('LongitudeDegrees',ns)||'';}
        var hrNode=pt.getChild('HeartRateBpm',ns),bpm=hrNode?Number(hrNode.getChildText('Value',ns)):0;
        // Track file can contain GPS fixes with no HR; don't infer values.
        var sec=Math.max(0,Math.round((d.getTime()-when.getTime())/1000));
        var pointKey=key+'|'+sec;
        track[pointKey]=[key,iso,Utilities.formatDate(d,TZ,'HH:mm:ss'),sec,lat===''?'':Number(lat),lon===''?'':Number(lon),bpm>0?bpm:'',file.getName()];
        count++;
      });});});
    });
    report.push(['READ',file.getName(),'tcx',count+' samples']);
  }catch(e){report.push(['ERROR',file.getName(),'tcx',String(e.message||e).slice(0,600)]);}
}
// GPS validation for Health Sync CSV + TCX workout exports.
// Original summary distance is preserved; GPS wins only on reliable tracks
// when the reported distance differs by more than 10%.
function healthHaversineM_(a,b) {
  var rad=Math.PI/180, p1=a[4]*rad, p2=b[4]*rad;
  var dp=(b[4]-a[4])*rad, dl=(b[5]-a[5])*rad;
  var q=Math.sin(dp/2)*Math.sin(dp/2)+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)*Math.sin(dl/2);
  return 12742000*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)));
}
function healthCorrectGPSDistances_(workouts,track,report) {
  var grouped={};
  Object.keys(track).forEach(function(k){
    var p=track[k], activityKey=p[0];
    if(!grouped[activityKey])grouped[activityKey]=[];
    if(typeof p[4]==='number' && typeof p[5]==='number' &&
       isFinite(p[4]) && isFinite(p[5]) && Math.abs(p[4])<=90 && Math.abs(p[5])<=180 &&
       !(p[4]===0 && p[5]===0))grouped[activityKey].push(p);
  });
  Object.keys(workouts).forEach(function(key){
    var row=workouts[key], samples=grouped[key]||[];
    if(row.length<13){row[10]=row[5];row[11]='';row[12]='Reported';}
    if(samples.length<20)return;
    samples.sort(function(a,b){return a[3]-b[3];});
    var sumM=0, accepted=0, jumps=0, first=samples[0], last=samples[0];
    var walk=/walk/i.test(String(row[4])), run=/run|jog/i.test(String(row[4]));
    if(!walk && !run)return;
    var maxMps=walk?4.5:9; // reject implausibly fast GPS jumps
    samples.forEach(function(p,i){
      if(!i)return;
      var dt=(p[3]-last[3]);
      if(dt<=0)return;
      var meters=healthHaversineM_(last,p);
      // Reject jumps without adding their distance, but continue at the next fix.
      if(meters/dt>maxMps || meters>1000){jumps++;last=p;return;}
      sumM+=meters;accepted++;last=p;
    });
    var coverage=(samples[samples.length-1][3]-first[3])/(Number(row[6])*60);
    var gpsKm=Math.round(sumM/10)/100; // 0.01 km precision
    var reported=Number(row[10]);
    row[11]=gpsKm;
    if(accepted<20 || coverage<0.7 || coverage>1.2 || jumps>samples.length*0.1 || gpsKm<0.2 || gpsKm>200){
      report.push(['CHECK GPS',String(row[9]),'gps',key+': GPS not reliable enough; kept reported distance']);
      return;
    }
    if(!reported || Math.abs(reported-gpsKm)/reported>0.10){
      row[5]=gpsKm;row[12]='GPS validated (TCX)';
      report.push(['GPS CORRECTED',String(row[9]),'distance',key+': reported '+reported+' km; GPS '+gpsKm+' km']);
    }else row[12]='Reported (GPS cross-checked)';
  });
}
function healthImport_(){
  var files=healthFiles_(),tcx=healthExportFiles_().filter(function(f){return /\.tcx$/i.test(f.getName())&&f.getSize()<=6000000;}).slice(0,150);
  if(!files.length&&!tcx.length)throw new Error('No Health Sync CSV or TCX files in selected folder.');
  var report=[],workouts={},daily={},hr={},track={};
  files.forEach(function(f){try{healthParseCsv_(f,workouts,daily,report,hr);}catch(e){report.push(['ERROR',f.getName(),'csv',String(e.message||e)]);}});
  tcx.forEach(function(f){healthReadTCX_(f,workouts,track,report);});
  healthCorrectGPSDistances_(workouts,track,report);
  var ss=getSS_();
  function put(name,headers,rows){var sh=healthSheet_(ss,name,headers);if(sh.getLastRow()>1)sh.getRange(2,1,sh.getLastRow()-1,headers.length).clearContent();
    if(rows.length)sh.getRange(2,1,rows.length,headers.length).setValues(rows);return sh;}
  var wr=Object.keys(workouts).sort().map(function(k){return workouts[k];});
  var mr=Object.keys(daily).sort().map(function(k){var d=daily[k];return [k,d.rhr===undefined?'':d.rhr,d.hrv===undefined?'':d.hrv,d.sleep===undefined?'':d.sleep,d.steps===undefined?'':d.steps,d.calories===undefined?'':d.calories,d.vo2===undefined?'':d.vo2,Object.keys(d.files).join(', ')];});
  var hrRows=Object.keys(hr).sort().map(function(k){return hr[k];}),trackRows=Object.keys(track).sort().map(function(k){return track[k];});
  put('HealthWorkouts',HEALTH_WORKOUT_HEADERS,wr);put('HealthMetrics',HEALTH_METRIC_HEADERS,mr);
  put('HealthHeartRate',HEALTH_HR_HEADERS,hrRows);put('HealthTrackpoints',HEALTH_TRACK_HEADERS,trackRows);
  put('HealthImportLog',['Status','File','Category','Details'],report);
  healthFillCheckins_(ss,daily);
  applyToPlan_(ss);
  PropertiesService.getScriptProperties().setProperty('HEALTH_LAST_SYNC',Utilities.formatDate(new Date(),TZ,"yyyy-MM-dd'T'HH:mm:ss"));
  return {files:files.length+tcx.length,workouts:wr.length,metricDays:mr.length,heartRate:hrRows.length,trackpoints:trackRows.length,skipped:report.filter(function(x){return x[0]!=='READ';}).length};
}
function healthImportMenu(){
  var ui=SpreadsheetApp.getUi();try{var r=healthSyncSafe_();
    ui.alert('Health Sync imported',r.files+' files; '+r.workouts+' workouts; '+r.trackpoints+' trackpoints; '+r.heartRate+' daily HR samples; '+r.metricDays+' metric days. See HealthImportLog for details.',ui.ButtonSet.OK);
  }catch(e){ui.alert('Health Sync import failed: '+String(e.message||e));}
}
