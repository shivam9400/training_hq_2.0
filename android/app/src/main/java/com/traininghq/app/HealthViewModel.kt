package com.traininghq.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class HealthViewModel(private val source: WorkoutSource) : ViewModel() {
    private val mutableState = MutableStateFlow<HealthState>(HealthState.Idle)
    val state = mutableState.asStateFlow()
    private var readJob: Job? = null
    fun refresh() {
        readJob?.cancel()
        // Clear previously read data before rechecking permissions.
        mutableState.value = HealthState.Loading
        readJob = viewModelScope.launch { mutableState.value = source.readRecent() }
    }
    fun clear() {
        readJob?.cancel()
        mutableState.value = HealthState.Idle
    }
}
