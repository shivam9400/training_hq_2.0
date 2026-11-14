# Training HQ 2.0

Private Android training dashboard project migrating a working Google Apps Script / Google Sheets application to a native Android app backed by Health Connect.

## Current application

`legacy/apps-script/Code.gs` and `legacy/apps-script/Index.html` are the existing implementation used as a **reference**, not a production deployment target. They include day-by-day training plans, check-ins, activity imports from Strava and Health Sync Google Drive exports, and mobile dashboard UI.

The existing Sheets setup stays operational while the Android app is developed. Do not replace its code automatically.

## Target architecture

- Android: Kotlin, Jetpack Compose, Health Connect SDK, Room and WorkManager.
- Backend: authenticated sync API, secure server-side access to existing Google Sheets / Apps Script.
- Workout records: preserve source IDs, original and corrected distance, timestamps, activity type and provenance; prevent duplicates.
- Include strength/yoga/generic TRAINING as well as running/walking and health metrics.

## First milestone

Create a local-only Android application with a dashboard (Today, Plan, Progress, Health), sample data labeled as mock, permission flow and a Health Connect reader for recent workouts. No production write access or live secrets. Add tests and Android Studio build instructions.

## Safety

Do not commit health exports, real GPS tracks, account details, credentials, tokens, production Google Sheet IDs, APK signing keys or runtime logs. Check legacy source before publishing the repository.

## Android prototype

Open [`android/`](android/) in Android Studio. The local-only Compose prototype
provides Today, Plan, Progress and Health with clearly labeled synthetic dashboard
data and an optional Health Connect exercise-session reader. It does not connect
to Sheets, Strava or a backend.

- [Build, tests and device checks](android/README.md)
- [Legacy architecture, Sheets schema and migration analysis](docs/architecture.md)
- [Validation results and limitations](docs/validation.md)
