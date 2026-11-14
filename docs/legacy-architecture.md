> Historical migration analysis preserved from Android foundation commit `241394a`.
> Legacy schema/import findings remain relevant. The native implementation section describes that historical branch, not the active web application.

# Training HQ architecture and migration analysis

## Reference inspected

Analysis is based on `README.md`, `AGENTS.md`, `docs/requirements.md`,
`legacy/apps-script/Code.gs` and `legacy/apps-script/Index.html` at base commit
`250358f`. Legacy files are reference only and remain unchanged.

## Existing system

A spreadsheet-bound Apps Script serves Index.html through `doGet`. The browser
uses `google.script.run` to load `getDashboardData`, save check-ins, set status,
edit/add/delete sessions, swap days and request sync. Spreadsheet reads and
`buildDashboard_` supply the dashboard view model; derived actuals are written
back into Plan. Script Properties hold deployment configuration and OAuth state;
none of that configuration belongs in the Android application.

Strava is fetched server-side in pages of 100, capped at ten pages, from a
configured start date (default: two weeks before the plan). Its sheet is replaced
on sync. Health Sync imports CSV/TCX from a configured Drive export folder and
merges activities before computing plan actuals. Scheduled imports run about every
30 minutes. This is not an authenticated native API or an incremental sync engine.

## Sheets schema

| Tab | Columns / purpose |
| --- | --- |
| Plan | A–L: Date, Day, Slot, Wk, Phase, Type, Session, What to do, Target, Planned min, approximate km, Locked; M–S: automatic status, actual km/min, avg/max HR, pace, Strava link; T–AA: status override, resting HR, HRV ms, sleep hours, soreness, RPE, test/race HR, notes |
| Plan input | Date, Type, Session, Planned min, Target, What to do, optional Phase; builder generates date/slot rows, weeks and races |
| Strava | Activity ID, Date, Start, Name, Sport, Distance km, Moving min, Avg HR, Max HR, Elevation m, Relative effort, Avg speed m/s |
| Races | Date, Race, Distance km, Goal, Notes |
| Goals | Goal, Target, Status, Result/date; reference results in F–G |
| Settings | Setting label, Value, Notes; timezone, thresholds, titles and sync preferences |
| Weeks | Week, Focus, Key sessions, Motivation |
| Tests | Date, Label, Session, optional target avg HR |
| HealthWorkouts | Key, Date, Start, Name, Sport, effective km, Moving min, Avg HR, Max HR, Source file, Reported km, GPS km, Distance source |
| HealthMetrics | Date, resting HR, HRV ms, sleep h, steps, kcal, VO2max, source files |
| HealthHeartRate | Date, Local time, Heart rate, Source file, Source app |
| HealthTrackpoints | Activity key, Date, Local time, Elapsed sec, Latitude, Longitude, HR, Source file |
| HealthImportLog | Status, File, Category, Details |

Plan identity is date + slot, not date alone. One to four sessions per date are
supported. Check-ins go to the first row for a date. Editing locks session text;
refresh preserves logs and locked text. Deleting the only row is forbidden. Day
swaps affect session fields only and are restricted to today/future days. Building
a plan from input replaces existing logs after confirmation.

## Screens and business rules

The web UI uses a navy background, rounded dark cards, orange actions, teal
secondary accents, type/status chips and a mobile bottom tab bar. Today contains
a phase/week hero, session cards, readiness, coach flags, check-in form and weekly
strip. Plan contains races, a calendar map and weekly focus. Progress contains
review, statistics, running load, aerobic efficiency and HR checkpoints. Separate
Activity and Goals tabs contain recent workouts, goals, quotes and badges.

Native V1 folds goals into Progress and recent activities into Health, retaining
the visual vocabulary and multiple session slots. Native values are explicit
synthetic examples; they are not computed legacy analytics or device-derived
readiness recommendations.

`computePlanActuals_` assigns runs to the first Run/Race slot, and non-runs to the
first Strength slot on a date. This broad non-run match must not become native
strength classification. Duration completion thresholds are >=85% Done, >=40%
Partial, otherwise Short. Strength with any matched non-run becomes Done. Rest can
show Extra run; absent past runs become Missed. Manual override wins over automatic
status. Average HR is duration-weighted; pace requires valid duration/distance.
Completion weights Partial at one half and excludes Rest. Weekly running load,
streaks, longest runs, race countdowns, checkpoint target comparisons and badges
are derived server-side. Easy-run efficiency uses 20–75 minute runs with HR
120–160 and valid distance.

