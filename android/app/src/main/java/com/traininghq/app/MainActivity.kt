package com.traininghq.app

import android.content.Intent
import androidx.core.net.toUri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val colors = darkColorScheme(
    primary = Color(0xFFFF8A3D), secondary = Color(0xFF2DD4BF),
    background = Color(0xFF070D1B), surface = Color(0xFF111A31),
    onSurface = Color(0xFFE9EFFF), onBackground = Color(0xFFE9EFFF),
    onPrimary = Color(0xFF1B1206)
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val model: HealthViewModel = viewModel(factory = viewModelFactory {
                initializer { HealthViewModel(HealthRepository(applicationContext)) }
            })
            val health by model.state.collectAsStateWithLifecycle()
            val permissions = rememberLauncherForActivityResult(
                PermissionController.createRequestPermissionResultContract()
            ) { model.refresh() }
            val owner = LocalLifecycleOwner.current
            DisposableEffect(owner) {
                val observer = LifecycleEventObserver { _, event ->
                    if (event == Lifecycle.Event.ON_RESUME) model.refresh()
                    if (event == Lifecycle.Event.ON_STOP) model.clear()
                }
                owner.lifecycle.addObserver(observer)
                onDispose { owner.lifecycle.removeObserver(observer) }
            }
            LaunchedEffect(Unit) { model.refresh() }
            MaterialTheme(colorScheme = colors) {
                TrainingApp(health, model::refresh,
                    onPermission = { permissions.launch(HealthRepository.permissions) },
                    onManage = { openHealthSettings() },
                    onInstall = {
                        runCatching { startActivity(Intent(Intent.ACTION_VIEW,
                            "market://details?id=${HealthRepository.PROVIDER}".toUri())) }
                            .onFailure { openHealthSettings() }
                    })
            }
        }
    }
    private fun openHealthSettings() {
        runCatching { startActivity(Intent("android.health.connect.action.HEALTH_HOME_SETTINGS")) }
            .recoverCatching { startActivity(Intent("androidx.health.ACTION_HEALTH_CONNECT_SETTINGS")) }
            .recoverCatching { startActivity(Intent(android.provider.Settings.ACTION_SETTINGS)) }
    }
}

