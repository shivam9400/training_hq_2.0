import { localDate } from "./calculations";
import type { Records } from "../types/data";
export function demoRecords(): Records {
  const today = localDate();
  return {
    plans: [
      {
        id: "demo-plan",
        title: "Steady foundations · MOCK",
        startDate: today,
        endDate: today,
      },
    ],
    sessions: [
      {
        id: "demo-run",
        planId: "demo-plan",
        date: today,
        type: "Run",
        title: "Easy aerobic run",
        minutes: 35,
        target: "Conversational effort",
        instructions:
          "Warm up gently. Keep the main run easy. Finish with a walk.",
        status: "Planned",
      },
      {
        id: "demo-strength",
        planId: "demo-plan",
        date: today,
        type: "Strength",
        title: "Full-body foundations",
        minutes: 20,
        target: "Controlled movement",
        instructions: "Light bodyweight circuit, resting between sets.",
        status: "Planned",
      },
    ],
    workouts: [
      {
        id: "demo-workout",
        title: "Sample easy walk",
        type: "Walk",
        start: `${today}T07:00:00Z`,
        end: `${today}T07:30:00Z`,
        reportedMeters: 2500,
        gpsMeters: null,
        distanceSource: "reported",
        qualityFlags: ["unvalidated-summary"],
        source: "mock",
        sourceId: "synthetic-walk",
        averageHr: null,
      },
    ],
    races: [],
    metrics: [
      {
        id: today,
        date: today,
        restingHr: 58,
        hrv: 48,
        sleepHours: 7.5,
        soreness: 2,
        rpe: 3,
        steps: 6200,
        notes: "Synthetic example, not a personal health record.",
      },
    ],
  };
}
