# Private Health Sync activity import

## Using the importer

In Activities choose **Import Activities**, then select your own ZIP or individual
FIT, TCX, workout CSV, GPX or timestamped KML files. Nested Health Sync directories
are supported; unrelated metadata is ignored. Selection never accesses Google
Drive or changes source files. Keep originals privately in Drive yourself: the app
neither backs them up nor uploads/deletes them. No real exports belong in Git/CI.

Parsing runs locally in a disposable browser worker. A signed-out user can preview
without saving. Sign in, wait for private records to load, preview again and review
every warning, duplicate candidate and missing field. Continue to a separate
confirmation and acknowledgement before any Firestore writes. Only normalized
summaries are sent to the currently authenticated owner's workouts collection.
Raw files, filenames, routes and HR time series never go to Firestore or logging.

For zone-less CSV times, enter the **source** UTC offset (e.g. +05:30), not an
assumed browser timezone. Across daylight-saving changes use separate imports with
the correct offset or export timestamps with explicit offsets. GPX/KML with no
known type remains Other unless you explicitly confirm all unknown tracks in that
selection are Walk or Run. Other/Training GPS cannot replace a reported distance.

On Samsung Chrome, download/export files privately, open this site and choose
Files/Downloads in the system picker. ZIP avoids selecting many individual files.
Keep the tab open during parsing/saving. Mobile Chromium at 390×844 is automated;
physical Samsung device/picker and live Google login remain owner acceptance tests.

## Format support and honest missing values

- FIT: maintained MIT `fit-file-parser` in strict CRC/framing mode, bounded binary
  preflight and session/record limits. Sessions and available record HR/GPS/elevation
  are decoded. Signed sentinel GPS values are excluded. Generic sport/fitness
  equipment remains Training; strength/yoga require explicit subtype evidence.
  Timer time is not assumed to be moving time, cycles are not invented steps.
- TCX: maintained `fast-xml-parser`; namespaces, activities, laps, timestamps,
  distances, calories, lap HR and HR/GPS/elevation/cadence records. Elapsed time is
  declared lap total when available, otherwise last timestamp minus activity start.
  Lap averages are duration-weighted; record averages are labeled sample-derived.
  Other sport remains generic Training. No moving time is inferred from HR/GPS.
- CSV: maintained Papa Parse handles UTF-8 BOM, Unicode, quoted/multiline fields.
  Headers normalize whitespace/punctuation/case. Supported aliases include
  start datetime/timestamp, date + start time, explicit end, activity type/sport,
  duration minutes/seconds or hh:mm:ss, distance km/meters, average/max HR,
  calories/kcal, steps, cadence rpm/steps-per-minute, elevation gain m and native ID.
  Generic distance has no assumed units; numeric ambiguous duration is not assumed
  seconds. Moving minutes alone cannot establish elapsed duration. A row with no
  reliable start/end rejects that file rather than importing an incomplete workout.
  Contradictory timestamp/reported durations are retained with a warning.
- GPX: timestamped track segments, known type/name, HR extension and elevation.
  Untimed routes are unsupported. No reported distance/moving time is invented.
- KML fallback: only timestamp-aligned gx:Track; ordinary untimed LineString is
  unsupported. Type/source distance/moving time are missing unless independently
  supplied. Do not infer workout type from coordinates or filename.

Continuous/daily/historical HR CSVs are explicitly **unsupported pending a separate
health-series pipeline**. Overlapping HR exports never create activities or combine
with workout rows. Sample-level HR/elevation/GPS exists only during local processing;
summary counts, extrema and provenance survive, not detailed records. Calories are
kcal; cadence units stay explicit. Missing measurements are null, not fabricated 0.
Pace is calculated from effective distance and elapsed duration, labeled elapsed.

## Input safety and distance validation

Selection: 1–50 inputs, ≤20 MiB total/ZIP; ≤8 MiB individual/extracted file (FIT
≤4 MiB); ≤40 MiB expanded; ≤250 ZIP entries; compression ratio ≤150; ≤200 workout
summaries; ≤50,000 samples per workout; XML ≤250,000 tags/depth 40. The worker
terminates at 45 seconds or cancellation. Large archives must be split privately.
ZIP declared and actual sizes, CRC, overlapping entries, encryption, symlinks,
traversal/absolute paths and nested ZIPs are checked. Unsafe archive validation
rejects the selection; malformed supported members are individually reported and
excluded. No failed file leaves partially parsed rows in the preview. Unsupported
individual extensions are rejected. XML DTD/entity declarations, unsafe names,
malformed markup and excessive nesting are rejected; no external resource loading.

