# Google Drive authorization and import feasibility

**Status: design only. Production Drive access is intentionally disabled.**
No Drive scope is requested by the implemented Firebase Google login. Authentication
and authorization to a user's Drive exports are separate consents. The browser
must not inherit a developer's Drive access, publish files or embed a client secret.

## Scope decision

`https://www.googleapis.com/auth/drive.file` is the preferred per-file scope. It
covers files created/opened with the app or explicitly shared with it through an
appropriate Picker flow. It is not blanket read access to a selected directory.
Selecting the Health Sync folder does **not** establish authorization to existing
or newly created CSV/TCX children, including files in continuously created nested
Health Sync subfolders. Files created by Health Sync are created by a different
app and cannot be assumed to inherit this app's per-file grant. Folder membership
is not the same thing as an OAuth per-file grant.

A feasible narrow-scope candidate is explicit **file selection** each time through
Google Picker, with multi-select supported where possible. Previously authorized
file revisions may be reread with a fresh token, but new exports need a grant.
Do not offer "watch this folder automatically" based on drive.file alone. A
user-selected local file upload is another narrow, browser-only option. Neither
production Picker nor local CSV/TCX import UI is implemented in this milestone.

`drive.metadata.readonly` cannot read file bodies. Broad `drive.readonly` could
read folder descendants, but is a restricted scope with substantially greater
review/privacy obligations. Do not silently escalate to it to make folder polling
work. Treat automatic discovery of newly created Health Sync files with drive.file
as **unverified/unavailable** until a real two-account integration test proves the
precise supported grant model.

## Verification gate before implementation

1. Use a separate Google Cloud OAuth web-client project, a verified owned domain,
   branded home/privacy/deletion pages, correct JavaScript origins and appropriate
   consent-screen publishing settings. Confirm whether github.io origin/domain
   verification meets Google's requirements or an owned domain is needed.
2. With two test accounts, select a folder under drive.file and try listing and
   downloading existing children, new direct children and new nested exports.
   Record actual allowed/denied results without saving real exports in Git.
3. Repeat using explicit per-file Picker selection and subsequent file revisions;
   test token expiry, account switch and revocation. Verify selected file ownership
   is tied to the current Google/Firebase account and the intended OAuth project.
4. Confirm current scope classification, external-app verification/test-user
   limits and Google's User Data/Limited Use policies with Google's current docs
   and, if needed, the verification team. drive.file is normally non-sensitive;
   that does not waive branding/consent/privacy requirements. Broad restricted
   scopes may require OAuth verification and an independent security assessment,
   especially when restricted data is sent to/stored by servers (including derived
   records in Firestore). A browser-only implementation must not assume exemption.
5. Only implement after the documented scope/verification decision is accepted.
   If no narrow grant supports automatic new-file discovery, ship explicit file
   selection or document the limitation; do not expose private files publicly.

Official references to recheck:

- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/picker/guides/overview
- https://developers.google.com/identity/oauth2/web/guides/use-token-model
- https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- https://developers.google.com/terms/api-services-user-data-policy

Direct retrieval of these Google documentation sites was blocked by the cloud
network policy during this task. The conservative scope model above is a design
constraint, not a claim of a freshly verified Google integration. Live policy and
project verification remain outstanding; no production access was attempted.

## Proposed browser flow

A signed-in user presses Connect Drive. Google Identity Services' token model
requests only the reviewed scope on a user gesture, with an account chooser and
incremental consent. Verify the Google identity matches the active Firebase user;
never equate an arbitrary selected email string with authorization. Keep short-lived
Drive access tokens in memory only, separate from Firebase ID tokens. No refresh
token/client secret in static code, localStorage, Firestore or URLs. Expiry prompts
reauthorization; signing out/switching/revoking clears tokens, pending imports and
any temporary file bytes. The app must handle users canceling the picker or denying
individual files without affecting their existing records.

## Incremental ingestion design

- Per-user import manifests record Drive file ID, revision/version, modified time,
  content hash, parser version and last successful cursor. Filename/time/distance
  alone are not stable identifiers. Add a separately validated owner-only schema
  for these manifests before implementing; current rules deliberately deny it.
- Read bounded selected files on an explicit browser action. Enforce file/row/track
  limits; stream large CSV where possible. Reject unknown formats, malformed dates,
  nonpositive/overlong duration, invalid units and unexpected encodings. Preview
  accepted/rejected counts and provenance before committing.
- CSV: normalize headers and BOM, handle real quoted CSV with a maintained parser,
  explicit km/m and minute/second/hh:mm:ss units, dotted/ISO dates, timezone offsets
  and source-local timestamps. Do not silently interpret ambiguous generic
  `distance` or `durationms` fields. Legacy aliases/classification are the reference.
  Generic TRAINING remains Training; no GPS/distance is required for strength/yoga.
- TCX: reject DTD/external entities, validate XML, support namespaces, sum laps,
  preserve elapsed versus moving time and HR provenance. Match companion CSV/TCX
  by source identity and reliable timestamps/type/duration, never suspect distance.
  Retain reported distance separately from derived distance and no raw route in
  the general workout collection. FIT decoding is outside scope.
- Exact ID/revision reimports are idempotent. Cross-source near-time/duration
  duplicates become review candidates rather than automatically losing a record.
  Use deterministic hashes of canonical source IDs, not display names or a
  minute-rounded date/duration key. Avoid coarse fingerprints that collide.
- Conservative GPS primitive is implemented and tested: valid finite fixes, no
  zero pair, >=20 accepted segments, walking/running speed limits, max 1000 m
  segment and 60 s gap, >=70% accepted-time coverage, <=10% rejected segments and
  plausible total range. Only validated disagreement >10% (or missing/zero raw)
  changes effective distance; raw value and flags survive. Production parser must
  still test time alignment, pauses, sparse samples and realistic synthetic cases.
- Stage a validated import, write resumable bounded owner-only batches, then mark
  that revision complete. A failed/empty/unsupported import must not clear existing
  workouts or check-ins. Never repeat the final legacy importer's replace-on-error
  behavior or its CSV 12-value/13-header alignment defect.

Automatic sync while Chrome is closed is **not** part of this free browser-only
architecture. Service workers cannot be relied on for periodic OAuth refresh and
Drive polling; no paid scheduler/backend is introduced. Imports run only while the
user has the app open, authorized and explicitly initiating the operation.
