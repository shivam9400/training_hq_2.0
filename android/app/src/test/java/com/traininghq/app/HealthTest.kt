package com.traininghq.app

import androidx.health.connect.client.records.ExerciseSessionRecord
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class HealthTest {
    @Test fun genericTrainingNeverBecomesStrengthOrYoga() {
        assertEquals(WorkoutKind.TRAINING, kindOf(ExerciseSessionRecord.EXERCISE_TYPE_OTHER_WORKOUT))
        assertEquals(WorkoutKind.STRENGTH, kindOf(ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING))
        assertEquals(WorkoutKind.YOGA, kindOf(ExerciseSessionRecord.EXERCISE_TYPE_YOGA))
        assertEquals(WorkoutKind.OTHER, kindOf(-100))
    }
    @Test fun revokedPermissionsReplacePreviouslyLoadedRecords() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            val start = java.time.Instant.parse("2026-01-01T00:00:00Z")
            var next: HealthState = HealthState.Ready(listOf(Workout("synthetic", "fixture", start, start.plusSeconds(600), WorkoutKind.TRAINING)))
            val model = HealthViewModel(object : WorkoutSource { override suspend fun readRecent() = next })
            model.refresh(); advanceUntilIdle()
            assertTrue(model.state.value is HealthState.Ready)
            next = HealthState.PermissionRequired
            model.refresh()
            assertEquals(HealthState.Loading, model.state.value)
            advanceUntilIdle()
            assertEquals(HealthState.PermissionRequired, model.state.value)
            model.clear()
            assertEquals(HealthState.Idle, model.state.value)
        } finally { Dispatchers.resetMain() }
    }
    @Test fun clearingCancelsInFlightRead() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            val model = HealthViewModel(object : WorkoutSource {
                override suspend fun readRecent(): HealthState {
                    kotlinx.coroutines.delay(1000)
                    return HealthState.Ready(emptyList())
                }
            })
            model.refresh(); runCurrent(); model.clear(); advanceUntilIdle()
            assertEquals(HealthState.Idle, model.state.value)
        } finally { Dispatchers.resetMain() }
    }
}
