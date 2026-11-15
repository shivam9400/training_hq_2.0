import { schemas, type Workout } from "../../types/data";
import { hash } from "../planImport";
import { validateDistance } from "../gps";
import { mean, type Candidate, type RawActivity } from "./model";
export function summaryContent(w: Workout): object {
  const {
    id: _id,
    provenance: _p,
    matchSessionId: _m,
    sourceId: _sourceId,
    ...fields
  } = w;
  void _id;
  void _p;
  void _m;
  void _sourceId;
  return fields;
}
export async function normalizeActivity(a: RawActivity): Promise<Candidate> {
  const duration = (a.end - a.start) / 1000;
  const sampleTimes = new Set<number>();
  const samples = a.hrSamples.filter((s) => {
    if (s.time < a.start || s.time > a.end || sampleTimes.has(s.time))
      return false;
    sampleTimes.add(s.time);
    return true;
  });
  const averageHr = a.averageHr ?? mean(samples),
    maxHr =
      a.maxHr ??
      (samples.length ? Math.max(...samples.map((s) => s.value)) : null);
  const distance = a.fixes.length
    ? validateDistance(
        a.reportedMeters,
        duration,
        a.kind === "Walk"
          ? "Walk"
          : ["Run", "Race"].includes(a.kind)
            ? "Run"
            : "Other",
        a.fixes.map((f) => ({
          seconds: (f.time - a.start) / 1000,
          latitude: f.latitude,
          longitude: f.longitude,
          segment: f.segment,
        })),
      )
    : {
        reportedMeters: a.reportedMeters,
        gpsMeters: null,
        source:
          a.reportedMeters === null
            ? ("unavailable" as const)
            : ("reported" as const),
        flags: [] as string[],
      };
  const invalid = a.fixes.filter(
    (p) =>
      ![p.time, p.latitude, p.longitude].every(Number.isFinite) ||
      Math.abs(p.latitude) > 90 ||
      Math.abs(p.longitude) > 180 ||
      (p.latitude === 0 && p.longitude === 0),
  ).length;
  const sourceId = await hash([
    "health-sync-v1",
    a.format,
    a.nativeId ?? null,
    a.kind,
    a.start,
    a.end,
  ]);
  const alias = await hash([
    "health-sync-alias-v1",
    a.format,
    a.nativeId ?? null,
    a.kind,
    a.start,
    a.nativeId ? null : a.end,
  ]);
  const notes = [...new Set(a.notes)];
  if (invalid) notes.push("Invalid/sentinel GPS fixes were excluded.");
  if (distance.flags.includes("gps-unreliable"))
    notes.push(
      "GPS failed reliability/coverage checks; source distance retained.",
    );
  if (distance.flags.includes("distance-mismatch"))
    notes.push(
      "Source and validated GPS distance disagree; both values are retained.",
    );
  if (!a.fixes.length)
    notes.push("GPS absent; this can still be a valid non-GPS workout.");
  if (averageHr === null) notes.push("Heart rate missing.");
  if (a.movingSeconds === null)
    notes.push("Moving duration missing; elapsed duration is used for pace.");
  if (a.kind === "Other")
    notes.push("Activity type missing/unsupported; no subtype inferred.");
  const flags = [...distance.flags];
  if (
    a.reportedElapsedSeconds !== null &&
    Math.abs(a.reportedElapsedSeconds - duration) > 5
  ) {
    notes.push(
      "Reported elapsed duration conflicts with timestamps; both are retained and timestamp duration is displayed.",
    );
    flags.push("source-conflict");
  }
  if (averageHr !== null && maxHr !== null && averageHr > maxHr) {
    notes.push(
      "Source average HR exceeds maximum HR; review the source values.",
    );
    flags.push("source-conflict");
  }
  if (a.reportedMeters !== null) flags.push("unvalidated-summary");
  if (a.reportedMeters === null && distance.source !== "gps-validated")
    flags.push("no-distance");
  const elevations = a.elevationSamples
    .filter((s) => s.time >= a.start && s.time <= a.end)
    .map((s) => s.value);
  const metric = (key: string, present: boolean) =>
    present
      ? a.derived.includes(key)
        ? (`${a.format}-samples` as const)
        : a.format
      : ("missing" as const);
  const workout = schemas.workouts.parse({
    id: `act_${sourceId}`,
    title: a.title,
    type: a.kind,
    start: new Date(a.start).toISOString(),
    end: new Date(a.end).toISOString(),
    reportedMeters: a.reportedMeters,
    gpsMeters: distance.gpsMeters,
    distanceSource: distance.source,
    qualityFlags: [...new Set(flags)],
    source: "health-sync",
    sourceId,
    averageHr,
    details: {
      typeSource: a.userType
        ? "user"
        : a.kind === "Other"
          ? "missing"
          : a.format,
      elapsedSeconds: duration,
      reportedElapsedSeconds: a.reportedElapsedSeconds,
      movingSeconds: a.movingSeconds,
      maxHr,
      calories: a.calories,
      steps: a.steps,
      cadence: a.cadence,
      cadenceUnit: a.cadenceUnit,
      elevationGainMeters: a.elevationGainMeters,
      minElevationMeters: elevations.length ? Math.min(...elevations) : null,
      maxElevationMeters: elevations.length ? Math.max(...elevations) : null,
      elevationSampleCount: elevations.length,
      hrSampleCount: samples.length,
      gpsSampleCount: a.fixes.length,
      invalidGpsCount: invalid,
      gpsSource: a.fixes.length ? a.format : null,
      reportedByFormat: {
        FIT: null,
        TCX: null,
        CSV: null,
        GPX: null,
        KML: null,
        [a.format]: a.reportedMeters,
      },
      metricSources: {
        elapsed: a.reportedElapsedSeconds === null ? "timestamps" : a.format,
        moving: metric("moving", a.movingSeconds !== null),
        distance: metric("distance", a.reportedMeters !== null),
        averageHr:
          a.averageHr !== null
            ? a.format
            : samples.length
              ? (`${a.format}-samples` as const)
              : "missing",
        maxHr:
          a.maxHr !== null
            ? a.format
            : samples.length
              ? (`${a.format}-samples` as const)
              : "missing",
        calories: metric("calories", a.calories !== null),
        steps: metric("steps", a.steps !== null),
        cadence: metric("cadence", a.cadence !== null),
        elevation: metric("elevation", a.elevationGainMeters !== null),
      },
    },
  });
  workout.provenance = {
    version: 1,
    aliases: [alias],
    formats: [a.format],
    summaryHash: await hash(summaryContent(workout)),
  };
  return { workout, notes };
}
