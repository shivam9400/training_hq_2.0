import { z } from 'zod';
const text = (max: number) => z.string().max(max);
const date = z.iso.date();
const nullableNumber = (min: number, max: number) => z.number().min(min).max(max).nullable();
export const kinds = ['Run', 'Walk', 'Strength', 'Yoga', 'Training', 'Rest', 'Race', 'Other'] as const;
export const statuses = ['Planned', 'Done', 'Partial', 'Skipped'] as const;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
export const schemas = {
  plans: z.object({ id, title: text(120).min(1), startDate: date, endDate: date }).strict().refine(p => p.endDate >= p.startDate, 'End date precedes start date'),
  sessions: z.object({ id, planId: id, date, type: z.enum(kinds), title: text(120).min(1), minutes: z.number().min(0).max(900), target: text(200), instructions: text(4000), status: z.enum(statuses) }).strict().refine(s => !['Run', 'Race'].includes(s.type) || s.minutes > 0, 'Run/race duration must be positive'),
  workouts: z.object({ id, title: text(120).min(1), type: z.enum(kinds), start: z.iso.datetime(), end: z.iso.datetime(), reportedMeters: nullableNumber(0, 500000), gpsMeters: nullableNumber(0, 500000), distanceSource: z.enum(['reported', 'gps-validated', 'unavailable']), qualityFlags: z.array(text(80)).max(10), source: text(80), sourceId: text(200), averageHr: nullableNumber(25, 250) }).strict().refine(w => Date.parse(w.end) > Date.parse(w.start), 'End must follow start').refine(w => w.distanceSource !== 'gps-validated' || (w.gpsMeters !== null && w.qualityFlags.includes('gps-validated')), 'GPS provenance required').refine(w => w.distanceSource !== 'reported' || w.reportedMeters !== null, 'Reported distance required'),
  races: z.object({ id, title: text(120).min(1), date, distanceKm: z.number().positive().max(500), goal: text(300) }).strict(),
  metrics: z.object({ id, date, restingHr: nullableNumber(25, 220), hrv: nullableNumber(0, 300), sleepHours: nullableNumber(0, 24), soreness: nullableNumber(1, 5), rpe: nullableNumber(1, 10), steps: nullableNumber(0, 200000), notes: text(2000) }).strict().refine(m => m.id === m.date, 'Check-in identity must match date'),
};
export type Kind = typeof kinds[number];
export type Session = z.infer<typeof schemas.sessions>;
export type Workout = z.infer<typeof schemas.workouts>;
export type Metric = z.infer<typeof schemas.metrics>;
export type Collection = keyof typeof schemas;
export type Records = { [K in Collection]: z.infer<typeof schemas[K]>[] };
export const collections = Object.keys(schemas) as Collection[];
export const emptyRecords = (): Records => ({ plans: [], sessions: [], workouts: [], races: [], metrics: [] });
export type Row = Session | Workout | Metric | z.infer<typeof schemas.plans> | z.infer<typeof schemas.races>;
export function validateRow(collection: Collection, row: unknown): Row { return schemas[collection].parse(row); }