@Composable
fun TrainingApp(
    health: HealthState = HealthState.Idle,
    onRefresh: () -> Unit = {}, onPermission: () -> Unit = {},
    onManage: () -> Unit = {}, onInstall: () -> Unit = {},
) {
    var tab by rememberSaveable { mutableStateOf("Today") }
    val tabs = listOf("Today", "Plan", "Progress", "Health")
    Scaffold(
        bottomBar = {
            NavigationBar {
                tabs.forEachIndexed { index, title ->
                    NavigationBarItem(selected = tab == title, onClick = { tab = title },
                        icon = { Text(listOf("◉", "▦", "↗", "♡")[index]) }, label = { Text(title) })
                }
            }
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)
            .padding(padding).verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("TRAINING HQ", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.secondary)
            Text(tab, style = MaterialTheme.typography.headlineLarge)
            Text("MOCK DASHBOARD · Synthetic demo week · Not connected to Sheets",
                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            when (tab) {
                "Today" -> TodayScreen()
                "Plan" -> PlanScreen()
                "Progress" -> ProgressScreen()
                "Health" -> HealthScreen(health, onRefresh, onPermission, onManage, onInstall)
            }
            Text("Local-only prototype · No production sync", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun Panel(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.secondary)
            content()
        }
    }
}

@Composable
private fun TodayScreen() {
    Panel("Week 3 · Build a steady base · MOCK") {
        Text("Keep showing up.", style = MaterialTheme.typography.headlineSmall)
        Text("Example Saturday · Two sessions · Sample race in 42 days")
    }
    Panel("Today's sessions · MOCK") {
        Text("RUN · Easy aerobic run", style = MaterialTheme.typography.titleLarge)
        Text("35 min · 5 km planned · Conversational effort")
        Text("Warm up gently, run easy, finish with a short walk.")
        Text("YOGA · Mobility · 15 min · Optional evening session")
    }
    Panel("Recovery check-in · MOCK") {
        Text("Resting HR 58 bpm · HRV 48 ms · Sleep 7.5 h")
        Text("Soreness 2/5 · RPE 3/10")
        Text("Example values only. Readiness scoring and check-in saving are not migrated.")
    }
    Panel("This week · MOCK") {
        Text("3 of 5 sessions done · 60 of 150 running minutes")
        LinearProgressIndicator(progress = { 3f / 5 }, modifier = Modifier.fillMaxWidth())
    }
}

private data class DemoSession(val day: String, val type: String, val title: String, val detail: String)
private val demoPlan = listOf(
    DemoSession("Mon", "REST", "Recovery day", "No planned run"),
    DemoSession("Tue", "RUN", "Easy run", "30 min · Done"),
    DemoSession("Wed", "STRENGTH", "Full body", "25 min · Done"),
    DemoSession("Thu", "RUN", "Steady run", "30 min · Done"),
    DemoSession("Fri", "WALK", "Recovery walk", "20 min · Optional"),
    DemoSession("Sat · slot 1", "RUN", "Easy aerobic run", "35 min · Planned"),
    DemoSession("Sat · slot 2", "YOGA", "Mobility", "15 min · Optional"),
    DemoSession("Sun", "RUN", "Long easy run", "55 min · Planned"),
)
@Composable
private fun PlanScreen() {
    Panel("Race countdown · MOCK") { Text("Sample 10K · 42 days · Finish comfortably") }
    Panel("Week 3 · Base phase · MOCK") {
        Text("Focus: consistent easy effort. Multiple sessions retain separate slots.")
        demoPlan.forEach { session ->
            HorizontalDivider()
            Text("${session.day} · ${session.type}", color = MaterialTheme.colorScheme.primary)
            Text(session.title, style = MaterialTheme.typography.titleMedium)
            Text(session.detail)
        }
        Text("Editing, day swaps and status overrides remain in the legacy app.")
    }
}
@Composable
private fun ProgressScreen() {
    Panel("Weekly review · MOCK") {
        Text("60% completion · 3 of 5 sessions", style = MaterialTheme.typography.titleLarge)
        Text("Example season: 38.2 km running · 4 h on feet · 2-run streak")
    }
    Panel("Running load · MOCK") {
        listOf("Week 1" to .5f, "Week 2" to .7f, "Week 3" to .4f).forEach { (week, value) ->
            Text("$week · ${(value * 150).toInt()} min")
            LinearProgressIndicator(progress = { value }, modifier = Modifier.fillMaxWidth())
        }
    }
    Panel("Fitness checkpoint · MOCK") { Text("Easy 30 min · Example avg HR 140 bpm · Target 145 bpm") }
    Panel("Goals and milestones · MOCK") {
        Text("Build toward a comfortable 10K · In progress")
        Text("Sample badge: three consistent weeks")
        Text("Aerobic efficiency, full badges and calculated trends still need migration.")
    }
}

@Composable
private fun HealthScreen(state: HealthState, refresh: () -> Unit, permission: () -> Unit, manage: () -> Unit, install: () -> Unit) {
    Panel("Daily metrics · MOCK") {
        Text("Sleep 7.5 h · HRV 48 ms · Resting HR 58 bpm · Steps 6,200")
        Text("These are examples; sleep, HR, distance and daily metric permissions are not requested yet.")
    }
    Panel("Health Connect · DEVICE DATA · Local only") {
        Text("Optional: read exercise sessions from the last 7 days. Records stay in memory and clear when the app leaves the foreground. No routes, uploads or background reads.")
        when (state) {
            HealthState.Idle -> Text("Ready to check local access.")
            HealthState.Loading -> Text("Checking permissions and reading sessions…")
            HealthState.Unavailable -> Text("Health Connect is unavailable on this device. Demo screens still work.")
            HealthState.UpdateRequired -> {
                Text("Install or update Health Connect, then return and refresh.")
                Button(onClick = install) { Text("Install / update Health Connect") }
            }
            HealthState.PermissionRequired -> {
                Text("Exercise read permission is missing or was denied/revoked. You can continue using the mock dashboard.")
                Button(onClick = permission) { Text("Allow exercise reads") }
            }
            HealthState.Error -> Text("Could not read sessions. Retry or check Health Connect access. No device details were logged.")
            is HealthState.Ready -> {
                if (state.workouts.isEmpty()) Text("No exercise sessions found in the last 7 days.")
                state.workouts.forEach { workout ->
                    HorizontalDivider()
                    Text("${workout.kind} · ${workout.duration.toMinutes()} min elapsed")
                    Text(DateTimeFormatter.ofPattern("dd MMM yyyy HH:mm").withZone(ZoneId.systemDefault()).format(workout.start))
                    Text("Origin: ${workout.sourcePackage}")
                    Text("Distance / HR unavailable: not requested. GPS not read.")
                }
            }
        }
        OutlinedButton(onClick = refresh, enabled = state != HealthState.Loading) { Text("Refresh local workouts") }
        TextButton(onClick = manage) { Text("Manage permissions") }
    }
}

class PermissionsRationaleActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = colors) {
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        Text("Health data use", style = MaterialTheme.typography.headlineMedium)
                        Text("Training HQ reads exercise type, start/end time and source identity for the last 7 days only when exercise read access is granted. Records are displayed locally in memory and cleared when the app leaves the foreground. Nothing is uploaded, logged, backed up or written to Health Connect. No route, distance, heart-rate or background permission is requested. Dashboard metrics remain synthetic mock data.")
                        Text("Revoke access at any time in Health Connect settings. This prototype does not provide medical advice.")
                        Button(onClick = { finish() }) { Text("Close") }
                    }
                }
            }
        }
    }
}