GPS checks coordinates, finite values, (0,0), absolute/relative times, ordering,
conflicting same-time fixes, segment boundaries, gaps, jumps and speed. Identical
timestamp duplicates collapse. Walk ≤4.5 m/s, Run/Race ≤9 m/s; gaps ≤60 s and
segments ≤1000 m. Reliability requires ≥20 accepted segments, ≥90% accepted-time
coverage of elapsed duration, ≤10% rejected segments and 200 m–200 km total.
These conservative gates can reject legitimate paused/sparse/very short workouts;
they preserve source distance rather than manufacturing a correction.

Both reported distance and GPS-derived accepted-segment total survive, with a
quality flag even when GPS fails. An unreliable GPS total is diagnostic only.
Effective distance changes only after all checks pass and disagreement exceeds
10%, or source distance is missing/zero. Reported values remain visible. No
correction for unknown/non-running/non-walking sports. Invalid sentinel points do
not contribute distance; dense valid coverage can still establish reliability.

## Deduplication and protected updates

Versioned SHA-256 identities include format, native source ID when present, type
and precise start/end; source aliases support revisions. Filename, array index,
rounded minute or distance alone is never an identity. Without a native ID,
identical type/time records are inherently indistinguishable: differences require
review, never silent loss. Synthetic fixtures exercise this ambiguity.

Exact repeated summaries collapse. Uniquely aligned, different-format companions
with equal type and start/end within two seconds merge complementary fields.
A competing candidate prevents automatic selection. Near matches (start ≤5 min,
end tolerance max(3 min, 15% elapsed)) and same-source revisions require review.
Review offers skip, intentional distinct identity, or merge into a selected unedited
import. Same-format conflicting distance cannot be discarded through merge; keep
separate/skip. Metric conflicts preserve target values and add source-conflict;
per-format reported distances are retained. No arbitrary averaging of sources.

Previously saved summaries are compared with their stored content hash, excluding
match links. Manual changes are protected conflicts. Existing links survive
safe enrichment. All intended writes have complete expected snapshots; concurrent
edits/status changes fail safely. Repeated imports of the same ZIP are unchanged.
Intentional distinct IDs are deterministic for retry. Provenance is bounded to
8 aliases/5 formats; excessive conflicting history requires splitting/skipping.

## Persistence, quotas and recovery

Only `users/{authenticatedUid}/workouts/{act_hash}` summary documents are written.
Optional strict details/provenance maps and reciprocal session/workout IDs preserve
old records. Rules reject raw tracks/HR arrays, unknown fields and foreign paths.
They enforce ownership/schema, not the scientific truth of user-supplied metrics.

Writes use transactions of ≤2 workouts, maximum three attempts. Reads precede
writes; exact already-applied payloads are no-ops. Progress advances after commits.
A cancellation/account switch stops future chunks; an already in-flight chunk may
commit. Completed chunks remain. Reload private records, select the same files,
review and confirm the remaining changes. No persistent browser journal or raw
archive upload is needed. Interrupted imports never clear existing activities.
Each retry/read/refresh consumes Spark quota; 200-workout selection and bounded
writes reduce spikes but do not guarantee unlimited free usage. Quota/network
failures stop visibly. No Firebase Storage, backend, Functions or billing needed.

## Plan matching and dashboard

Activities proposes all compatible local-date/type/duration (50–150% planned)
sessions; Run can match Race. Multiple same-day sessions remain independent.
Nothing auto-completes or auto-links a session. Select the intended session and
acknowledge; an independent checkbox explicitly requests Done. Date/type overrides
have a warning, especially generic TRAINING. Unmatch has an explicit action and
never resets completion status. Already occupied sessions must first be unmatched.
Transactions check the full workout, prior session and new session snapshots.

Today and Progress use only reciprocal confirmed links for actual-versus-planned
duration/distance summaries. Missing distances are counted as missing. Planned
instructions/targets/minutes and manually recorded statuses are preserved.
Matching uses device-local calendar dates; review timezone differences manually.

## Release boundary

Publish reviewed Firestore rules **manually as the owner** before using imported
summaries or links live (README Firebase CLI instructions). Old rules deny the new
fields safely. Review/merge and Pages deployment are separate owner actions; this
PR deploys neither app nor rules. Live Drive authorization is design-only; see
[Drive feasibility](drive-integration.md) and [validation](activity-import-validation.md).
