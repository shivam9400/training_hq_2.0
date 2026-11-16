# Architecture

## Components and trust boundaries

`web/` is the only deployable application: React 19, strict TypeScript and Vite.
GitHub Pages serves public static assets under `/training_hq_2.0/`; component state
provides navigation, so refresh does not require a server-side history fallback.
No server, Android toolchain or external production integration is part of the
build. Firebase Auth handles Google login; Firestore Spark is the user data store.
The static website never contains user health records, secret OAuth credentials
or an admin SDK. Public Firebase web identifiers are configuration, not authority.

`services/firebase.ts` initializes memory-only Auth/Firestore; Google uses an
explicit account chooser. `hooks/useTraining.ts` owns identity and view state,
clears records before account loads/sign-out, and invalidates stale asynchronous
results with a generation counter. Signed-out demo is a separate labeled state.
No demo records are automatically copied to a signed-in account. In-flight writes
are owner-bound and security rules re-authorize on the server. Reloads intentionally
lose login and private view state. No browser IndexedDB/localStorage health cache.

`services/store.ts` constructs paths using the authenticated observer UID and
checks the active Firebase user before/after each request. Reads require server
responses, paginate in 200-document chunks, and validate documents on receipt.
There are no broad live subscriptions. A 10,000-record per-collection safety limit
prevents unbounded browser memory use; exceeding it fails visibly. This is not a
promise of free unlimited scale: full refreshes consume reads.

`types/data.ts` defines strict field schemas; rules repeat security-critical
validation rather than trusting the browser. All document IDs match stored IDs.
Rules only permit an authenticated owner and known collections. List requests
must be bounded at 200. Parent profiles, collection-group/foreign reads, arbitrary
subcollections, extra fields and anonymous access are denied.

## Firestore schema

| Collection beneath `users/{uid}` | Required fields |
| --- | --- |
| plans | id, title, startDate, endDate |
| sessions | id, planId, date, type, title, minutes, target, instructions, status |
| workouts | id, title, type, start, end, reportedMeters, gpsMeters, distanceSource, qualityFlags, source, sourceId, averageHr |
| races | id, title, date, distanceKm, goal |
| metrics | id (= date), date, restingHr, hrv, sleepHours, soreness, rpe, steps, notes |

Units: duration minutes, distance meters except race km, HR bpm, HRV RMSSD ms,
sleep hours. Optional numeric measurements are null, never invented zero values.
Session documents use durable UUIDs, allowing multiple sessions per date and
manual status independently of workout evidence. No caller-supplied owner field.
No composite query indexes are currently needed. Rules validate field presence,
allowed keys, types, numeric ranges, basic date/UTC timestamp formats, temporal
ordering and GPS provenance. Client schemas additionally reject invalid calendar
dates. Rules do not enforce cross-document plan/date membership, a per-day slot
cap or personalized clinical thresholds; these are consistency features, not
cross-user authorization. Avoid storing raw tracks in these collections.

## Legacy preservation and migration

Apps Script is spreadsheet-bound: `doGet` serves Index.html; `google.script.run`
loads a dashboard and mutates session/check-in rows. Plan has 27 columns (text,
automatic actuals, user overrides/check-ins), with supporting Strava, Races, Goals,
Settings, Weeks, Tests, Plan input and Health* import tabs. Full schema and known
hazards are retained in [legacy analysis](legacy-architecture.md).

The web retains multi-session days, explicit statuses, recovery cards, race goals,
walking pace and weekly completion. Progress uses recorded runs and due sessions.
Readiness uses explicit sleep/soreness thresholds from today/yesterday's latest
check-in and safety/caution notes from the last four calendar days. It deliberately does not claim personalized
HR/HRV scoring or a diagnosis. It is
training guidance, not medical advice. Advanced coaching/load/race analytics are
listed as future work, not mocked as computed user results.

Pure primitives preserve 85%/40% duration thresholds, exact-source identity,
kind-aware single-use session matching, and conservative GPS correction. GPS
validation additionally rejects long gaps and measures accepted time coverage
instead of trusting only first/last sample span. Local file processing now wires these primitives to the activity importer; no
production Drive authorization or raw route persistence is enabled. Legacy regression tests include the known
CSV 12-value/13-header defect as an explicit expected failure.

## Static PWA caching

`build-sw.mjs` creates an allowlist from static Vite output and icons, with a
content-hashed cache name. Fetch handling is limited to GET, exact allowlisted
paths, no query string and the app's own origin. Cross-origin Firebase/Google/Drive
responses, non-static paths and private exports are never put in Cache Storage.
Activation removes only old Training HQ shell caches. New workers activate when
old tabs close; there is no forced update over an active editing session. Offline
reload shows the public shell/demo and cannot restore another user's private data.

Pages cannot provide arbitrary server security headers; an HTML CSP restricts
scripts/styles/connections, but frame-ancestors and COOP are not enforceable via
meta. Audit the entire hosting origin and any other same-origin repository before
production. No third-party analytics/fonts are loaded.

## Structure decisions

Unit and Firestore emulator tests are in `web/src/services/`, browser tests in
`web/e2e/`, and static SW generation in `web/scripts/`. This keeps Node module
resolution and one lockfile inside web rather than adding a second root package.
The historical Android analysis remains an explicitly marked reference document;
no active native application/development dependency remains. Deployment is a
manual-only job in the web validation workflow; pushing/PR creation does not deploy.

## Private Plan CSV import extension

The source importer accepts the actual ten-column Plan CSV, not the 27-column
legacy sheet. Plans gain an optional strict importSource map; sessions gain
optional day/slot/week/phase and importSource. Old documents remain valid.
Source hashes, natural date/slot keys and complete transactional snapshot checks
protect idempotency, manual edits and statuses. Race/Rest can be zero minutes;
Run remains positive. See [import specification](plan-import.md) for field limits,
chunk boundaries, quota/cancellation behavior and owner-side rules publication.
Google Sheets OAuth is deliberately design-only until its scope model is verified.

## Browser-local activity importer

`services/activities/` separates bounded archive expansion, FIT/XML/CSV adapters,
normalization, GPS checks, conservative deduplication/preview, transaction writes
and explicit session matching. `worker.ts` holds raw bytes/samples; UI receives
summaries only. A 45-second disposable worker protects the main thread. Raw files,
tracks and HR series never become Firestore or service-worker cache entries.

Workouts gain optional strict `details` and `provenance` maps (units: seconds,
meters, bpm, kcal, cadence with explicit unit), plus optional `matchSessionId`.
Details retain reported and timestamp-derived durations, metric source tags,
per-format reported distances, sample counts and extrema. Provenance stores version,
bounded hash aliases, format list and content baseline hash. Sessions optionally
retain `actualWorkoutId`. Old documents remain valid. Reciprocal consistency is
transactionally checked by the client, while rules enforce owner paths and schemas;
rules do not guarantee the scientific truth or referential integrity of data an
owner intentionally writes through another client. Dashboard actuals require both
sides of a link. See [import specification](activity-import.md) for exact gates,
identities, ambiguous candidates, source-conflict policy and resumable chunks.

## Health Sync folder reference boundary

The fixed `users/{uid}/integrations/health-sync` path is separate from the five
training collections. It stores only version/id, bounded folderId and constant
unverified access. Settings loads it independently so older live rules cannot
break core training loads. Configuration has its own private export; account
deletion removes it before Auth and fails closed if cleanup is denied. Client
guards and view generations reject stale account results. See drive-folder-settings.md.
No live OAuth, Picker, Drive listing/download or tokens are enabled. The current
feasibility evidence and unresolved production gate are in drive-feasibility-decision.md.
