# Training HQ 2.0

A mobile-first, multi-user training PWA built with React, strict TypeScript and
Vite. The web app replaces the active Android direction; the existing Apps Script
application is retained unchanged as a reference. No Android Studio, phone app
installation, Render, Strava subscription or paid backend is required.

Today, Plan, Progress, Activities, Health and Settings support editable sessions,
multi-session days, manual completion/partial/skipping, recovery check-ins, manual
workouts, race goals and progress. Signed-out data is explicitly **MOCK**, synthetic
and memory-only. Google Sign-In and private Firestore persistence become available
when you configure your own Firebase project; no production project is connected
in this repository. Demo data is never copied into a signed-in account.

## Local development

Use Node 24 (or a compatible version >=22.12). Java 21 is needed **only** for the
Firestore emulator tests, not for running the frontend. From the repository root:

```sh
cd web
npm ci
npm run dev
# Open the URL printed by Vite, including /training_hq_2.0/.
```

No configuration is needed for the labeled demo. For a private development project,
copy `.env.example` to `web/.env.local` and fill the four public Firebase web
configuration values. Never add service-account JSON, OAuth secrets or tokens.
Restart Vite after configuration changes. Do not use production health records in
this checkout. On shared machines use a private browser session.

```sh
cd web
npm run lint
npm test
npm run test:rules      # demo-training-hq emulator, no Firebase login/real project
npm run build
npx playwright install --with-deps chromium  # once on a normal workstation/CI
npm run test:e2e
npm run preview
```

On this managed workspace the browser tests use `/usr/bin/chromium`; on a normal
workstation set `CI=true` to use Playwright's installed browser. The emulator must
be able to download its signed/checksummed distribution from storage.googleapis.com.
See [validation](docs/validation.md) for actual outcomes and [development](docs/development.md)
for supported workspace overrides. All dependencies are lockfile-pinned.

## Firebase Spark setup (manual owner action)

1. Create a Firebase project on **Spark**, without attaching billing. Register a web
   app. Do not enable phone/SMS Auth, Functions, Cloud Run or billing-required
   products. Google Sign-In and Firestore have free allowances, not unlimited use.
2. Enable Authentication > Google, configure the support email/branding and test
   accounts. Add the actual hosting domain (for Pages: `shivam9400.github.io`) to
   Authentication's authorized domains; localhost may need adding explicitly for
   development. Domains are hostnames, not repository URL paths. Use the standard
   project `.firebaseapp.com` authDomain; custom domains require CSP/auth review.
3. Create a Cloud Firestore database in a suitable available free-tier region in
   **production mode**, not permissive test mode. Review region/data residency and
   quota constraints. Never enable public reads/writes while troubleshooting.
4. From web/, authenticate the Firebase CLI locally as the project owner and deploy
   **only rules and indexes** after reviewing the target project:

   ```sh
   npx firebase login
   npx firebase deploy --config ../firebase.json --project YOUR_PROJECT_ID --only firestore:rules,firestore:indexes
   ```

   This is an owner-run operation; it was not run against any real project by this
   implementation. The demo test project is never a deployment target.
5. Supply the public config through ignored web/.env.local or GitHub repository
   variables `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
   `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`. These web identifiers will be
   visible in a configured bundle; they are not authorization secrets. Actual key
   values are not committed. Rules, Auth and appropriate API-key restrictions
   protect access. Keep service-account/OAuth secrets out of VITE variables.
6. Test Google popup login, denial, explicit account switch/sign-out and two-user
   data isolation on the target browser. Empty user workspaces are intentional.
   No persistent login or offline health cache: page reload signs the user out.

## GitHub Pages (not deployed automatically)

Vite, manifest, service worker and navigation use `/training_hq_2.0/`. Only web/dist
is deployable. Pages is **static hosting**, not an access-control layer: published
assets must be safe to make public even if the repository is private. Private-repo
Pages may require GitHub Pro/Team/Enterprise rather than GitHub Free; verify the
owner's plan first. This task never changes repository visibility, billing or Pages
settings. Do not assume a private repository makes the website private.

After PR review/merge and Firebase setup, the owner may enable Pages with source
**GitHub Actions** in repository settings and configure protection/reviewers on the
`github-pages` environment. Run **Web validation and manual Pages deployment** on
`main` with `deploy=true` only when publication is explicitly intended. The default
is false. PRs and pushes validate but never deploy. Deployment needs only job-scoped
`pages: write`/`id-token: write`; other jobs use `contents: read` and commit-pinned
maintained actions. Firebase rules are not deployed by the Pages workflow.

## Samsung Chrome

After an owner-approved deployment, open
`https://shivam9400.github.io/training_hq_2.0/` in Samsung Chrome. No new phone
installation is needed. Use the six bottom tabs; Settings opens Google Sign-In's
account chooser. Allow the login popup if blocked. Switch account or sign out in
Settings before handing over a device. Optional Add to Home screen is a convenience,
not a requirement. First load needs a connection; only public static resources are
available on offline reload. Cloud records and writes require connectivity.

## Documentation and limitations

- [Architecture and data schema](docs/architecture.md)
- [Requirements and implemented boundaries](docs/requirements.md)
- [Security, export, deletion and free-tier limits](docs/security.md)
- [Drive scope feasibility and ingestion design](docs/drive-integration.md)
- [Migration roadmap](docs/migration.md), [cleanup audit](docs/cleanup-report.md)
- [Preserved legacy analysis](docs/legacy-architecture.md), [validation](docs/validation.md)

Production Drive authorization/imports, closed-browser synchronization, personalized
HR/HRV coaching and full legacy analytics are not implemented. No actual Google
Sheets, Drive exports or deployed Apps Script were accessed or modified. Free
quotas may interrupt service; no paid fallback is configured. Account deletion is
resumable client-side batching, not an atomic server-side erasure guarantee.
