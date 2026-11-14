# Instructions for coding agents

- Read README.md and docs/requirements.md before making changes.
- Use `legacy/apps-script/` only as the functional and UI reference; do not overwrite the existing live Apps Script deployment.
- Develop in small branches and propose pull requests; do not automatically merge or deploy.
- Avoid collecting or committing any real personal health data, routes, secrets, tokens, Google Sheet IDs, or identifying account information.
- No public unauthenticated endpoints for health records. Never embed a service-account key, static backend secret, or Strava token in the APK.
- Prefer Kotlin, Jetpack Compose, AndroidX Health Connect, Room, WorkManager.
- Start local-only: Health Connect permissions and readable recent workouts before designing production sync.
- For activities keep generic TRAINING separate from confirmed strength/yoga classes.
- Preserve raw and GPS-derived distance with provenance and quality flags; never silently override a reported value without validation.
- Prefer synthetic fixtures and document any limitations. Run available tests and report those that could not run.
