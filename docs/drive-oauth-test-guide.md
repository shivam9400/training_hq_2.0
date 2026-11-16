# Local Google Drive OAuth diagnostic

This is an **owner-operated synthetic permission experiment**, not production
Drive sync. It makes actual GIS/Picker/Drive calls only when you press the relevant
buttons. No real Google authorization tests were performed while implementing it.
Mocks validate software behavior; they do not establish Google's folder grant model.

## Separate test project and ignored configuration

Use the owner-created **Training HQ Drive Test** project, External / Testing consent
screen and its two authorized test users. In that test project's APIs & Services,
manually confirm **Google Drive API** and **Google Picker API** are enabled. This
code cannot enable APIs or change Cloud settings. Do not use the production project.

Use the **replacement OAuth Web Client** with authorized JavaScript origin exactly
`http://localhost:5173` (no path). Do not copy the old client ID. Add these public
client identifiers to the ignored **web/.env.local**, keeping any existing local
configuration intact:

```dotenv
VITE_GOOGLE_DRIVE_TEST_CLIENT_ID=REPLACEMENT_WEB_CLIENT_ID
VITE_GOOGLE_DRIVE_TEST_PICKER_API_KEY=TEST_PROJECT_BROWSER_API_KEY
VITE_GOOGLE_DRIVE_TEST_APP_ID=NUMERIC_TEST_PROJECT_NUMBER
```

The first value must be the replacement `...apps.googleusercontent.com` Web Client
ID. The API key is a **browser key**, not a client secret; Picker needs it plus the
numeric project number (not the project name/string ID). Obtain them from the same
approved test project. Restrict the key to the intended Picker API and localhost
HTTP referrer following Google's current console guidance. SDK requests send only
the localhost origin as referrer; Drive Bearer requests omit referrers. Keep actual
values out of Git even though these are public client identifiers.

**Never create, request, paste, store or use a Client Secret here.** No secret field,
OAuth code exchange, backend, refresh token or service account is supported.
The diagnostic requests **only** `https://www.googleapis.com/auth/drive.file`, sets
include_granted_scopes=false, and rejects token responses containing another scope.
Do not add drive.readonly, drive.metadata.readonly, openid, email or profile scopes.
No environment flag can enable broad scopes or production Drive integration.

## Start on your local computer

```sh
cd web
npm ci
npm run dev:drive-test
```

Open **http://localhost:5173** in a clean browser profile with popup permission.
The server binds localhost with strict port 5173; other Host/Origin requests are
refused. Do not expose it through a public tunnel or override its bind address.
The runtime also requires development mode and that exact origin. The normal app
server refuses diagnostic source routes. An existing controlling service worker
blocks the diagnostic; use a clean local browser profile/site data and reload.
Nothing automatically unregisters another app's worker or deletes its caches.

No Google script or API is contacted on initial load. First press **Load Google
Identity test SDK (no authorization)**, then **Connect Test Google Account**. This
two-step preparation keeps the OAuth popup tied to a fresh user click. GIS opens
its account chooser (`prompt=select_account`). Select one of the approved test users.
No synthetic folder/file is read automatically after sign-in.

OAuth success and identity success are separate rows. Identity comes from the
requesting user returned by authenticated **Drive about.get** using the *same token*.
The official Drive API specification lists drive.file for that method:
https://github.com/googleapis/google-api-go-client/blob/836a8fc15f17d9c8b4992dee3939dcdd5c3e9b26/drive/v3/drive-api.json
(revision 20261106). No editable email or additional identity scope is used. Email
may be unavailable; the requesting user's permission identifier is retained in RAM
for identity-change checks, not logged/persisted or included in results. An absent
reliable identifier disables file tests. Successful OAuth is not file permission.

## Create synthetic samples using another app/account

Fixture buttons generate **local downloads**, without Google authorization:

- before.fit is a real binary file from the maintained MIT encoder, not renamed CSV.
- before.tcx / before.csv describe the same invented walking workout for dedup tests.
- before.gpx / before.kml are invented timestamped GPS examples, not real routes.
- new-direct.csv and new-nested.csv describe different invented generic TRAINING
  workouts and have different stable IDs/dates from the baseline samples.

