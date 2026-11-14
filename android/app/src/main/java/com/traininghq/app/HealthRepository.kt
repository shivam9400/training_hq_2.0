package com.traininghq.app

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Clock
import java.time.Duration
import java.util.concurrent.CancellationException

sealed interface HealthState {
    data object Idle : HealthState
    data object Loading : HealthState
    data object Unavailable : HealthState
    data object UpdateRequired : HealthState
    data object PermissionRequired : HealthState
    data class Ready(val workouts: List<Workout>) : HealthState
    data object Error : HealthState
}
interface WorkoutSource {
    suspend fun readRecent(): HealthState
}
class HealthRepository(private val context: Context, private val clock: Clock = Clock.systemUTC()) : WorkoutSource {
    companion object {
        const val PROVIDER = "com.google.android.apps.healthdata"
        val permissions = setOf(HealthPermission.getReadPermission(ExerciseSessionRecord::class))
    }
    override suspend fun readRecent(): HealthState {
        return try {
            when (HealthConnectClient.getSdkStatus(context, PROVIDER)) {
                HealthConnectClient.SDK_UNAVAILABLE -> return HealthState.Unavailable
                HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> return HealthState.UpdateRequired
            }
            val client = HealthConnectClient.getOrCreate(context)
            if (!client.permissionController.getGrantedPermissions().containsAll(permissions)) return HealthState.PermissionRequired
            val end = clock.instant()
            val range = TimeRangeFilter.between(end.minus(Duration.ofDays(7)), end)
            val workouts = mutableListOf<Workout>()
            var token: String? = null
            do {
                val page = client.readRecords(ReadRecordsRequest(ExerciseSessionRecord::class,
                    timeRangeFilter = range, pageSize = 100, pageToken = token))
                workouts += page.records.map { record ->
                    Workout(record.metadata.id, record.metadata.dataOrigin.packageName,
                        record.startTime, record.endTime, kindOf(record.exerciseType))
                }
                token = page.pageToken
            } while (token != null)
            HealthState.Ready(recentWorkouts(workouts))
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (_: SecurityException) {
            HealthState.PermissionRequired
        } catch (_: Exception) {
            // Never show/log exception payloads containing device health data.
            HealthState.Error
        }
    }
}
internal fun kindOf(type: Int): WorkoutKind = when (type) {
    ExerciseSessionRecord.EXERCISE_TYPE_RUNNING, ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> WorkoutKind.RUN
    ExerciseSessionRecord.EXERCISE_TYPE_WALKING -> WorkoutKind.WALK
    ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING, ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING -> WorkoutKind.STRENGTH
    ExerciseSessionRecord.EXERCISE_TYPE_YOGA -> WorkoutKind.YOGA
    ExerciseSessionRecord.EXERCISE_TYPE_OTHER_WORKOUT -> WorkoutKind.TRAINING
    else -> WorkoutKind.OTHER
}
