# Plan importer validation

All fixtures are independently generated synthetic data. The supplied private
spreadsheet was not accessed, copied, published or changed, and its contents are
not in Git, logs, static assets or test fixtures. The actual source's 69 rows still
need an owner-authorized local CSV acceptance preview; this task makes no claim
of auditing private rows it did not read.

Local results before review:

- Strict TypeScript/Vite production build passed. Vite warns that the Firestore
  chunk is just above 500 kB after adding transaction support; this is a bundle-size
  warning, not a suppressed error or failed build.
- Format and ESLint passed.
- Unit suite: 26 passed, 1 existing expected failure for the unchanged legacy CSV
  column defect; no unexpected failure/skipped tests. Ten new importer tests cover
  mapping, header normalization/reorder, 69 synthetic rows, Unicode/BOM/quoted
  multiline CSV, date/day validation, slots/weeks/types/duration bounds, Rest/Race
  at zero, duplicate identities, reimports, source changes, manual edits/statuses,
  retained rows and source-discrepancy warnings.
- Browser suite: 3 passed (2 existing + importer preview/confirmation/authentication
  gate, cancellation/clearing and invalid-Day error flow).
- Firestore emulator: local download of its official JAR was denied by network
  policy at storage.googleapis.com. No production database was used as fallback.
  The initial real-emulator suite (7 existing + 5 importer tests) passed in
  [hosted run 43717151641](https://github.com/shivam9400/training_hq_2.0/actions/runs/43717151641),
  along with all build/lint/unit/browser checks; deployment was skipped. One more
  status-only concurrency regression was then added (13 total emulator tests);
  its final hosted run is linked in the PR.

The importer emulator tests execute actual transactions: 69 rows, same-preview
retry after commit, A/B imported-document isolation, unknown/malformed metadata,
legacy record compatibility, post-preview manual edit protection, cancellation
at a chunk boundary and recovery without duplicates, stale plan protection and
owner/cancellation guards before writes. The source file is never sent to CI;
only generated fixtures are used.

Live Google OAuth/current-provider requirements could not be verified because
Google developer documentation hosts were network-blocked. The optional Sheets
connection remains design-only. Live Firebase rules publication, private-sheet
access, actual-user account switching and application deployment were not run.
See plan-import.md for the explicit owner-side rules publication command.
