# Validation

Validated in the cloud workspace on 14 November 2026 with a full Temurin JDK 17,
Android SDK Platform 36, AGP 8.10.1 and the checked-in Gradle 8.11.1 wrapper.

From `android/`:

```sh
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug :app:assembleDebugAndroidTest
```

| Check | Result |
| --- | --- |
| Debug application APK | Passed; `app/build/outputs/apk/debug/app-debug.apk` |
| JVM tests | 8 passed, 0 failed, 0 errors, 0 skipped (WorkoutTest: 5, HealthTest: 3) |
| Android lint | Passed; 0 errors, 1 warning: target API 35 is below compile API 36; target behavior changes require device validation before adoption |
| Instrumented test APK | Compiled and assembled successfully; `app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk` |
| Compose instrumented tests | 2 tests added, not executed: `adb devices` reported no attached device/emulator; `/dev/kvm` is absent |
| Manifest permission inspection | APK declares exercise read and AndroidX's internal signature receiver permission; no INTERNET, write, route or background-read permission |
| Git whitespace check | Passed |
| Legacy source preservation | No differences from base `250358f` under `legacy/apps-script/` |

The final build completed successfully after adjusting the toolchain to Health
Connect 1.1.0's SDK 36 requirement and provisioning a full JDK rather than the
image's runtime-only Java installation. Java proxy/CA settings and writable SDK
caches were configured locally; TLS and artifact checksum verification stayed on.
No credentials or health records were used in validation.

Device availability, provider installation/update, real Android permission dialogs,
Health Connect IPC and pagination against a populated store, revocation while
backgrounded, Android 13/14 rationale entry points, rotation, font scaling and
TalkBack remain unverified. JVM tests use synthetic fixtures and a fake workout
source for ViewModel state/cancellation; they do not substitute for device reads.
See the manual checklist in `android/README.md`.

The repository's legacy Apps Script was analyzed statically, not executed against
Google Sheets/Drive/Strava. Import defects documented in `docs/architecture.md`
are source findings; no production records or deployments were accessed.