Use an already approved synthetic folder. Manually upload baseline fixtures with
Google Drive's website or another authorized app/account. Create a nested subfolder
and put a baseline sample there too. Do not use the diagnostic to create/upload files:
it has no Drive mutation method. Do not alter sharing or publish any folder as a
workaround. Use test accounts that already have appropriate access; a denied folder
is a useful negative result. Never use real Health Sync exports, private routes or
personal records. Do not commit fixtures downloaded/generated on your computer.

## Run folder and future-file tests in this order

1. Connect explicitly, verify the Drive identity shown, then check the synthetic-data
   confirmation. Paste the synthetic folder URL or press **Select synthetic folder
   through Picker**. Picker uses that exact in-memory token, test key and app project
   number. Its callback stores an ID only; it does not fetch metadata or file bodies.
2. Press **Test folder metadata only**. PASS/200 means a non-trashed folder's metadata
   was readable. It does not mean existing/future child files are authorized.
   A denied folder-metadata check does not prevent a separate explicit listing
   test: its status remains separate. A known non-folder type does block traversal.
3. Copy the independently known IDs of a direct and nested synthetic file from the
   Drive website. Paste IDs only (the segment inside `/file/d/ID/view`), not full URLs,
   into the expected existing-ID fields. This prevents a visible empty listing from
   being mistaken for complete scope coverage.
4. Press **Scan existing nested files — establish baseline**. The diagnostic paginates
   bounded BFS child queries, filters trash and never follows shortcuts. It retains
   only bounded IDs/type/size/depth in memory; filenames are discarded after deriving
   supported extensions. A complete traversal is necessary for comparison, but still
   not proof that Google exposed all children. Incomplete listings are never baselines.
5. **After this baseline**, use the other account/external app to create a NEW direct
   synthetic file and a NEW subfolder containing a NEW synthetic file. Generate the
   future CSV fixtures locally if helpful, then upload them outside this app. Do not
   select these items individually in Picker or create them through Training HQ.
6. Paste the three independently known new IDs and press **Rescan with the previously
   issued grant**. Do not reconnect between baseline and rescan. The same token/grant
   epoch is required; expiration/reconnect clears baseline. Each expected ID must be
   absent from baseline, then visible at the correct direct/nested depth.
7. Test each relevant candidate's body using its explicit **Test synthetic download N**
   button. Metadata/listing PASS does not establish `files.get?alt=media` success.
   The known-ID download control also permits an independent workflow for an item
   missing from listing, without selecting it in Picker. A failed metadata check
   records the body test as NOT RUN; it is not falsely reported as an alt=media
   denial. Bodies stay in browser RAM. An optional separate parser button reuses the existing
   Health Sync worker and conservative deduplication, showing counts only. There is
   no Firestore module, account owner assignment or save control in this diagnostic.
8. **Last**, select individual files through Picker, then explicitly test their body
   downloads. This is the fallback experiment. Individual Picker use marks the current
   inheritance experiment contaminated. Even reconnection does not erase Google's
   prior file grants: use new, never-selected synthetic files/folders for a fresh test.

Limits: 25 list pages, 200 entries, 30 folders, depth 8; 45-second traversal, 10-second
request/body waits; at most 3 attempts for 429/5xx, bounded backoff. Long Retry-After
fails visibly instead of retrying early. Metadata JSON is capped at 1 MiB; each body
at 8 MiB, cumulative downloaded bytes at 20 MiB, retained samples at 20 per session.
The reused parser has its own existing limits (including FIT 4 MiB) and 45-second
worker timeout. Oversized/unsupported files are rejected, never silently treated as
successful parse/imports. Unsupported/Google-native files and shortcuts are not
exported or followed. All app Drive requests use GET with Bearer headers, no token
in an app-generated request URL, no redirects and no shared-link access workaround.

## Account, denial and lifecycle matrix

Keep Firebase Account A signed into the **normal Training HQ app separately**, using
an already approved test setup. This diagnostic never reads Firebase Auth or sends
anything to Firebase. After connecting, select the manual context label; it is not
proof of Firebase identity or data-owner binding. Compare the app's authenticated
profile with the API-verified Drive identity yourself.

