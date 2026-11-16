import type { Kind, Workout } from "../../types/data";
export const FORMATS = ["FIT", "TCX", "CSV", "GPX", "KML"] as const;
export type Format = (typeof FORMATS)[number];
export interface Sample {
  time: number;
  value: number;
}
export interface Fix {
  time: number;
  latitude: number;
  longitude: number;
  segment: number;
}
export interface RawActivity {
  format: Format;
  fileHash: string;
  nativeId: string | null;
  userType: boolean;
  kind: Kind;
  title: string;
  start: number;
  end: number;
  reportedElapsedSeconds: number | null;
  movingSeconds: number | null;
  reportedMeters: number | null;
  averageHr: number | null;
  maxHr: number | null;
  calories: number | null;
  steps: number | null;
  cadence: number | null;
  cadenceUnit: "rpm" | "steps/min" | null;
  elevationGainMeters: number | null;
  fixes: Fix[];
  hrSamples: Sample[];
  elevationSamples: Sample[];
  derived: string[];
  notes: string[];
}
export interface ParsedFiles {
  activities: Candidate[];
  notices: string[];
  rejected: number;
  inspected: number;
}
export interface Candidate {
  workout: Workout;
  notes: string[];
}
export interface InputFile {
  name: string;
  bytes: Uint8Array;
}
export const LIMITS = {
  file: 8 * 1024 * 1024,
  zip: 20 * 1024 * 1024,
  expanded: 40 * 1024 * 1024,
  entries: 250,
  ratio: 150,
  samples: 50000,
  activities: 200,
  xmlTags: 250000,
  depth: 40,
  timeoutMs: 45000,
};
export function number(value: unknown, min = 0, max = 1e9): number | null {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    typeof value === "boolean" ||
    typeof value === "object"
  )
    return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
export function timestamp(value: unknown, offset = ""): number | null {
  if (value instanceof Date)
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value !== "string") return null;
  let s = value
    .trim()
    .replace(/^(\d{4})[./](\d{2})[./](\d{2})/, "$1-$2-$3")
    .replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
  if (!/(Z|[+-]\d\d:\d\d)$/i.test(s)) {
    if (!/^[+-](0\d|1[0-4]):[0-5]\d$/.test(offset) || !/T\d\d:\d\d/.test(s))
      return null;
    s += offset;
  }
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/i.test(
      s,
    )
  )
    return null;
  const date = s.slice(0, 10),
    d = new Date(`${date}T00:00:00Z`);
  if (
    !Number.isFinite(d.getTime()) ||
    d.toISOString().slice(0, 10) !== date ||
    Number(s.slice(11, 13)) > 23 ||
    Number(s.slice(14, 16)) > 59 ||
    (s[16] === ":" && Number(s.slice(17, 19)) > 59)
  )
    return null;
  const time = Date.parse(s);
  return Number.isFinite(time) ? time : null;
}
export const mean = (samples: Sample[]) =>
  samples.length
    ? samples.reduce((sum, s) => sum + s.value, 0) / samples.length
    : null;
export function raw(
  format: Format,
  fileHash: string,
  start: number,
  end: number,
  kind: Kind,
  title?: string,
): RawActivity {
  return {
    format,
    fileHash,
    start,
    end,
    kind,
    title: title || `Untitled ${kind} workout`,
    nativeId: null,
    userType: false,
    reportedElapsedSeconds: null,
    movingSeconds: null,
    reportedMeters: null,
    averageHr: null,
    maxHr: null,
    calories: null,
    steps: null,
    cadence: null,
    cadenceUnit: null,
    elevationGainMeters: null,
    fixes: [],
    hrSamples: [],
    elevationSamples: [],
    derived: [],
    notes: title ? [] : ["Title missing; a descriptive display label is used."],
  };
}
export function validateRaw(activity: RawActivity): void {
  if (
    ![activity.start, activity.end].every(Number.isFinite) ||
    activity.end <= activity.start ||
    activity.end - activity.start > 86400000 ||
    activity.title.length > 120
  )
    throw new Error("Invalid or incomplete workout timestamps/duration/title.");
  if (
    activity.hrSamples.length > LIMITS.samples ||
    activity.fixes.length > LIMITS.samples
  )
    throw new Error("Sample limit exceeded.");
}
