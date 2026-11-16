A separate owner-operated [localhost OAuth diagnostic](drive-oauth-test-guide.md)
is now implemented for the approved test project using drive.file only. It is not
a production connection; real Google grant outcomes are still unrun. The production
gate and unverified folder-setting implementation below remain unchanged.

# Google Drive authorization and import feasibility

**Status: live OAuth/Drive access remains disabled.** Private unverified folder
references are now implemented; this document's authorization/ingestion sections
remain future design. See the [16 November feasibility decision and official API
evidence](drive-feasibility-decision.md), [implemented settings](drive-folder-settings.md)
and [per-file Picker fallback contract](drive-picker-fallback.md).
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
user-selected local file upload is another narrow, browser-only option. Production Picker remains design-only. The local Health Sync ZIP/FIT/TCX/CSV/GPX
importer is implemented separately; it requires no Google Drive scope.

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
   test token expiry, account switch and revocation. Verify the consented Google identity and grant belong to the intended OAuth
   project. Explicitly test a Drive Google account different from Firebase login.
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
incremental consent. A user may deliberately authorize a **different Google account**
from Firebase login. Clearly display both identities and confirm the destination
Firebase account before reading/importing. Use the verified OAuth/OIDC response to
bind the selected Drive identity (issuer + subject), not an editable email field or
an assumption that Firebase's token grants Drive access. Scope any future connection
configuration to `users/{authenticatedUid}/driveConnections/{connectionId}` with
strict owner-only rules/schema added and emulator-tested before implementation.
Current rules permit only the unverified fixed folder reference described in
drive-folder-settings.md; verified identities, scopes and manifests remain denied. Folder ID, Drive subject, reviewed
scope and non-secret cursor/version belong only there; no token, raw file or route.
Selecting a Drive account never changes the Firebase owner path or permissions. Keep short-lived
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
  the general workout collection. FIT decoding is now implemented locally using maintained MIT fit-file-parser.
- Exact ID/revision reimports are idempotent. Cross-source near-time/duration
  duplicates become review candidates rather than automatically losing a record.
  Use deterministic hashes of canonical source IDs, not display names or a
  minute-rounded date/duration key. Avoid coarse fingerprints that collide.
- Conservative GPS primitive is implemented and tested: valid finite fixes, no
  zero pair, >=20 accepted segments, walking/running speed limits, max 1000 m
  segment and 60 s gap, >=90% accepted-time coverage, <=10% rejected segments and
  plausible total range. Only validated disagreement >10% (or missing/zero raw)
  changes effective distance; raw value and flags survive. The local parser now tests time alignment, gaps, sparse coverage, sentinels,
  contradictory sources and synthetic cross-format companions. Real-device private
  acceptance remains outside public fixtures.
- Stage a validated import, write resumable bounded owner-only batches, then mark
  that revision complete. A failed/empty/unsupported import must not clear existing
  workouts or check-ins. Never repeat the final legacy importer's replace-on-error
  behavior or its CSV 12-value/13-header alignment defect.

Automatic sync while Chrome is closed is **not** part of this free browser-only
architecture. Service workers cannot be relied on for periodic OAuth refresh and
Drive polling; no paid scheduler/backend is introduced. Imports run only while the
user has the app open, authorized and explicitly initiating the operation.

## Next-stage Sync Activities decision

After verified consent, a user-triggered **Sync Activities** would list only the
configured folder and descendants visible to the reviewed grant, compare bounded
file revision manifests, download changed files into the existing local worker,
preview and confirm summary writes. Folder configuration is private to the owning
Firebase account, even when Drive login differs. Revoke/disconnect clears tokens
and future configuration; never delete source files. Account switching cancels all
pending reads/imports and clears tokens. No Drive token is a Firebase credential.

`drive.file` cannot promise discovery/read access to future Health Sync-created
files. Explicit Picker selection per new file is the narrow candidate. Full folder
listing/body access may need restricted `drive.readonly`; metadata-only permission
cannot parse workouts. Google verification and a possible independent assessment
are separate from Firebase Spark and may prevent a zero-cost broad-scope release.
Do not claim a browser-only exemption, free verification or verified ongoing folder
access. Current policy/consent requirements and a two-account grant matrix must be
verified before live implementation. If that cannot be met securely without paid
requirements, retain local uploads/explicit file selection and document the limit.
No backend billing is technically needed for foreground downloads, but that alone
does not satisfy OAuth policy. Closed-browser sync remains unavailable.

## Isolated hosted permission experiment

The [hosted diagnostic](drive-hosted-test-guide.md) is a separate opt-in build and
manual deployment to a different dedicated GitHub owner. Public client settings,
tokens and results remain memory-only; no Firebase modules or production service
worker are included. It does not enable production Drive sync or establish actual
future-child authorization. Localhost remains supported. No live deployment or
Google Cloud change is performed automatically.
