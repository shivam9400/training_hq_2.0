export interface Point {
  seconds: number;
  latitude: number;
  longitude: number;
  segment?: number;
}
export interface DistanceResult {
  reportedMeters: number | null;
  gpsMeters: number | null;
  source: "reported" | "gps-validated" | "unavailable";
  flags: string[];
}
const radians = (n: number) => (n * Math.PI) / 180;
function segment(a: Point, b: Point): number {
  const p =
    Math.sin(radians(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(radians(b.longitude - a.longitude) / 2) ** 2;
  return 12742000 * Math.atan2(Math.sqrt(p), Math.sqrt(Math.max(0, 1 - p)));
}
/** Pure local import calculation; no GPS access or route persistence. */
export function validateDistance(
  reportedMeters: number | null,
  durationSeconds: number,
  kind: "Run" | "Walk" | "Other",
  points: Point[],
): DistanceResult {
  const initial: DistanceResult = {
    reportedMeters,
    gpsMeters: null,
    source: reportedMeters === null ? "unavailable" : "reported",
    flags: [],
  };
  if (
    kind === "Other" ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  )
    return initial;
  const validPoints = points.filter(
    (p) =>
      [p.seconds, p.latitude, p.longitude].every(Number.isFinite) &&
      Math.abs(p.latitude) <= 90 &&
      Math.abs(p.longitude) <= 180 &&
      !(p.latitude === 0 && p.longitude === 0) &&
      p.seconds >= 0 &&
      p.seconds <= durationSeconds + 2,
  );
  const outOfOrder = validPoints.some(
    (p, i) =>
      i > 0 &&
      (p.segment ?? 0) === (validPoints[i - 1].segment ?? 0) &&
      p.seconds < validPoints[i - 1].seconds,
  );
  const byTime = new Map<number, Point>();
  let conflictingDuplicates = false;
  for (const p of validPoints) {
    const old = byTime.get(p.seconds);
    if (
      old &&
      (Math.abs(old.latitude - p.latitude) > 0.000001 ||
        Math.abs(old.longitude - p.longitude) > 0.000001)
    )
      conflictingDuplicates = true;
    else byTime.set(p.seconds, p);
  }
  const seen = new Set<number>();
  const fixes = [...validPoints]
    .sort((a, b) => a.seconds - b.seconds)
    .filter((p) => {
      if (seen.has(p.seconds)) return false;
      seen.add(p.seconds);
      return true;
    });
  let accepted = 0,
    jumps = 0,
    covered = 0,
    meters = 0;
  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[i - 1],
      b = fixes[i],
      dt = b.seconds - a.seconds;
    if (dt <= 0 || (a.segment ?? 0) !== (b.segment ?? 0)) continue;
    const distance = segment(a, b);
    if (
      dt > 60 ||
      distance > 1000 ||
      distance / dt > (kind === "Walk" ? 4.5 : 9)
    ) {
      jumps++;
      continue;
    }
    accepted++;
    covered += dt;
    meters += distance;
  }
  initial.gpsMeters = fixes.length >= 20 ? Math.round(meters) : null;
  const coverage = covered / durationSeconds;
  if (
    outOfOrder ||
    conflictingDuplicates ||
    accepted < 20 ||
    coverage < 0.9 ||
    coverage > 1.01 ||
    jumps > fixes.length * 0.1 ||
    meters < 200 ||
    meters > 200000
  )
    return { ...initial, flags: ["gps-unreliable"] };
  if (
    reportedMeters === null ||
    reportedMeters === 0 ||
    Math.abs(reportedMeters - meters) / reportedMeters > 0.1
  )
    return {
      ...initial,
      source: "gps-validated",
      flags: ["gps-validated", "distance-mismatch"],
    };
  return { ...initial, flags: ["gps-validated"] };
}
