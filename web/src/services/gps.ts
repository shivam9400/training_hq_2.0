export interface Point {
  seconds: number;
  latitude: number;
  longitude: number;
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
/** Pure future-import primitive. No GPS access, file upload or route persistence. */
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
  const fixes = points
    .filter(
      (p) =>
        [p.seconds, p.latitude, p.longitude].every(Number.isFinite) &&
        Math.abs(p.latitude) <= 90 &&
        Math.abs(p.longitude) <= 180 &&
        !(p.latitude === 0 && p.longitude === 0) &&
        p.seconds >= 0 &&
        p.seconds <= durationSeconds * 1.2,
    )
    .sort((a, b) => a.seconds - b.seconds);
  let accepted = 0,
    jumps = 0,
    covered = 0,
    meters = 0;
  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[i - 1],
      b = fixes[i],
      dt = b.seconds - a.seconds;
    if (dt <= 0) continue;
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
    accepted < 20 ||
    coverage < 0.7 ||
    coverage > 1.2 ||
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
  return initial;
}
