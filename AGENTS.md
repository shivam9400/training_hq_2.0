# Working on Training HQ

- Read README.md and docs/requirements.md. Active app: React + strict TypeScript + Vite in web/. Use the existing isolated checkout; no worktree unless requested.
- Use a small feature branch and review PR; never merge, deploy, enable billing or change repository visibility automatically.
- Preserve legacy/apps-script/ byte-for-byte as reference unless the user explicitly authorizes a legacy change. Never alter deployed Apps Script, Sheets or Drive.
- Use GitHub Pages static hosting and Firebase Authentication/Firestore Spark. No Android, Render, service-account backend or paid infrastructure.
- No private keys, tokens, actual Firebase API-key values, account identifiers, raw health exports, GPS tracks, signing keys or personal fixtures in Git or deployed assets. Public Firebase configuration is supplied by environment/repository variables at build time, never a service-account credential.
- Keep all user data under users/{authenticated uid}/known collections. Firestore rules are the authorization boundary. Unknown fields/collections and cross-user access must fail. Never enable permissive production rules or use a form/query UID for authorization.
- Memory-only private data/auth cache. Service worker may cache only static build resources, never Firebase/Drive/auth responses. Clear state and cancel stale loads on account changes; no user data in logs or analytics.
- Generic TRAINING is not confirmed strength/yoga. Preserve raw/GPS distances, quality flags, source IDs and timestamps; never silently overwrite an unvalidated distance. Non-GPS sessions are valid; pace needs valid duration and distance.
- No production Google Drive access until scope feasibility and OAuth review are verified. Selecting a folder does not imply access to future Health Sync child files. No closed-browser background sync.
- Activity parsing stays in a bounded disposable browser worker; persist normalized summaries only. Keep reported/calculated metrics distinct, raw routes/HR series local, and session matching/status changes explicitly confirmed. See docs/activity-import.md.
- Use synthetic fixtures. From web/: npm ci; npm run lint; npm test; npm run test:rules; npm run build; npm run test:e2e. Emulator tests use only demo-training-hq. Report passed, expected-failure and unrun checks separately.
- Pages deployment is manual dispatch on main with deploy=true, after review and separate user action. Keep PR/push validation read-only and deployment token grants job-scoped.
