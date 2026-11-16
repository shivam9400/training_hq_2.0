# Migration map and deployment gates

The old Sheets/Apps Script application remains operational. No live migration,
Drive authorization, Sheets write, Strava sync or legacy deployment change is made.

| Area | Implemented in web milestone | Still planned |
| --- | --- | --- |
| Navigation/UI | Today, Plan, Progress, Activities, Health, Settings; dark/orange/teal responsive cards and bottom navigation | Rich legacy charts/calendar/badges |
| Training | Named plans, independent multi-session dates, editing session fields and manual status | Locks, day swaps, richer calendar (ten-column CSV importer is implemented) |
| Recovery | Daily manual metrics/notes, sleep/soreness/recent-note training heuristic | Personalized baselines and full coach parity |
| Workouts | Local bounded ZIP/FIT/TCX/CSV/GPX/KML ingestion, raw/GPS validation, deduplication, explicit matches and confirmed dashboard actuals | Drive OAuth/revision manifests, continuous HR series, Strava migration |
| Accounts | Configurable Google popup login, explicit switch/sign-out, memory-only state, empty cloud workspace | Live provider/browser validation and advanced offline policy |
| Data | Strict per-owner Firestore rules, validated schemas, export and resumable client deletion | Server-enforced deletion coordination/retention, high-volume exports |
| PWA/hosting | Static-only shell cache, manifest/icons, manual Pages workflow | Owner-configured Firebase/Pages, production policy review and explicit deployment |
| Drive | Owner-only unverified folder reference, current official API scope evidence, conservative Picker design | Verified scope model, OAuth publishing/verification, production Picker access |

Before real users: create a Spark project, deploy/test rules, enable Google Auth,
verify authorized domains, review hosting-origin trust, quotas and deletion limits,
validate login/account switching on Samsung Chrome with two synthetic test users,
and manually approve Pages deployment. If private-repository Pages requires a paid
GitHub plan the owner does not have, leave deployment disabled; no visibility or
billing changes are automatic. Reassess an explicitly owner-approved public source
repository or another free static host separately rather than paying implicitly.

Only consider disabling Health Sync exports after a future native web import has
been validated against retained copies and duplicate/distance behavior is reviewed.
Keep source exports and legacy Sheets intact throughout. Never use real tracks in
Git fixtures. A future import can be staged against synthetic data first and
exported owner data can be used privately for manual acceptance, outside Git/CI.
