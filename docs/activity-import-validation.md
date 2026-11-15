# Activity import validation

All fixtures are independently generated synthetic exports, including a real binary
FIT encoder output, an invented route and generated HR values. No uploaded/private
Health Sync files, personal metadata or real routes are included. Legacy Apps Script
bytes are unchanged. No live Firebase/Drive/Sheets access or deployment was attempted.

## Local results (2026-11-15)

- Prettier format and ESLint: pass.
- Unit suites: **45 passed, 1 expected failure** (46 total). The existing expected
  failure records the preserved legacy CSV alignment defect; it is not an importer
  failure. Includes actual binary FIT/CRC/sentinel parsing, TCX GPS/HR, workout CSV,
  generic Training without GPS, unsupported overlapping HR CSVs, ZIP/unsafe XML,
  duplicate/repeated imports, source edits, GPS quality and same-day matching.
- Mobile Chromium: **6 passed**, viewport 390×844. Covers the local worker/ZIP
  companion merge, 8.32 km source versus ~4.26 km validated GPS, authenticated-save
  gate, reselect/cancel, unsafe XML, continuous HR notices, multiple same-day matches,
  status preservation/unmatch, existing plan CSV and static-only offline caching.
- Production TypeScript/Vite/service-worker build: pass. Non-fatal bundle-size
  warnings for the FIT/XML/ZIP worker (~629 kB) and Firestore chunk (~504 kB).
- Production dependency audit (`npm audit --omit=dev --audit-level=low`): zero
  advisories. Maintained MIT FIT/XML and BSD-3-Clause ZIP parsers are pinned; parser
  licenses accompany public assets. No proprietary FIT SDK dependency.
- Local Firestore emulator: **could not run**. Runtime download from
  storage.googleapis.com is blocked by this workspace's network policy, including
  a retry with writable CLI/Java configuration. No permissive fallback or live
  database was used. PR CI runs the emulator on Ubuntu; its outcome is recorded below.

## Firestore coverage and hosted validation

The emulator suite now has 18 tests: existing per-collection two-user CRUD isolation,
schema/query denial, plan CSV transactions/recovery plus imported workout summaries,
raw-field rejection, foreign activity/match access, single-summary chunk cancellation,
idempotent retries, concurrent-edit rejection, explicit reciprocal links, status
preservation, occupied-session rejection and unmatching. It uses demo-training-hq
only. Hosted CI initially exposed a permission failure in the ten-document recovery
transaction (and a two-document retry). Diagnostics confirmed the 1,000-expression
Firestore rules budget. Summary chunks now contain one workout; final hosted
validation is pending.

## Manual acceptance still required

Physical Samsung Chrome picker/memory behavior, actual device export variants,
live Google login/account switching, production Spark quotas and owner-published
rules must be checked privately after review. Browser automation uses synthetic demo
preview/matches; private persistence is exercised by emulator tests, not production
credentials in browser tests. Google Drive authorization, restricted-scope policies
and access to future exports remain unverified design work; no live access ships.
