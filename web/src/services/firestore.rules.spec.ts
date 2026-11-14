import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, limit, query, setDoc, updateDoc } from 'firebase/firestore';
let env: RulesTestEnvironment;
const fixtures = {
  plans: { id: 'record', title: 'Synthetic plan', startDate: '2026-01-01', endDate: '2026-01-31' },
  sessions: { id: 'record', planId: 'plan', date: '2026-01-01', type: 'Run', title: 'Synthetic run', minutes: 30, target: '', instructions: '', status: 'Planned' },
  workouts: { id: 'record', title: 'Synthetic training', type: 'Training', start: '2026-01-01T00:00:00Z', end: '2026-01-01T00:30:00Z', reportedMeters: null, gpsMeters: null, distanceSource: 'unavailable', qualityFlags: ['no-distance'], source: 'fixture', sourceId: 'fixture', averageHr: null },
  races: { id: 'record', title: 'Synthetic race', date: '2026-01-01', distanceKm: 10, goal: '' },
  metrics: { id: '2026-01-01', date: '2026-01-01', restingHr: null, hrv: null, sleepHours: 7, soreness: 2, rpe: null, steps: null, notes: '' },
};
beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Tests must use the local Firestore emulator');
  env = await initializeTestEnvironment({ projectId: 'demo-training-hq', firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('../firestore.rules', 'utf8') } });
});
beforeEach(async () => { await env.clearFirestore(); });
afterAll(async () => { if (env) await env.cleanup(); });
for (const [name, data] of Object.entries(fixtures)) {
  describe(`owner isolation: ${name}`, () => {
    it('permits owner CRUD, rejects A reading/creating/updating/deleting B records and forged UID fields', async () => {
      const a = env.authenticatedContext('user-a').firestore(), b = env.authenticatedContext('user-b').firestore();
      const refB = doc(b, 'users/user-b', name, data.id), refAtoB = doc(a, 'users/user-b', name, data.id);
      await assertSucceeds(setDoc(refB, data)); await assertSucceeds(getDoc(refB));
      await assertFails(getDoc(refAtoB)); await assertFails(updateDoc(refAtoB, data)); await assertFails(deleteDoc(refAtoB));
      await assertSucceeds(deleteDoc(refB)); await assertFails(setDoc(refAtoB, data));
      const refA = doc(a, 'users/user-a', name, data.id);
      await assertSucceeds(setDoc(refA, data)); await assertSucceeds(updateDoc(refA, data));
      await assertFails(setDoc(refA, { ...data, uid: 'user-b' }));
      await assertFails(setDoc(refA, { ...data, unexpected: true }));
      await assertFails(setDoc(refA, { id: data.id }));
      await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users/user-a', name, data.id)));
      await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'users/user-a', name, data.id), data));
      const refBtoA = doc(b, 'users/user-a', name, data.id);
      await assertFails(getDoc(refBtoA)); await assertFails(updateDoc(refBtoA, data)); await assertFails(deleteDoc(refBtoA));
      await assertSucceeds(deleteDoc(refA)); await assertFails(setDoc(refBtoA, data));
    });
  });
}
it('denies collection-group access, foreign lists, parent profiles, unknown and nested collections', async () => {
  const a = env.authenticatedContext('user-a').firestore();
  await assertFails(getDocs(query(collectionGroup(a, 'sessions'), limit(200))));
  await assertFails(getDocs(query(collection(a, 'users/user-b/sessions'), limit(200))));
  await assertFails(setDoc(doc(a, 'users/user-a'), { name: 'forbidden' }));
  await assertFails(setDoc(doc(a, 'users/user-a/secrets/key'), { value: 'synthetic' }));
  await assertFails(setDoc(doc(a, 'users/user-a/plans/record/hidden/record'), fixtures.plans));
});
it('validates bounds, status, identity, types, timestamps, GPS provenance and field removal', async () => {
  const a = env.authenticatedContext('user-a').firestore();
  const session = doc(a, 'users/user-a/sessions/record');
  for (const patch of [{ minutes: -1 }, { minutes: 901 }, { minutes: '30' }, { type: 'invented' }, { status: 'unknown' }, { id: 'other' }, { date: 'not-a-date' }, { title: '' }, { minutes: 0 }]) await assertFails(setDoc(session, { ...fixtures.sessions, ...patch }));
  for (const patch of [{ end: 'invalid' }, { end: fixtures.workouts.start }, { reportedMeters: -1 }, { distanceSource: 'gps-validated' }, { qualityFlags: ['unknown'] }]) await assertFails(setDoc(doc(a, 'users/user-a/workouts/record'), { ...fixtures.workouts, ...patch }));
  await assertFails(setDoc(doc(a, 'users/user-a/metrics/2026-01-01'), { ...fixtures.metrics, sleepHours: 25 }));
  await assertFails(setDoc(doc(a, 'users/user-a/races/record'), { ...fixtures.races, distanceKm: 0 }));
  await assertFails(setDoc(doc(a, 'users/user-a/plans/record'), { ...fixtures.plans, startDate: '2026-12-01' }));
  await assertSucceeds(getDocs(query(collection(a, 'users/user-a/sessions'), limit(200))));
});
