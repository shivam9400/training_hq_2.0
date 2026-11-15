import { z } from "zod";
const text = (max: number) => z.string().max(max);
const date = z.iso.date();
const nullableNumber = (min: number, max: number) =>
  z.number().min(min).max(max).nullable();
export const kinds = [
  "Run",
  "Walk",
  "Strength",
  "Yoga",
  "Training",
  "Rest",
  "Race",
  "Other",
] as const;
export const statuses = ["Planned", "Done", "Partial", "Skipped"] as const;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const source = z
  .object({ sourceId: digest, sourceHash: digest, version: z.literal(1) })
  .strict();
const sessionSource = source.extend({ rowId: digest }).strict();
export const activityFormats = ["FIT", "TCX", "CSV", "GPX", "KML"] as const;
const metricSource = z.enum([
  ...activityFormats,
  "FIT-samples",
  "TCX-samples",
  "CSV-samples",
  "GPX-samples",
  "KML-samples",
  "samples",
  "timestamps",
  "missing",
]);
const detailSchema = z
  .object({
    typeSource: z.enum([...activityFormats, "user", "missing"]),
    elapsedSeconds: z.number().positive().max(86400),
    reportedElapsedSeconds: nullableNumber(0, 86400),
    movingSeconds: nullableNumber(0, 86400),
    maxHr: nullableNumber(25, 250),
    calories: nullableNumber(0, 30000),
    steps: nullableNumber(0, 200000),
    cadence: nullableNumber(0, 400),
    cadenceUnit: z.enum(["rpm", "steps/min"]).nullable(),
    elevationGainMeters: nullableNumber(0, 30000),
    minElevationMeters: nullableNumber(-1000, 10000),
    maxElevationMeters: nullableNumber(-1000, 10000),
    elevationSampleCount: z.number().int().min(0).max(50000),
    hrSampleCount: z.number().int().min(0).max(50000),
    gpsSampleCount: z.number().int().min(0).max(50000),
    invalidGpsCount: z.number().int().min(0).max(50000),
    gpsSource: z.enum(activityFormats).nullable(),
    reportedByFormat: z
      .object({
        FIT: nullableNumber(0, 500000),
        TCX: nullableNumber(0, 500000),
        CSV: nullableNumber(0, 500000),
        GPX: nullableNumber(0, 500000),
        KML: nullableNumber(0, 500000),
      })
      .strict(),
    metricSources: z
      .object({
        elapsed: metricSource,
        moving: metricSource,
        distance: metricSource,
        averageHr: metricSource,
        maxHr: metricSource,
        calories: metricSource,
        steps: metricSource,
        cadence: metricSource,
        elevation: metricSource,
      })
      .strict(),
  })
  .strict()
  .refine(
    (d) => d.movingSeconds === null || d.movingSeconds <= d.elapsedSeconds + 5,
    "Moving duration exceeds elapsed duration",
  );
const provenanceSchema = z
  .object({
    version: z.literal(1),
    aliases: z.array(digest).min(1).max(8),
    formats: z.array(z.enum(activityFormats)).min(1).max(5),
    summaryHash: digest,
  })
  .strict();
export const schemas = {
  plans: z
    .object({
      id,
      title: text(120).min(1),
      startDate: date,
      endDate: date,
      importSource: source.optional(),
    })
    .strict()
    .refine((p) => p.endDate >= p.startDate, "End date precedes start date")
    .refine(
      (p) => !p.importSource || p.id === `imp_${p.importSource.sourceId}`,
      "Imported plan identity mismatch",
    ),
  sessions: z
    .object({
      id,
      planId: id,
      date,
      type: z.enum(kinds),
      title: text(120).min(1),
      minutes: z.number().min(0).max(900),
      target: text(200),
      instructions: text(4000),
      status: z.enum(statuses),
      slot: z.number().int().min(1).max(99).optional(),
      week: z.number().int().min(1).max(9999).optional(),
      phase: text(120).optional(),
      day: z.enum(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]).optional(),
      importSource: sessionSource.optional(),
      actualWorkoutId: id.nullable().optional(),
    })
    .strict()
    .refine(
      (s) => s.type !== "Run" || s.minutes > 0,
      "Run duration must be positive",
    )
    .refine(
      (s) =>
        !s.importSource ||
        (s.slot !== undefined &&
          s.week !== undefined &&
          s.phase !== undefined &&
          s.day !== undefined),
      "Imported sessions require source metadata",
    )
    .refine(
      (s) =>
        !s.importSource ||
        (s.id === `row_${s.importSource.rowId}` &&
          s.planId === `imp_${s.importSource.sourceId}`),
      "Imported row identity mismatch",
    ),
  workouts: z
    .object({
      id,
      title: text(120).min(1),
      type: z.enum(kinds),
      start: z.iso.datetime(),
      end: z.iso.datetime(),
      reportedMeters: nullableNumber(0, 500000),
      gpsMeters: nullableNumber(0, 500000),
      distanceSource: z.enum(["reported", "gps-validated", "unavailable"]),
      qualityFlags: z.array(text(80)).max(10),
      source: text(80),
      sourceId: text(200),
      averageHr: nullableNumber(25, 250),
      details: detailSchema.optional(),
      provenance: provenanceSchema.optional(),
      matchSessionId: id.nullable().optional(),
    })
    .strict()
    .refine(
      (w) => Date.parse(w.end) > Date.parse(w.start),
      "End must follow start",
    )
    .refine(
      (w) =>
        w.distanceSource !== "gps-validated" ||
        (w.gpsMeters !== null && w.qualityFlags.includes("gps-validated")),
      "GPS provenance required",
    )
    .refine(
      (w) => w.distanceSource !== "reported" || w.reportedMeters !== null,
      "Reported distance required",
    )
    .refine(
      (w) =>
        !w.provenance ||
        (w.details !== undefined &&
          w.source === "health-sync" &&
          /^[a-f0-9]{64}$/.test(w.sourceId) &&
          w.id === `act_${w.sourceId}`),
      "Imported activity identity/details mismatch",
    ),
  races: z
    .object({
      id,
      title: text(120).min(1),
      date,
      distanceKm: z.number().positive().max(500),
      goal: text(300),
    })
    .strict(),
  metrics: z
    .object({
      id,
      date,
      restingHr: nullableNumber(25, 220),
      hrv: nullableNumber(0, 300),
      sleepHours: nullableNumber(0, 24),
      soreness: nullableNumber(1, 5),
      rpe: nullableNumber(1, 10),
      steps: nullableNumber(0, 200000),
      notes: text(2000),
    })
    .strict()
    .refine((m) => m.id === m.date, "Check-in identity must match date"),
};
export type Kind = (typeof kinds)[number];
export type PlanRecord = z.infer<typeof schemas.plans>;
export type Session = z.infer<typeof schemas.sessions>;
export type Workout = z.infer<typeof schemas.workouts>;
export type Metric = z.infer<typeof schemas.metrics>;
export type Collection = keyof typeof schemas;
export type Records = { [K in Collection]: z.infer<(typeof schemas)[K]>[] };
export const collections = Object.keys(schemas) as Collection[];
export const emptyRecords = (): Records => ({
  plans: [],
  sessions: [],
  workouts: [],
  races: [],
  metrics: [],
});
export type Row =
  | Session
  | Workout
  | Metric
  | z.infer<typeof schemas.plans>
  | z.infer<typeof schemas.races>;
export function validateRow(collection: Collection, row: unknown): Row {
  return schemas[collection].parse(row);
}
