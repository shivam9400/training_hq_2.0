# Private ten-column training-plan import

## What is implemented

Plan > Import Plan reads a user-selected CSV locally with Papa Parse. It never
fetches, publishes or changes a spreadsheet. The source is the actual **ten-column
Plan worksheet**, not the historical 27-column Apps Script Plan layout. No private
spreadsheet identifiers, source rows, OAuth tokens or credentials are embedded in
this repository. All committed fixtures are independently generated synthetic data.

Required headers (normalized by Unicode NFKC, lowercase and removal of punctuation/
spacing; position may vary):

| CSV header | Stored field | Validation |
| --- | --- | --- |
| Date | date | Real ISO YYYY-MM-DD, surrounding whitespace ignored |
| Day | day | Exact English Sun/Mon/Tue/Wed/Thu/Fri/Sat matching Date in UTC |
| Slot | slot | Integer 1–99, unique within each Date |
| Wk | week | Integer 1–9999 |
| Phase | phase | Original text, <=120 characters |
| Type | type | Run, Strength, Race, Rest; surrounding whitespace ignored |
| Session | title | Original nonblank text, <=120 characters |
| What to do | instructions | Original text, <=4000 characters |
| Target (HR / pace) | target | Original text, <=200 characters |
| Planned min | minutes | Nonnegative decimal <=900; Run >0; Race/Rest can be 0 |

Quoted commas, Unicode, BOM, CRLF and quoted multiline fields are supported.
Original title, instructions, phase and target text are not rewritten or trimmed.
Semantic numeric/date/day/type cells are validated after surrounding whitespace
is removed. Unknown/missing/duplicate headers, extra columns, invalid dates,
wrong weekdays, duplicate date/slot keys and overlong fields block the import.
Nothing is truncated or silently corrected. Record numbers refer to logical CSV
records, not physical lines (a quoted field may contain several lines).

One file is limited to 1 MiB and 500 rows to bound parsing, memory and Spark usage.
A preview shows total rows, valid rows, source date range, Type counts, sessions per
Wk, errors, warnings and every mapped field. Summaries describe validated rows if
there are errors; no rows are written until all errors are resolved. Slots sort
numerically within each date throughout Plan, Today and Next up. Gaps warn, but
are retained. Disjoint km distances in Session vs instructions, or long-run titles
paired with recovery instructions, produce review warnings, never a correction.
This heuristic can flag legitimate warmup/recovery wording and is not a plan audit.

## Owner workflow

1. In the authorized Google Sheets browser session, select the private Plan tab
   and use File > Download > Comma-separated values (current sheet). Do not change
   sharing, publish-to-web settings or the source cells for this app. If the export
   is not ISO dates/expected headers, resolve its format privately before importing.
2. Sign in to Training HQ. Open Plan > Import Plan. Local preview is available in
   demo mode, but **saving is disabled unless authenticated**. Demo imports never
   persist records locally or in Firestore.
3. For Create New Plan, enter a memorable **stable source reference** and display
   name. Reuse that reference for the same source; a new reference means an
   intentionally distinct plan. Do not use a changing filename or credentials.
   The source reference is hashed, not stored as plaintext. The plan title is saved
   as private user data. Existing references cannot silently create a second plan.
4. For reimports or recovery, choose Update Existing Imported Plan and select that
   source. Its stored source identity is reused regardless of filename or row order.
5. Preview all additions, changes, conflicts and unchanged rows. Expand any row to
   see all new fields and existing fields/status. Review source discrepancies.
6. Continue to the separate confirmation screen and acknowledge that conflicts
   stay protected. Confirm import to the active account. Only safe additions and
   changes are written. Cancellation stops future chunks; the current transaction
   may finish. It does not undo earlier commits.
7. After failure/interruption, use Reload private data for recovery, reselect the
   same CSV and Update Existing Imported Plan. Already committed rows become
   unchanged; uncommitted rows are additions/changes. No rollback/deletion occurs.
   If the plan was never committed, Create with the same reference remains safe.

