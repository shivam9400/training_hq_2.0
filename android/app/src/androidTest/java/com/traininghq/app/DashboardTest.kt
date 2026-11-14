package com.traininghq.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Rule
import org.junit.Test

class DashboardTest {
    @get:Rule val compose = createComposeRule()
    @Test fun allTabsAreNavigableAndMocksAreLabeled() {
        compose.setContent { MaterialTheme { TrainingApp(health = HealthState.PermissionRequired) } }
        compose.onNodeWithText("MOCK DASHBOARD", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Today's sessions · MOCK").assertExists()
        compose.onAllNodesWithText("Plan").onLast().performClick()
        compose.onNodeWithText("Week 3 · Base phase · MOCK").assertExists()
        compose.onAllNodesWithText("Progress").onLast().performClick()
        compose.onNodeWithText("Weekly review · MOCK").assertExists()
        compose.onAllNodesWithText("Health").onLast().performClick()
        compose.onNodeWithText("Allow exercise reads").performScrollTo().assertIsDisplayed()
    }
    @Test fun emptyDeviceRecordsAreNotReplacedByMocks() {
        compose.setContent { MaterialTheme { TrainingApp(health = HealthState.Ready(emptyList())) } }
        compose.onAllNodesWithText("Health").onLast().performClick()
        compose.onNodeWithText("No exercise sessions found in the last 7 days.").performScrollTo().assertIsDisplayed()
    }
}
