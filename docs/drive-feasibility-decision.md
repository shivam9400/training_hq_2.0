# Google Drive feasibility decision — 16 November 2026

**Decision: gate closed for live OAuth and folder-wide sync.** Implement only
private unverified folder references and preserve local imports. Design explicit
per-file Picker as the narrow fallback; do not present it as implemented OAuth.
No production scope, consent setting, private file or external permission was accessed.

## Current official evidence obtained

Google's official generated Drive API specification was retrieved through the
GitHub API from googleapis/google-api-go-client. The document revision is
**20261106**; its latest source change was **9 November 2026**, commit
[836a8fc15f17d9c8b4992dee3939dcdd5c3e9b26](https://github.com/googleapis/google-api-go-client/blob/836a8fc15f17d9c8b4992dee3939dcdd5c3e9b26/drive/v3/drive-api.json).
This is current official API documentation, not a live authorization experiment.

| Scope / method | Official description / consequence |
| --- | --- |
| drive.file | “See, edit, create, and delete only the specific Google Drive files you use with this app.” No documented folder inheritance guarantee in this specification. |
| drive.readonly | “See and download all your Google Drive files.” Candidate for folder-wide listing and downloading; it authorizes substantially more than one folder. |
| drive.metadata.readonly | “See information about your Google Drive files.” Does not authorize workout file-body ingestion. |
| files.list | Supports q searches, pagination and all files by default, including trash; future design must filter trashed=false and honor page tokens. |
| files.get | alt=media downloads stored binary file contents; Docs/Sheets/Slides require export and are not Health Sync workout binaries. |

Direct retrieval of the current official policy/Picker pages below and the Google
Discovery endpoint returned **HTTP 403 from the workspace network**. An available
GitHub copy of Google's generated API specification establishes scope descriptions,
not current consent classification, external-app verification eligibility, security
assessment exemption or a Picker grant to future child files.

- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/picker/guides/overview
- https://developers.google.com/identity/oauth2/web/guides/use-token-model
- https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- https://developers.google.com/identity/protocols/oauth2/policies

## Answers and limits

1. **drive.file + folder selection:** not verified as covering existing/future
   Health Sync children. Folder membership is not evidence of an individual file
   grant. No folder crawler or ongoing-sync promise is implemented.
2. **Folder-wide read-only:** drive.readonly is the API's broad read/download
   candidate. Treat it as restricted/high-review until its current classification
   is checked. Do not request it without owner approval. Metadata-only is insufficient.
3. **Public multi-user verification/assessment:** unresolved release gate. Verify
   current scope classification, branding/consent, test-user restrictions, Limited
   Use policy, and whether derived summaries in Firestore require assessment.
   Browser-only processing does not establish an exemption or guarantee a free release.
4. **GitHub Pages:** HTTPS is necessary but does not prove OAuth eligibility.
   Confirm the exact authorized JavaScript origin (origin has no repository path),
   consent-domain ownership, privacy/deletion pages and Google publishing policy.
   A shared github.io origin may require an owned domain or another reviewed setup;
   no successful production-origin verification is claimed.
5. **Different Google accounts:** architecturally separate Firebase UID ownership
   from the explicitly consented Drive identity. Exact same/different-account
   behavior still requires authorized tests. Never use an editable email or folder
   URL authuser parameter as authorization.
6. **Fallback:** local ZIP/file import works now. Explicit per-file Google Picker
   selection is the proposed drive.file fallback, pending its own policy/account
   checks. New files need their own demonstrated grant; do not secretly escalate.

No authorized test OAuth project, consent setup or test-account grants were supplied.
The requested exact permission experiment therefore **was not run**. Unit tests or
mock APIs cannot replace that experiment. The gate remains closed until both current
policy checks and the authorized test matrix below are completed.

## Owner-run synthetic acceptance matrix (not executed)

Use a separate approved test OAuth project and two consenting test accounts A/B.
Use only an explicitly authorized synthetic folder, not a real Health Sync archive.
Create test exports through another approved app/owner action, so they are not files
created by Training HQ itself. Record only grant/HTTP outcomes, not tokens or bodies.

- Firebase A + Drive A, then Firebase A + Drive B; verify displayed Drive identity,
  explicit destination confirmation and that summaries/configuration remain under A.
- With drive.file, select only the folder in Picker. Attempt folder metadata,
  paginated child listing and body download for existing direct/nested files.
- After authorization, create new direct/nested exports through that other app.
  Repeat listing/download; empty lists do not prove there are no new exports.
- Explicitly select individual files in Picker; test their bodies, later revisions,
  canceled selection, denied files, duplicated selections and revoked grants.
- If broad readonly is approved and policy requirements satisfied, test complete
  folder traversal, pagination, cycles/shortcuts, bounded mixed types and failures.
- Expire/revoke tokens, switch Firebase or Drive account during a read, return
  401/403/404/429/5xx and interrupt imports. Verify no stale-user result or writes,
  bounded retries, visible partial results and reimport idempotency.
- Confirm the deployed Pages origin, external consent publication/verification and
  assessment requirements with current official documentation/Google review.

Owner approval to test/request scopes is separate from this code review. No broad
scope, production permission, deployment or source creation/modification is performed
by this PR. Keep local uploads if the free approved model cannot satisfy the gate.
