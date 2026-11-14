package com.traininghq.app

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class WorkoutTest {
    private val start = Instant.parse("2026-01-01T00:00:00Z")
    private fun workout(kind: WorkoutKind = WorkoutKind.RUN, meters: Double? = 5000.0) =
        Workout("fixture-1", "synthetic.fixture", start, start.plusSeconds(1800), kind, meters)

    @Test fun runningAndWalkingPaceUseValidDistanceAndDuration() {
        assertEquals("6:00 /km", workout().pace)
        assertEquals("6:00 /km", workout(WorkoutKind.WALK).pace)
        assertEquals("6:00 /km", workout(meters = 5000.1).pace)
    }
    @Test fun nonGpsActivitiesStayValidWithoutPace() {
        for (kind in listOf(WorkoutKind.TRAINING, WorkoutKind.STRENGTH, WorkoutKind.YOGA)) {
            val w = workout(kind, null)
            assertNull(w.pace)
            assertEquals(1, recentWorkouts(listOf(w)).size)
        }
    }
    @Test fun invalidDistanceOrDurationNeverProducesPace() {
        for (meters in listOf(null, 0.0, -1.0, Double.NaN, Double.POSITIVE_INFINITY)) assertNull(workout(meters = meters).pace)
        assertNull(workout().copy(end = start).pace)
        assertNull(workout().copy(end = start.minusSeconds(1)).pace)
    }
    @Test fun sourceScopedIdentityDedupesWithoutCollapsingDistinctSessions() {
        val first = workout()
        val later = first.copy(sourceId = "fixture-2", start = start.plusSeconds(60))
        val otherSource = first.copy(sourcePackage = "other.fixture")
        val result = recentWorkouts(listOf(first, first, later, otherSource, first.copy(sourceId = "invalid", end = start)))
        assertEquals(3, result.size)
        assertEquals(later, result.first())
    }
    @Test fun rawAndGpsDistancesRemainSeparate() {
        val w = workout().copy(gpsMeters = 6000.0)
        assertEquals(5000.0, w.reportedMeters!!, 0.0)
        assertEquals(6000.0, w.gpsMeters!!, 0.0)
        assertEquals(DistanceQuality.REPORTED_UNVALIDATED, w.distanceQuality)
        assertEquals("6:00 /km", w.pace)
    }
}
