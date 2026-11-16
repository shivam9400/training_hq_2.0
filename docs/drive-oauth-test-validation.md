# Local Drive diagnostic validation — 16 November 2026

**No real Google account was authorized during implementation.** No actual folder,
Picker grant, existing/future file permission, Google revocation or public production
eligibility result is claimed. Run the owner-operated matrix in
[the test guide](drive-oauth-test-guide.md) using the separate approved test project.

Local results:

- Diagnostic strict TypeScript check and main TypeScript build: pass.
- Prettier and ESLint: pass.
- Unit tests: **62 passed, 1 existing expected legacy failure (63 total)**. Thirteen
  diagnostic tests cover exact scope/origin, unauthenticated attempts, API identity,
  pagination/nesting, partial/repeated pages, known future-ID evidence, per-file
  contamination, 403/404/429/5xx, long Retry-After, expiry, stale identity, bounded
  bodies and metadata-versus-body outcomes.
- Diagnostic Chromium: **4 passed**, using mocked GIS/Picker/Drive only. Exercises
  real browser fetch/worker paths, generated binary FIT, narrow-scope configuration,
  identity/folder/list/discovery/body stages, local parse/deduplication, same-token
  Picker, account switching, 403/401, no token in app storage/results, disconnect,
  loopback Host/Origin restrictions and normal-app route exclusion.
- Existing app Chromium: **7 passed**; no production UI or data-persistence behavior
  changed. No actual Firebase login or private records used.
- Separate local diagnostic build: pass, ignored output, blank build-time test config
  and runtime development-only guard. Never uploaded/deployed.
- Production build and mandatory isolation scan: pass. Normal module graph rejects
  diagnostic imports; dist and service worker exclude diagnostic/config/GIS markers.
  Firebase Auth's pre-existing gapi loader is legitimate and unchanged. Existing
  ~629 kB parser / ~505 kB Firestore chunk warnings remain non-fatal.
- Workflow/actionlint, Git whitespace validation: pass. No dependencies added.
- Local Firestore emulator: runtime download blocked by workspace network policy;
  no live database fallback. PR CI runs the unchanged 20-test emulator suite.

Hosted validation: pending initial PR run. The workflow additionally builds the
local diagnostic and runs mocked diagnostic browser tests; Pages still uploads only
web/dist on an explicitly requested main-branch deployment. No diagnostic output,
environment, raw file, results, token or log artifact is uploaded by these new steps.

Production Auth source, Firestore rules/data, legacy application and Google Cloud
settings are unchanged. Actual replacement Client ID/key values are never committed;
only synthetic identifiers are supplied to browser mocks. Broader scopes are never
requested and the diagnostic contains no Firebase import or Drive mutation method.
