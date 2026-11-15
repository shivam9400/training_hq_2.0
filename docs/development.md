# Development and checks

Use one Node package/lockfile in web/. Node 24 is used in CI. The Firestore emulator
requires Java 21; running the app does not. No Firebase production authentication,
Android SDK or cloud secret is needed for tests.

Commands from web/: `npm ci`, `npm run lint`, `npm test`, `npm run test:rules`,
`npm run build`, `npm run test:e2e`. The browser tests use the production preview
at `/training_hq_2.0/`, synthetic demo data and a 390px viewport. They cover session
creation/edit/status, six tabs, check-in/readiness, export, horizontal overflow,
offline reload and the service worker's static cache allowlist. No real Google
login or health records are used. On CI, Playwright installs its own Chromium;
on this cloud workspace the existing /usr/bin/chromium is used. Set CI=true on a
normal workstation after `npx playwright install --with-deps chromium`.

The rules test script starts a local-only Firestore emulator at 127.0.0.1:8080
with demo-training-hq, refuses other emulator hosts, clears data between tests,
and shuts down afterward. It never falls back to production. Port 8080 must be
free. Download access to storage.googleapis.com is needed for the initial JAR.
If the cloud network denies that download, use the PR's GitHub Actions rules test
result; do not weaken TLS, replace security tests with mocks, or point at a real
project. Java/CLI cache locations may need workspace paths in managed sandboxes:

```sh
export npm_config_cache=/workspace/tooling/npm-cache
export XDG_CONFIG_HOME=/workspace/tooling/firebase-config
export FIREBASE_EMULATORS_PATH=/workspace/tooling/firebase-emulators
```

Keep inherited proxy/CA settings. For a Java custom trust store, use the platform's
trusted CA; do not disable certificate/checksum verification. The existing cloud
JDK 21 runtime is sufficient for the emulator. Never dump environment values,
credential files, real exported records or runtime health logs while diagnosing.

Unit tests include pure functions from the unchanged Apps Script in an isolated
Node VM with a tiny synthetic CSV fixture. No Apps Script service is called.
One test is deliberately expected to fail until a separate legacy migration fixes
its 12-value/13-header CSV row defect. Keep that result distinct from passing new
web logic. Future import parsers need full quoted-CSV/XML/timezone fixture suites.

`npm run dev` uses development HMR without the production CSP preamble restrictions;
`npm run build` injects the production CSP and creates the static SW allowlist.
No remote fonts or analytics. The browser automatically activates a new service
worker after old tabs close. No forced update during editing.
