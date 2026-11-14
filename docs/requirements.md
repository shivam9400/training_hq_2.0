# Training HQ 2.0 product requirements

## Existing behavior to preserve
- Google Sheets is the current system of record for training plans, check-ins, goals/races and workout tracking.
- Existing Apps Script web dashboard: Today, plan, progress, session adjustments.
- Existing imports: Strava API and Health Sync CSV/TCX exports stored in Google Drive.
- Workout types: running, walking, strength, yoga and generic TRAINING. A GPS route is not required for valid non-GPS workouts.
- Display walking and running pace when distance and duration are valid.
- Existing health exports may have inconsistent summary distances: preserve raw value and validated GPS-derived value with source labels.

## Native Android V1
- Android app usable independently of Chrome account sessions, with Today, Plan, Progress and Health tabs.
- Permission-led Health Connect integration, graceful handling of missing data and no permissions.
- Read recent exercise sessions, duration, distance, HR (where available), sleep, HRV, steps and resting HR when records exist and user permits access.
- Local cache for resilience; initial iteration uses local data or mock data only.
- Strong duplicate identification and incremental sync design (implementation later).

## Later milestones
- Authenticated API to existing Sheets, background WorkManager sync, safe import migration, distance-quality checks and running analytics.
- GPS route access requires user permission and may not be available for all records.
- Disable Health Sync exports only after native sync is validated and legacy data is safely retained.