Readiness uses recent notes and latest check-in from today/yesterday: safety
keywords take precedence, two recovery flags imply rest, one easy, caution notes
watch, otherwise GO or NO_DATA. Configurable resting-HR/HRV thresholds can be
disabled at zero. Sleep/soreness thresholds and coach load flags are separate.
These rules have not been ported; native mock numbers do not claim clinical advice.

## Import behavior and migration hazards

Later definitions in Code.gs override earlier definitions of the same functions.
The final CSV/TCX importer, not the initial CSV-only version, is the effective one.

- CSV aliases normalize headers. Accepted dates include yyyy.mm.dd, yyyy/mm/dd
  and ISO-style prefixes. Minutes, seconds or hh:mm:ss supply duration. Unknown
  layouts are logged. Workouts require a recognized sport and positive duration
  <=1440 min; distance can be zero (valid non-GPS sessions), capped at 500 km.
  Generic TRAINING becomes Workout, separate from strength/yoga. Daily metrics
  combine by date, with later values overwriting earlier ones; raw HR is keyed by
  date/time/BPM/source. FIT decoding is not implemented.
- Workout identity is date + minute start + normalized sport + rounded duration.
  CSV is read before TCX; TCX matches this key without relying on distance and adds
  trackpoints. This identity can collide and lacks durable source IDs.
- Strava wins a cross-source duplicate when date/type match, start differs <=15 min
  and duration differs <=max(3 min, 15%). This heuristic can merge distinct sessions
  or miss duplicates. Native V1 only dedupes exact source package + record ID.
- GPS uses haversine segments, rejects invalid coordinates/zero pair, speeds above
  4.5 m/s walking or 9 m/s running, and segments over 1000 m. Validation requires
  >=20 accepted segments, 70–120% duration coverage, <=10% jumps and 0.2–200 km.
  Only reliable walking/running tracks may replace reported distance when absent
  or >10% different. Raw reported and GPS distances must both survive migration.
- **Observed defect:** final CSV workout array has 12 elements for 13 headers:
  Source file is omitted, reported distance lands at index 9, the GPS/source cells
  shift. GPS correction reads index 10 as reported, and a 13-column setValues may
  reject such rows. This is a source-level finding, not a production reproduction.
- **Observed risk:** the final importer clears/replaces import sheets even with
  no usable records, overriding an earlier guard that retained existing data.
  File exceptions are logged but the replacement can still discard previous data.
  Preserve exports and design transactional validated staging before migration.

The Drive scan traverses up to four subfolder levels, at most 80 folders and 600
export files. The final importer selects up to 200 CSVs (<=3 MB each) and 150 TCX
files (<=6 MB each); files are ordered newest first, so later overwrite behavior
needs review when exports overlap. No legacy import is executed by this project.

## Native implementation boundary

`android/` is a single Kotlin + Compose app (API 28+, target 35, compile 36). Static
fixtures power Today, Plan, Progress and daily Health metrics. No real exports or
account details are fixtures. A small ViewModel and repository separate device
exercise reads from the mock dashboard; no INTERNET, write, GPS or background
health permissions are declared. Android Health Connect is local IPC, not a
production service connection.

Health Connect availability/update states, rationale activity and Android 14+
permission-usage alias are declared. User-triggered permission requests are
optional. Reads recheck grants, cover a fixed last-seven-days window, paginate,
retain metadata ID/source package, distinguish TRAINING/strength/yoga and use
elapsed session time. Empty, denied/revoked, unavailable, loading and failure
states are explicit. Cancellation propagates; UI errors never expose health
payloads. Device records are memory-only, cleared on stop and reread on resume.
Distance and HR are intentionally absent rather than inferred from overlapping
records. The workout model preserves separate reported/GPS fields and quality
provenance for later migration; GPS validation is not implemented in this app.

## Remaining migration

Room cache with retention/deletion policy; check-in/session editing and overrides;
full plan builder/calendar, readiness and coach calculations; computed progress,
checkpoints and badges; permission-scoped distance/HR/sleep/HRV/steps/resting-HR
readers; route consent and validation; durable change tokens/tombstones and
cross-source deduplication; WorkManager; authenticated sync API and server-held
Google/Strava credentials. No backend is created and no legacy exporter should be
disabled yet. A persistent real-health cache is deliberately deferred beyond this
memory-only prototype. Production rollout needs device testing and a data-use
policy covering any later persistence/sync.
