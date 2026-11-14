import { describe, expect, it } from 'vitest';
import { automaticStatus, completion, deduplicate, durationMinutes, effectiveMeters, matchSessions, normalizeKind, pace, readiness, dailyReadiness, dueSessions } from './calculations';
import { demoRecords } from './demo';
import { schemas } from '../types/data';
import { validateDistance } from './gps';

describe('workout calculations (synthetic data only)', () => {
  it('formats running and walking pace, carrying rounded seconds', () => {
    expect(pace('Run', 30, 5000)).toBe('6:00 /km');
    expect(pace('Walk', 30, 2500)).toBe('12:00 /km');
    expect(pace('Run', 5.999, 1000)).toBe('6:00 /km');
  });
  it('rejects invalid pace and does not invent non-GPS distance', () => {
    for (const meters of [null, 0, -1, NaN, Infinity]) expect(pace('Run', 30, meters)).toBeNull();
    for (const type of ['Strength', 'Yoga', 'Training'] as const) expect(pace(type, 30, null)).toBeNull();
    expect(durationMinutes({ start: 'invalid', end: 'invalid' })).toBeNull();
    expect(durationMinutes({ start: '2026-01-01T00:00:00Z', end: '2026-01-01T00:00:00Z' })).toBeNull();
  });
  it('keeps generic TRAINING distinct from strength/yoga', () => {
    expect(normalizeKind('TRAINING')).toBe('Training'); expect(normalizeKind('weight training')).toBe('Strength'); expect(normalizeKind('yoga')).toBe('Yoga'); expect(normalizeKind('walking')).toBe('Walk');
  });
  it('deduplicates source IDs without merging equal-duration activities or sources', () => {
    const w = demoRecords().workouts[0];
    expect(deduplicate([w, w, { ...w, sourceId: 'distinct' }, { ...w, source: 'another' }])).toHaveLength(3);
  });
  it('keeps raw and GPS distances separate', () => {
    const w = { ...demoRecords().workouts[0], gpsMeters: 3000 };
    expect(effectiveMeters(w)).toBe(2500); expect(w.gpsMeters).toBe(3000);
    expect(effectiveMeters({ ...w, distanceSource: 'gps-validated' })).toBe(3000);
  });
});
describe('plan and recovery rules', () => {
  it('preserves duration thresholds', () => { expect(automaticStatus(100, 85)).toBe('Done'); expect(automaticStatus(100, 40)).toBe('Partial'); expect(automaticStatus(100, 39)).toBe('Short'); });
  it('weights partial completion and excludes rest', () => {
    const s = demoRecords().sessions[0];
    expect(completion([{ ...s, status: 'Done' }, { ...s, status: 'Partial' }, { ...s, type: 'Rest' }])).toBe(0.75); expect(completion([])).toBe(0);
  });
  it('does not assign a workout twice across same-day slots or match TRAINING to strength', () => {
    const data = demoRecords(), s = data.sessions[0], w = { ...data.workouts[0], type: 'Run' as const };
    const matches = matchSessions([s, { ...s, id: 'slot2' }, data.sessions[1]], [w, { ...w, type: 'Training', sourceId: 'training' }]);
    expect(matches.get(s.id)).toHaveLength(1); expect(matches.get('slot2')).toHaveLength(0); expect(matches.get(data.sessions[1].id)).toHaveLength(0);
  });
  it('requires actual measurements and gives safety notes precedence', () => {
    const m = demoRecords().metrics[0];
    expect(readiness(undefined).level).toBe('No data');
    expect(readiness({ ...m, sleepHours: 5, soreness: 5 }).level).toBe('Recovery day');
    expect(readiness({ ...m, notes: 'synthetic sharp pain example' }).level).toBe('Pause and check');
    expect(readiness({ ...m, restingHr: null, hrv: null, sleepHours: null, soreness: null }).level).toBe('No data');
  });
  it('does not penalize pending sessions today and considers recent safety notes', () => {
    const s = demoRecords().sessions[0], m = demoRecords().metrics[0];
    expect(dueSessions([{ ...s, date: '2026-01-04' }, { ...s, date: '2026-01-03' }], '2026-01-04')).toHaveLength(1);
    expect(dailyReadiness([{ ...m, date: '2026-01-02', notes: 'synthetic sharp pain' }, { ...m, date: '2026-01-04' }], '2026-01-04').level).toBe('Pause and check');
    expect(dailyReadiness([{ ...m, date: '2025-12-01', notes: 'old sharp pain' }], '2026-01-04').level).toBe('No data');
  });
  it('rejects unknown fields and invalid records', () => {
    const s = demoRecords().sessions[0]; expect(schemas.sessions.safeParse({ ...s, minutes: 0 }).success).toBe(false); expect(schemas.sessions.safeParse({ ...s, uid: 'forged' }).success).toBe(false);
    expect(schemas.sessions.safeParse({ ...s, minutes: -1 }).success).toBe(false);
    expect(schemas.metrics.safeParse({ ...demoRecords().metrics[0], sleepHours: 25 }).success).toBe(false);
  });
});
describe('future import GPS validation', () => {
  const fixes = Array.from({ length: 31 }, (_, i) => ({ seconds: i * 10, latitude: 1, longitude: 1 + i * 0.0001 }));
  it('preserves reported values while accepting a reliable synthetic track', () => {
    const result = validateDistance(100, 300, 'Walk', fixes);
    expect(result.reportedMeters).toBe(100); expect(result.gpsMeters).toBeGreaterThan(300); expect(result.source).toBe('gps-validated');
  });
  it('keeps summaries with sparse, invalid, jumping or non-running tracks', () => {
    expect(validateDistance(100, 300, 'Walk', fixes.slice(0, 5)).source).toBe('reported');
    expect(validateDistance(100, 300, 'Walk', fixes.map(p => ({ ...p, latitude: 999 }))).flags).toContain('gps-unreliable');
    expect(validateDistance(100, 6000, 'Run', fixes).source).toBe('reported');
    expect(validateDistance(100, 300, 'Other', fixes).gpsMeters).toBeNull();
    expect(validateDistance(100, 300, 'Run', fixes.map((p, i) => ({ ...p, longitude: i % 2 ? 5 : 1 }))).source).toBe('reported');
  });
});
