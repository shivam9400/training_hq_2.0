# Security and privacy

## Authorization

Firebase Authentication Google Sign-In provides the identity. The browser does
not authorize itself with an editable UID: Firestore compares `request.auth.uid`
to the path's owner for every operation. Rules allow only plans, sessions,
workouts, races and metrics below that owner, validate all supported fields, and
deny everything else. The browser validates again for usability, not authority.
List requests require a limit <=200. No public health endpoint or service account.
Deploy the checked-in rules before using a real project; never use test-mode rules.

Emulator tests use only `demo-training-hq` and synthetic user-a/user-b fixtures.
They exercise owner CRUD and deny foreign get/create/update/delete for each
collection, anonymous access, forged owner fields, unknown keys/paths,
collection-group queries and invalid values. No production test connection.

## Secrets and public assets

No OAuth client secret, refresh token, private key or real health record is in
source, test fixtures or Pages output. Firebase web API key, authDomain, projectId
and appId are **public client identifiers**, necessarily visible in a configured
browser bundle. They do not bypass Auth or Firestore rules. Supply them as local
ignored environment values or GitHub repository variables; actual key values are
not committed. Do not put service-account JSON, OAuth secrets or private tokens
in any `VITE_*` value: Vite embeds such values in public assets. Restrict API keys
to intended Firebase APIs/origins where compatible and use separate dev/prod
projects. Confirm current Google key restrictions during project setup.

No third-party analytics, private response logging, public Drive links or secret
backend is used. The only CI upload path is web/dist, and only for an explicitly
requested deployment. Do not add health fixtures/export files to public/ or src/.

## Browser and account lifecycle

Login and private document caches are memory-only. Refresh signs the user out.
Sign-out/switch clears React records and forms before another account is loaded;
load generations reject stale responses. Demo data is never silently saved into
a user's account. Server reads avoid offline cache fallback. Network loss disables
cloud mutation controls; writes already sent may succeed later, so retry/export
only after checking the loaded state. No persistent offline write journal is
provided. No app can erase a download, screenshot or compromised device's memory.

The service worker allows only exact static asset paths on the app's origin.
Auth/Firestore/Drive responses and private exports are excluded. A cached public
shell is not an authenticated health-data cache. GitHub Pages content may be
public regardless of source-repository visibility. The meta CSP limits resources,
but Pages does not support arbitrary per-site security headers. Protect the whole
GitHub Pages origin, Google account and repository, use MFA, and review dependency
updates. Custom domains need corresponding Firebase authorized-domain/CSP review.

## Export and deletion

Settings exports only the active user's known collections to a locally downloaded
JSON file (or clearly marked demo export). No tokens are included. Treat exports
as private. The browser does not upload them. Export before deletion if desired.

Deletion requires typing DELETE and Google reauthentication. The client deletes
known owner collections in batches, then deletes the Firebase Auth account.
Close other app tabs/devices first. An interruption may leave partial deletion;
retry while still signed in. There is no atomic cross-service deletion guarantee,
server-enforced deletion tombstone, scheduled retention job or administrative
backup erasure in this free browser-only milestone. A concurrent client may write
between final checks; a production rollout needs an operational process to verify
residual documents with authorized administrative tooling. Never delete Auth
first: that can orphan Firestore documents. Google account, Sheets, Drive exports
and legacy deployments are deliberately untouched. A future Drive integration
must add OAuth revocation and import-manifest cleanup to this design.

## Free tier and abuse

Use Firestore's Spark free database allocation and Google Auth, not phone/SMS
Auth, Functions, Cloud Run, Extensions requiring billing or scheduled backend
jobs. Spark has project-wide storage/read/write/delete quotas and region/database
limits; exceeding quota can interrupt the app rather than providing unlimited
service. Full collection reads consume quota on each refresh and export. Monitor
usage and limit dataset growth. Rules enforce ownership, not a global rate limit.
Public client config is not an abuse barrier; App Check can be evaluated later
with explicit compatibility/verification testing. No billing upgrade is enabled.

Live Firebase project configuration, Google login/popup behavior, quota policy,
App Check and OAuth verification are manual deployment gates, not tested claims.

## Dependency correction

Firebase 13.3.0 pins an old Node-only @grpc/grpc-js 1.9.x dependency with
GHSA-m9gg-hp2v-232j and GHSA-f596-whhp-79r4 advisories. A package-manager override
scoped to @firebase/firestore selects maintained 1.14.7 (patched >=1.13.6).
This is not a checksum override: npm integrity verification stays enabled. The
browser build does not use Node gRPC; emulator tests validate the Node SDK path.
Production npm audit reports zero advisories after the override. Review it when
Firebase updates its pin; do not remove it without rechecking dependency security.

## Local activity import boundary

Raw files and samples are handled only in a bounded disposable browser worker.
ZIP traversal/encryption/symlinks/nesting/CRC/expansion and XML DTD/entity/depth
checks reject unsafe input. No raw content is used in logs, filenames in persisted
provenance, analytics or public uploads. Rules allow only bounded summary fields,
hash aliases and IDs; raw routes/HR arrays are rejected. Baseline hashes and full
transaction snapshots protect edits, not authentication: server-side ownership is
still the security boundary. Cancellation can leave committed chunks, never an
unannounced replacement of an entire collection. Repreview safely to resume.

Future Drive authorization may use a different Google account from Firebase login;
that is a separate explicit consent stored under the owning Firebase UID, never
cross-user data authorization. No OAuth grants/tokens are implemented or stored
by the local file importer. See activity-import.md and drive-integration.md.

## Unverified Drive folder references

Only a fixed owner-only integrations/health-sync document is permitted; see
[its exact schema, exports and deletion behavior](drive-folder-settings.md).
Unknown fields, tokens, identity claims and verified status are rejected. URL
validation never implies Google access. No GIS/Picker/token/Drive request path is
enabled; current policy and exact permission tests remain blocked/unrun as recorded
in drive-feasibility-decision.md. Training data loading does not query this new path.

## Isolated hosted permission experiment

The [hosted diagnostic](drive-hosted-test-guide.md) is a separate opt-in build and
manual deployment to a different dedicated GitHub owner. Public client settings,
tokens and results remain memory-only; no Firebase modules or production service
worker are included. It does not enable production Drive sync or establish actual
future-child authorization. Localhost remains supported. No live deployment or
Google Cloud change is performed automatically.
