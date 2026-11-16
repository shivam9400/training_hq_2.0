# Hosted diagnostic validation

Implementation branch: feat/hosted-drive-oauth-diagnostic, based on reviewed
feat/local-drive-oauth-diagnostic. No production UI, Firebase configuration, data,
Firestore rules or legacy source changes. No deployment or Cloud setting changes.

Managed-workspace results:

| Check | Outcome |
| --- | --- |
| Prettier, ESLint | Passed |
| Strict app and diagnostic TypeScript | Passed through all builds |
| Unit tests | 68 passed, 1 existing expected failure |
| Hosted mocked-HTTPS browser tests | 3 passed |
| Preserved localhost diagnostic browser tests | 4 passed |
| Production application browser tests | 7 passed |
| Localhost, isolated hosted and production builds | Passed |
| Hosted asset isolation / production bundle and SW isolation | Passed |
| Production dependency audit | 0 vulnerabilities |
| Firestore emulator locally | Blocked: emulator JAR download from storage.googleapis.com failed; assertions did not run locally |

Hosted tests serve the actual built assets at an intercepted synthetic HTTPS origin,
with mocked GIS, Picker and Drive. They verify missing configuration/no automatic
Google contact, explicit user triggers, exact callback scope/origin, metadata/list/
download, no Firebase/storage/SW, account switching, expiry/401, disconnect and
wrong-origin/path refusal. Existing local tests cover same-grant new-file probes,
Picker contamination and API failure outcomes. Unit tests cover deployment owner,
repository, SHA, Pages CNAME/source/URL and runtime allowlists. Build scans reject
source maps, SW and Firebase/credential markers. A synthetic target is not a
published site. No actual OAuth success is inferred from these tests.

Not run: live Pages publication/environment approval, actual Google account grants,
Google's acceptance of the configured hosted origin, actual future-file permissions,
real consent revocation, and the private Codespaces forwarding/proxy/browser flow.
These require the owner's separate setup and consenting synthetic-data experiment.
No private Drive file, identifier or result was collected. Public multi-user OAuth
verification/security-assessment questions and folder-wide sync remain gated.

See [browser-only setup and fallback](drive-hosted-test-guide.md) and the
[full permission test matrix](drive-oauth-test-guide.md). CI results on the PR are
separate from the local emulator limitation; a green mocked browser test is not a
Google authorization result.
