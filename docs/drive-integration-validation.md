# Drive gate and folder-settings validation — 16 November 2026

## Implemented checks

- Formatting, ESLint and strict TypeScript/Vite/service-worker production build pass.
- Unit suites: **49 passed + 1 existing expected legacy failure (50 total)**.
  New tests cover canonical/account-indexed/legacy URLs, normalization, malicious
  hosts/credentials/paths/query parameters, token/resource-key rejection, bounds,
  strict configuration fields and inability to claim verified access.
- Mobile Chromium: **7 passed** at 390×844. New browser flow checks local URL
  validation, sign-in save gate, unavailable Connect/Sync controls, no Google API
  or OAuth requests in the unconfigured demo, form cleanup on navigation and preserved
  local import entry. Configured folder saves use private Firestore only.
- Existing synthetic nested ZIP, FIT/TCX/CSV companions, repeated imports, GPS
  validation, plan/status matching and static-only caching tests continue passing.
  These are **not** Drive listing or OAuth tests.
- Production build retains non-fatal size warnings (~629 kB parser worker,
  ~505 kB Firestore chunk). No dependencies or external OAuth scripts added.
- Local Firestore emulator: runtime download from storage.googleapis.com blocked;
  no live Firebase fallback. The PR workflow runs the actual emulator suite on
  Ubuntu, including 18 existing tests and two new configuration isolation/lifecycle
  tests (**20 total**). **All 20 passed** in
  [hosted validation 43869383258](https://github.com/shivam9400/training_hq_2.0/actions/runs/43869383258)
  on implementation commit bb25e47; all other workflow checks passed and deployment
  and artifact upload were skipped.
- Production npm audit: zero advisories. actionlint, whitespace validation and
  gitleaks pass; no secrets detected.

## Exact OAuth/Drive tests not run

No authorized test OAuth project/client, test-account consent or current policy
verification was supplied. Live same/different Google accounts, folder existence
and access, future Health Sync children, Drive pagination/nesting, revoked/expired
access tokens, API 401/403/404/429/5xx, Picker grants and the production Pages OAuth
origin were **not tested**. There is no enabled API/token flow for those tests.
Mocking them would not satisfy the user's exact permission-model gate.

See the owner-run synthetic matrix in drive-feasibility-decision.md and the
fallback/error contract in drive-picker-fallback.md. The API specification was
retrieved from Google's official GitHub source; current policy/Picker sites were
blocked by the workspace network. No current verification/assessment exemption
or successful account grant is claimed.

## Release boundary

No merge, deploy, live rules publication, production scope request, account-permission
change or private source-file access. The owner must review/publish rules to use
saved folder references and configuration cleanup. No source file is ever modified
or deleted. Folder access remains unverified; local file import remains available.
