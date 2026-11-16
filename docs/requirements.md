# Training HQ web milestone

## Implemented scope

Mobile-first React/TypeScript/Vite PWA at `/training_hq_2.0/` with Today, Plan,
Progress, Activities, Health and Settings. Dark navy cards, orange actions, teal
secondary accents and bottom navigation preserve the legacy concepts. Plans have
multiple independently editable sessions on each date; Run, Race, Strength, Rest,
Walk, Yoga, generic Training and Other remain distinct. Session duration, targets,
instructions, Done/Partial/Skipped overrides and daily recovery check-ins are
editable. Zero-minute Race/Rest and optional source day/slot/week/phase metadata are supported.
The private ten-column plan CSV importer includes local preview, stable identities,
conflict protection and authenticated bounded transaction writes (see plan-import.md).
Local Health Sync ZIP/FIT/TCX/workout CSV/GPX/timestamped KML import, preview,
GPS quality checks, deduplication, protected incremental writes and explicit plan
matching are implemented (activity-import.md). Continuous HR CSV ingestion remains
unsupported. Manual workouts and race goals are supported. Empty, loading, offline
and sanitized error states are explicit.

Signed-out demo records are synthetic and labeled MOCK; edits stay in memory.
Configured Google login opens an empty user workspace rather than copying demo
records. Firestore stores plans, sessions, workouts, races and metrics exclusively
under `users/{uid}/...`. Strict security rules deny other accounts and unknown
fields/paths. Public client configuration is injected at build time. Auth and
Firestore caches are memory-only. No production Firebase project was provisioned.

Public static PWA resources alone are service-worker cached. The app is usable
in Samsung Chrome without installing anything. Add to Home screen is optional.
Cloud reads/writes require connectivity; offline private persistence and
background synchronization while closed are outside this milestone.

## Legacy invariants retained

Google Sheets remains operational; nothing writes to it. Date+slot multi-session
identity must not collapse to a date-only document. Manual completion overrides
remain separate from workout evidence. Partial completion counts half; Rest is
excluded from session completion. Run-duration thresholds 85%/40% are preserved
in a tested calculation. Exact source IDs dedupe; cross-source heuristics need
review, not blind merging. Walking/running pace requires valid distance and time.
Generic TRAINING never means confirmed strength/yoga; lack of GPS is valid.
Reported/GPS distance and provenance remain separate, and noisy tracks do not win.

## Planned, not represented as implemented

Unverified owner-only folder references and explicit unavailable Connect/Sync
controls are implemented; URL syntax acceptance is never access verification.
Production Google Drive OAuth/Picker and remote revision manifests remain planned; continuous HR
CSV series storage; full legacy load/HR-efficiency/checkpoint/badge algorithms;
personalized HR/HRV baseline settings; richer calendar and plan swaps; persistent
encrypted health cache. Local activity ingestion and explicit matching are
implemented, with physical Samsung picker/live account acceptance still manual.

No Android app, paid Strava API, Render, Cloud Functions/Cloud Run billing,
background worker backend or publicly shared health files is required or enabled.