| Case | Required observation | Implementation-session live result |
| --- | --- | --- |
| Firebase A / Drive A | Verified Drive A; normal app independently remains A | NOT RUN |
| Firebase A / Drive B | Verified Drive B; normal app independently remains A | NOT RUN |
| Folder URL before authorization | File controls disabled; no Drive request | Mock/browser checked |
| Folder explicitly selected in Picker | Selection recorded separately from metadata | Mock checked; live NOT RUN |
| Existing direct and nested files | Known IDs discovered, then explicit body GET | Mock checked; live NOT RUN |
| New direct file after baseline | Known new ID visible under same issued grant, then body GET | Mock checked; live NOT RUN |
| New nested folder and child | Both fresh known IDs visible, then body GET | Unit checked; live NOT RUN |
| Individual file Picker grant | Selection, metadata and body results separate | Mock checked; live NOT RUN |
| Empty folder / missing known file | HTTP 200 does not imply full visibility | Unit checked; live NOT RUN |
| 403 / 404 | Denial/unavailability, no automatic retries or scope escalation | Mock checked; live NOT RUN |
| 429 / 5xx / network errors | Bounded retries/cancellation; long backoff stops | Mock checked; live NOT RUN |
| Account switch | Clear token, identity, IDs, baselines, bytes; new explicit chooser | Mock checked; live NOT RUN |
| Real expiry/revocation | API probe rejects or issued expiry timer clears | Unit/mock checked; live NOT RUN |

**403** can mean scope/file permission, API/key configuration or account policy. It
is not automatically proof of revoked consent. **404** can conceal lack of access;
it does not prove deletion. A missing known item in a successful list is a failed
coverage observation, not proof the folder is empty. A complete traversal of the
visible subset is not proof of access to the full folder. PASS is operation-specific.

To test actual revocation, manually remove the **test app** grant in the test user's
Google Account third-party connections while the diagnostic remains connected,
then press **Probe current Drive identity** (or an explicit file test). Observe the
actual HTTP response; propagation may not be immediate. This app never calls a
revocation endpoint. The **Simulate local expiry** button is visibly a local-only
simulation. For real expiry, wait for the issued token's expiry/Google rejection.

**Disconnect locally / clear all** aborts requests, closes Picker/worker, clears
local token/identity/selection/results and drops/zeros retained bytes. It does not
sign out of Google or revoke the external grant. Reload, navigation, expiry or a
service-worker controller change also clears/blocks the test. Editing code can
trigger a Vite reload; start a new baseline afterward. No refresh token or persistent
storage is used. SDKs/Google account cookies are Google's own browser state, not an
app-side token cache. Browser network tools naturally expose authorized requests:
never share HARs, console dumps, screenshots with identity/IDs, tokens or bodies.
The app has no raw logging or result-export/upload feature. Record only manually
sanitized PASS/FAIL/HTTP observations outside Git; do not commit diagnostic results.

## Checks and production isolation

```sh
cd web
npm run check:drive-test
npm run lint
npm test
npm run build:drive-test
npm run build
npm run test:drive-browser
npm run test:e2e
```

The diagnostic browser suite uses mocked GIS/Picker/Drive responses and synthetic
client identifiers; it does **not** authorize a real account. `build:drive-test`
creates ignored `web/drive-diagnostic-dist` solely for bundling checks, with blank
client configuration and a runtime development-only guard. It is not a deployable
or previewable diagnostic. Only `npm run dev:drive-test` serves the working tool.

Production Vite cannot import diagnostic modules and exposes only Firebase-prefixed
public configuration. A mandatory build check scans dist/assets and sw.js for
local diagnostic markers/config/GIS code. Firebase Auth's existing gapi loader is
legitimate production code, not this diagnostic. Production Pages uploads only
web/dist; diagnostic output, fixtures, environment and data are excluded. The
separate diagnostic build rejects Firebase modules. No production Auth settings,
Firestore code/rules, Google scopes, sharing settings or deployment were changed.

## Conclusion and remaining OAuth questions

Implemented: local explicit GIS/Picker/API calls, operation-level outcomes, bounded
metadata traversal/body downloads, actual Drive identity lookup, memory lifecycle,
synthetic fixtures, optional local parsing/deduplication and mocked failure tests.
**Real OAuth, Picker grant and future-file outcomes remain NOT RUN until the owner
performs this experiment. No folder inheritance conclusion is recorded.**

Current public multi-user verification, scope classification/assessment, testing
limits, consent publishing and GitHub Pages origin/domain eligibility remain
separate production gates. drive.file itself includes edit/delete consent for
selected files even though this diagnostic only reads. Success in External/Testing
with two accounts would not establish public production approval or ongoing folder
permissions. No broad scope is requested to make a failing experiment pass.

[Implementation validation and explicitly unrun live tests](drive-oauth-test-validation.md).
