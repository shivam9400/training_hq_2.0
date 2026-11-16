# Hosted diagnostic validation

Implementation branch: feat/hosted-drive-oauth-diagnostic, based on reviewed
feat/local-drive-oauth-diagnostic. No production UI, Firebase configuration, data,
Firestore rules or legacy source changes. No deployment or Cloud setting changes.

Managed-workspace results:

| Check | Outcome |
| --- | --- |
| Prettier, ESLint | Passed |
| Strict app and diagnostic TypeScript | Passed through all builds |
| Unit tests | 176 passed, 1 existing expected failure |
| Hosted mocked-HTTPS browser tests | 3 passed |
| Preserved localhost diagnostic browser tests | 4 passed |
| Codespaces proxy regression tests | 7 passed (simulated authenticated proxy; real Vite/module worker/HMR) |
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

## Codespaces proxy regression

See [reproduction, exact rejected conditions and recovery](drive-codespace-proxy-fix.md).
38 new unit cases cover valid proxy formats and malicious host/origin combinations.
Five integration/browser tests cover the real Vite HTTP graph, HTTPS browser worker,
valid and malicious HMR upgrade and refusal of CLI listener/port overrides. No live
Codespaces authentication cookie or actual Google authorization was used.

The second origin investigation adds 23 unit cases and two browser/integration
cases, including a full HTTPS browser/module/worker pass with Origin omitted.
Fixed `X-Training-HQ-Origin-Reason` enums distinguish the previously conflated
rejections. The actual failing live Origin/Fetch Metadata is still unavailable;
these tests do not identify its value or claim the live sign-in/OAuth flow passed.

Browser interception supplies explicit synthetic Fetch Metadata fixtures because
Playwright does not expose the on-wire browser metadata there. Actual Vite HTTP
requests independently test valid/malicious header combinations. Neither is a
capture or proof of the live Codespaces proxy header values.

## Backend-Origin compatibility follow-up

The owner confirmed the old live rejection was `origin-backend`. The new branch
allows only read-only static resources with a validated loopback peer, matching
backend/public authority, independent exact public forwarding host + HTTPS protocol,
and same-origin Fetch Metadata. It does not extend to root documents, API/health
files, arbitrary methods, unproven local Origins or WebSocket upgrades.

47 additional unit cases cover accepted rewrites and missing/conflicting/forged
proof. Two additional integration/browser cases simulate the rewrite and load the
actual Vite module graph and parser worker; raw HTTP tests also check accepted CORS
and fixed classification headers. There are now 7 Codespaces cases / 21 total
browser/integration cases. Browser HMR is mocked; the actual Vite handshake and public, backend, missing and
malicious-Origin upgrade outcomes are tested independently over HTTP. During the
manual worker phase, at most one exact known mock event (`WebSocket closed without
opened.`) is separately classified; no parser, module or other page error is
ignored. This fixture allowance never enters application code or builds.

TypeScript, formatting, lint and the localhost/hosted/production builds and isolation
checks were run. Local Firestore emulator startup remains blocked by the distribution
JAR download; no local rule assertions ran. CI runs that unchanged suite separately.
No production/Firebase source or rules changed. No deployment or live Codespace
verification was performed. The live result before this fix is not proof of the
new behavior, and the exact tunnel rewrite component has not been traced.
See [commands, trust model and verification limits](drive-codespace-proxy-fix.md).
