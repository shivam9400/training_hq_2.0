package com.traininghq.app

import java.time.Duration
import java.time.Instant
import java.util.Locale

/** Generic TRAINING is deliberately distinct from confirmed strength and yoga. */
enum class WorkoutKind { RUN, WALK, STRENGTH, YOGA, TRAINING, OTHER }
enum class DistanceQuality { REPORTED_UNVALIDATED, GPS_VALIDATED, UNAVAILABLE }
data class Workout(
    val sourceId: String,
    val sourcePackage: String,
    val start: Instant,
    val end: Instant,
    val kind: WorkoutKind,
    val reportedMeters: Double? = null,
    val gpsMeters: Double? = null,
    val distanceQuality: DistanceQuality = if (reportedMeters == null) DistanceQuality.UNAVAILABLE else DistanceQuality.REPORTED_UNVALIDATED,
) {
    // Elapsed session duration, not Strava moving time.
    val duration: Duration get() = Duration.between(start, end)
    val pace: String? get() {
        val meters = reportedMeters ?: return null
        if (kind !in setOf(WorkoutKind.RUN, WorkoutKind.WALK) || !meters.isFinite() || meters <= 0 || duration.isNegative || duration.isZero) return null
        val seconds = Math.round(duration.toMillis() / 1000.0 / (meters / 1000.0))
        return String.format(Locale.ROOT, "%d:%02d /km", seconds / 60, seconds % 60)
    }
}

/** Health Connect identity, scoped to its originating app; never dedupe by distance. */
fun recentWorkouts(records: List<Workout>): List<Workout> = records
    .filter { it.end > it.start }
    .distinctBy { it.sourcePackage to it.sourceId }
    .sortedByDescending { it.start }