Temporary CSV/file objects and preview text remain in browser memory only, are
cleared on cancel/navigation/account change, and are not logged, cached by the
service worker, sent to analytics, GitHub or public storage. Only the confirmed,
validated mapped plan/session records go to `users/{current auth uid}/...`.
Close the app on shared devices; a browser cannot promise immediate forensic
memory erasure or remove a CSV already downloaded outside the app.

## Identity, updates and concurrency

- Source ID is SHA-256 over a versioned, normalized stable source reference. Plan
  ID is `imp_<source hash>`. Session ID is `row_<SHA-256(source ID, Date, Slot)>`.
  Structured hash inputs avoid concatenation ambiguity; duplicate date/slot rows
  are rejected rather than guessed. No array index, title, minutes or filename is
  used as the row identity. Hashing is an identifier mechanism, not encryption or
  authorization. Identical hashes in different users' paths do not grant access.
- Each imported plan/session stores a strict optional importSource map with sourceId,
  sourceHash and version=1; sessions also store rowId. sourceHash fingerprints the
  last imported source fields. Session status is deliberately excluded.
- Same source + same content is unchanged even when the user has marked Done,
  Partial or Skipped. The current status remains untouched. A source change is
  eligible only if stored content still matches its prior import hash and status
  is Planned. Manual content/metadata edits and protected statuses become conflicts.
  Conflict rows are retained, never overwritten. This version does not offer a
  force-overwrite switch; resolve deliberately through manual editing/source review.
- Manual plan name/date changes also remain protected. Missing source rows are
  retained with a warning. Changing a source date/slot creates an addition and
  leaves the previous row; the importer cannot infer that a session moved from
  ten columns alone. No implicit deletes/rekeys.
- Plan metadata commits first. Session writes use transactions of at most 20 rows;
  every transaction rereads the plan and compares **complete current snapshots**
  with the preview before writing. Concurrent edits/status changes, plan deletion
  or account changes stop that chunk rather than overwrite. Transactions retry
  at most three attempts. Exactly matching already-applied writes are skipped,
  permitting safe retries after ambiguous connection/acknowledgement failures.
- Progress is updated only after a chunk commits, never during a retried callback.
  Cancellation checks run before each chunk and after reads. Firestore transactions
  cannot run offline and are not a persistent write queue. A lost connection may
  leave a commit's acknowledgement uncertain: reload/preview, do not assume rollback.
- With 69 valid rows, a fresh import normally writes 1 plan + 69 sessions, with
  reads for those records and a plan check per chunk (plus normal workspace reads).
  No background polling, global scan, automatic unlimited retry, raw CSV document
  or new collection is added. Spark quotas still apply, including retried reads.

## Required owner-side rules publication

The app's existing production rules will reject imported metadata until the owner
publishes the reviewed rules in this PR. Existing documents without the new fields
remain valid. Only optional day, slot, week, phase and strict importSource maps were
added to the known plans/sessions schemas; unknown keys/paths/owners remain denied.
Race at zero minutes is now allowed, while zero-minute Run is still rejected.
Manual session edits preserve import metadata so later imports detect edits.

After review/merge, the owner can run from web/ against their selected project:

```sh
npx firebase deploy --config ../firebase.json --project YOUR_PROJECT_ID --only firestore:rules
```

Verify the project and review/test rules first. This task does not run that command
against live services, change Google Sheets, merge or deploy the web app. No new
composite index, paid backend or billing-enabled product is required.

## Tests and remaining verification

Unit tests exercise ten-column mapping (including reordered normalized headers),
69 independently generated rows, zero-minute Rest/Race, quoted/multiline Unicode,
invalid data, stable identities, row reorder, source changes, manual edits/statuses,
missing rows and source discrepancy warnings. Browser tests cover preview,
confirmation/authentication gating, cancellation/clearing and invalid weekdays.
Actual emulator tests exercise imported metadata/rules, A/B isolation, transaction
execution, retry-after-commit, cancellation/resume and stale-record protection.
No test accesses the original spreadsheet or uses its private rows. Its actual
69-row contents cannot be claimed validated without an owner-authorized local CSV
acceptance test. Google OAuth/live provider validation remains unrun.
