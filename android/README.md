# Training HQ Android prototype

Kotlin 2.0.21, Compose, AGP 8.10.1, Gradle 8.11.1, Java 17 bytecode. The build can run
on JDK 17 or 21. Minimum Android 9/API 28; Health Connect exercise reads need a
supported device (Android 9–13 need a compatible Health Connect provider and
Google Play services; Android 14+ integrates Health Connect with the system).

## Build in Android Studio

1. Open this `android` directory in Android Studio Meerkat Feature Drop or newer with AGP 8.10
   support. Select JDK 17/21 for Gradle.
2. Install Android SDK Platform 36, Build Tools 35.0.0 and Platform Tools using SDK
   Manager. Let Studio create ignored `local.properties`, or set `ANDROID_HOME`.
3. Sync and run the `app` configuration on an API 28+ emulator/device.

Command line from `android/`:

```sh
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
./gradlew :app:assembleDebugAndroidTest
# Requires connected Android emulator/device:
./gradlew :app:connectedDebugAndroidTest
```

The checked-in wrapper pins Gradle with its distribution SHA-256. Dependencies
come from Google's Maven repository, Maven Central and the Gradle plugin portal.
Use the platform's supported proxy settings if Java requires explicit network
configuration; do not disable TLS or artifact verification.

## Demo and permissions

Every dashboard tab labels its synthetic examples MOCK. These values do not
represent the current date, a real person or Health Connect records. Plan and
check-in editing are not enabled. Health > Device data is separate and initially
shows permission/availability status. Tap Allow exercise reads to request the sole
read permission. Denial leaves demo navigation available. Manage permissions opens
Health Connect settings; install/update is offered when the provider needs it.
The rationale explains use. No INTERNET, route, background or write permissions.

Only exercise type, start/end (elapsed duration) and source identity from the last
seven days are read. Distance, pace and HR in the device list remain unavailable;
no aggregate is silently assigned to a session. Unknown exercise types remain
OTHER, generic workout remains TRAINING. Records stay in memory, clear when the
app stops, and are reread after returning. No Room, sync, real data fixtures,
analytics logging or backend exists in this milestone.

## Tests and manual checks

JVM tests cover valid/invalid pace, non-GPS activities, provenance preservation,
source identity, chronological ordering, generic type mapping, grant revocation
and cancelling pending reads on clear. Compose instrumented tests cover all four
tabs, mock labels, permission and empty-device states. See `docs/validation.md`
for actual run results; compiling an instrumented APK does not execute it.

On a supported test device with synthetic Health Connect sessions:

- Verify no-provider/update flow; install or update, return and refresh.
- Deny exercise access, navigate all tabs; grant and refresh again.
- Verify empty seven-day window, multiple pages of sessions, run/walk, strength,
  yoga and generic training; check origin and elapsed duration.
- Revoke access in system settings and resume; old records must disappear.
- Background and reopen; verify memory-only records are cleared/reread.
- Rotate, use large fonts/TalkBack and confirm scrollable content and tab labels.
- Exercise privacy/rationale entry points on Android 13 and Android 14+.

No production health source, Google Sheets or Strava is needed for these checks.
Future tasks should use the existing isolated checkout, without creating a worktree
unless explicitly requested.
