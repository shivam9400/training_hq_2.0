import type { Kind, Metric, Session, Workout } from "../types/data";
export function localDate(day = new Date()): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}
export function normalizeKind(value: string): Kind {
  const sport = value.trim().toLowerCase();
  if (/run|jogg|treadmill/.test(sport)) return "Run";
  if (/walk|hik/.test(sport)) return "Walk";
  if (/strength|weight|resistance/.test(sport)) return "Strength";
  if (/yoga/.test(sport)) return "Yoga";
  if (/training|workout|exercise|fitness/.test(sport)) return "Training";
  return "Other";
}
export function durationMinutes(
  workout: Pick<Workout, "start" | "end">,
): number | null {
  const value = (Date.parse(workout.end) - Date.parse(workout.start)) / 60000;
  return Number.isFinite(value) && value > 0 ? value : null;
}
export function effectiveMeters(workout: Workout): number | null {
  return workout.distanceSource === "gps-validated"
    ? workout.gpsMeters
    : workout.reportedMeters;
}
export function pace(
  kind: Kind,
  minutes: number | null,
  meters: number | null,
): string | null {
  if (
    !["Run", "Walk", "Race"].includes(kind) ||
    minutes === null ||
    meters === null ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(meters) ||
    minutes <= 0 ||
    meters <= 0
  )
    return null;
  const seconds = Math.round((minutes * 60000) / meters);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} /km`;
}
export function completion(sessions: Session[]): number {
  const due = sessions.filter((s) => s.type !== "Rest");
  return due.length
    ? due.reduce(
        (sum, s) =>
          sum + (s.status === "Done" ? 1 : s.status === "Partial" ? 0.5 : 0),
        0,
      ) / due.length
    : 0;
}
export function automaticStatus(
  planned: number,
  actual: number,
): "Done" | "Partial" | "Short" {
  if (![planned, actual].every(Number.isFinite) || planned < 0 || actual < 0)
    return "Short";
  const ratio = planned > 0 ? actual / planned : 1;
  return ratio >= 0.85 ? "Done" : ratio >= 0.4 ? "Partial" : "Short";
}
/** Exact source identity only; ambiguous cross-source matches require user review. */
export function deduplicate(workouts: Workout[]): Workout[] {
  return [
    ...new Map(workouts.map((w) => [`${w.source}\0${w.sourceId}`, w])).values(),
  ];
}
/** Never assign one workout to more than one session; do not classify generic training as strength. */
export function matchSessions(
  sessions: Session[],
  workouts: Workout[],
): Map<string, Workout[]> {
  const used = new Set<string>();
  return new Map(
    sessions.map((session) => [
      session.id,
      workouts.filter((w) => {
        const key = `${w.source}\0${w.sourceId}`;
        const compatible =
          session.type === w.type ||
          (session.type === "Race" && w.type === "Run");
        if (
          used.has(key) ||
          !compatible ||
          localDate(new Date(w.start)) !== session.date
        )
          return false;
        used.add(key);
        return true;
      }),
    ]),
  );
}
export function readiness(metric: Metric | undefined): {
  level: string;
  text: string;
} {
  if (!metric)
    return {
      level: "No data",
      text: "Add a recovery check-in. This is a training heuristic, not medical advice.",
    };
  if (
    /chest|dizz|faint|palpitat|breathless|short of breath|sharp pain|swelling|swollen|numb|wound|bleed|fever|blackout/i.test(
      metric.notes,
    )
  )
    return {
      level: "Pause and check",
      text: "A note contains a safety keyword. Pause hard training and seek appropriate advice; this is not a diagnosis.",
    };
  const flags =
    Number(metric.sleepHours !== null && metric.sleepHours < 6) +
    Number(metric.soreness !== null && metric.soreness >= 4);
  if (flags >= 2)
    return {
      level: "Recovery day",
      text: "Two recovery flags: consider rest or an easy walk.",
    };
  if (flags === 1)
    return {
      level: "Keep it easy",
      text: "One recovery flag: consider an easier session.",
    };
  if (
    /heavy|tight|sore|niggle|tired|exhaust|pain|ache|cramp/i.test(metric.notes)
  )
    return {
      level: "Reassess",
      text: "Start gently and reassess how you feel.",
    };
  if (
    [metric.restingHr, metric.hrv, metric.sleepHours, metric.soreness].every(
      (n) => n === null,
    )
  )
    return {
      level: "No data",
      text: "Add recovery measurements before interpreting readiness.",
    };
  return {
    level: "Check-in recorded",
    text: "No configured sleep or soreness flags. Use your own judgement; HR/HRV baselines are not configured.",
  };
}

export function dueSessions(sessions: Session[], today: string): Session[] {
  return sessions.filter(
    (s) =>
      s.type !== "Rest" &&
      (s.date < today ||
        (s.date === today && ["Done", "Partial"].includes(s.status))),
  );
}
export function dailyReadiness(
  metrics: Metric[],
  today: string,
): ReturnType<typeof readiness> {
  const ago = (days: number) => {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() - days);
    return localDate(d);
  };
  const recent = metrics
    .filter((m) => m.date >= ago(3) && m.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = recent.filter((m) => m.date >= ago(1)).at(-1);
  const notes = recent.map((m) => m.notes).join(" | ");
  if (!latest && !notes) return readiness(undefined);
  return readiness({
    id: today,
    date: today,
    restingHr: null,
    hrv: null,
    sleepHours: null,
    soreness: null,
    rpe: null,
    steps: null,
    ...latest,
    notes,
  });
}

export function displayDistance(meters: number | null): string {
  return meters === null
    ? "distance missing"
    : `${(meters / 1000).toFixed(2)} km`;
}
export function totalKnownDistance(workouts: Workout[]): {
  meters: number;
  missing: number;
} {
  return workouts.reduce(
    (result, w) => {
      const meters = effectiveMeters(w);
      return {
        meters: result.meters + (meters ?? 0),
        missing: result.missing + Number(meters === null),
      };
    },
    { meters: 0, missing: 0 },
  );
}
