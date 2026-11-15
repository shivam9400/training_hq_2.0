import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
let env: RulesTestEnvironment;
const fixtures = {
  plans: {
    id: "record",
    title: "Synthetic plan",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
  },
  sessions: {
    id: "record",
    planId: "plan",
    date: "2026-01-01",
    type: "Run",
    title: "Synthetic run",
    minutes: 30,
    target: "",
    instructions: "",
    status: "Planned",
  },
  workouts: {
    id: "record",
    title: "Synthetic training",
    type: "Training",
    start: "2026-01-01T00:00:00Z",
    end: "2026-01-01T00:30:00Z",
    reportedMeters: null,
    gpsMeters: null,
    distanceSource: "unavailable",
    qualityFlags: ["no-distance"],
    source: "fixture",
    sourceId: "fixture",
    averageHr: null,
  },
  races: {
    id: "record",
    title: "Synthetic race",
    date: "2026-01-01",
    distanceKm: 10,
    goal: "",
  },
  metrics: {
    id: "2026-01-01",
    date: "2026-01-01",
    restingHr: null,
    hrv: null,
    sleepHours: 7,
    soreness: 2,
    rpe: null,
    steps: null,
    notes: "",
  },
};
beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080")
    throw new Error("Tests must use the local Firestore emulator");
  env = await initializeTestEnvironment({
    projectId: "demo-training-hq",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync("../firestore.rules", "utf8"),
    },
  });
});
beforeEach(async () => {
  await env.clearFirestore();
});
afterAll(async () => {
  if (env) await env.cleanup();
});
for (const [name, data] of Object.entries(fixtures)) {
  describe(`owner isolation: ${name}`, () => {
    it("permits owner CRUD, rejects A reading/creating/updating/deleting B records and forged UID fields", async () => {
      const a = env.authenticatedContext("user-a").firestore(),
        b = env.authenticatedContext("user-b").firestore();
      const refB = doc(b, "users/user-b", name, data.id),
        refAtoB = doc(a, "users/user-b", name, data.id);
      await assertSucceeds(setDoc(refB, data));
      await assertSucceeds(getDoc(refB));
      await assertFails(getDoc(refAtoB));
      await assertFails(updateDoc(refAtoB, data));
      await assertFails(deleteDoc(refAtoB));
      await assertSucceeds(deleteDoc(refB));
      await assertFails(setDoc(refAtoB, data));
      const refA = doc(a, "users/user-a", name, data.id);
      await assertSucceeds(setDoc(refA, data));
      await assertSucceeds(updateDoc(refA, data));
      await assertFails(setDoc(refA, { ...data, uid: "user-b" }));
      await assertFails(setDoc(refA, { ...data, unexpected: true }));
      await assertFails(setDoc(refA, { id: data.id }));
      await assertFails(
        getDoc(
          doc(
            env.unauthenticatedContext().firestore(),
            "users/user-a",
            name,
            data.id,
          ),
        ),
      );
      await assertFails(
        setDoc(
          doc(
            env.unauthenticatedContext().firestore(),
            "users/user-a",
            name,
            data.id,
          ),
          data,
        ),
      );
      const refBtoA = doc(b, "users/user-a", name, data.id);
      await assertFails(getDoc(refBtoA));
      await assertFails(updateDoc(refBtoA, data));
      await assertFails(deleteDoc(refBtoA));
      await assertSucceeds(deleteDoc(refA));
      await assertFails(setDoc(refBtoA, data));
    });
  });
}
it("denies collection-group access, foreign lists, parent profiles, unknown and nested collections", async () => {
  const a = env.authenticatedContext("user-a").firestore();
  await assertFails(getDocs(query(collectionGroup(a, "sessions"), limit(200))));
  await assertFails(
    getDocs(query(collection(a, "users/user-b/sessions"), limit(200))),
  );
  await assertFails(setDoc(doc(a, "users/user-a"), { name: "forbidden" }));
  await assertFails(
    setDoc(doc(a, "users/user-a/secrets/key"), { value: "synthetic" }),
  );
  await assertFails(
    setDoc(doc(a, "users/user-a/plans/record/hidden/record"), fixtures.plans),
  );
});
it("validates bounds, status, identity, types, timestamps, GPS provenance and field removal", async () => {
  const a = env.authenticatedContext("user-a").firestore();
  const session = doc(a, "users/user-a/sessions/record");
  for (const patch of [
    { minutes: -1 },
    { minutes: 901 },
    { minutes: "30" },
    { type: "invented" },
    { status: "unknown" },
    { id: "other" },
    { date: "not-a-date" },
    { title: "" },
    { minutes: 0 },
  ])
    await assertFails(setDoc(session, { ...fixtures.sessions, ...patch }));
  for (const patch of [
    { end: "invalid" },
    { end: fixtures.workouts.start },
    { reportedMeters: -1 },
    { distanceSource: "gps-validated" },
    { qualityFlags: ["unknown"] },
  ])
    await assertFails(
      setDoc(doc(a, "users/user-a/workouts/record"), {
        ...fixtures.workouts,
        ...patch,
      }),
    );
  await assertFails(
    setDoc(doc(a, "users/user-a/metrics/2026-01-01"), {
      ...fixtures.metrics,
      sleepHours: 25,
    }),
  );
  await assertFails(
    setDoc(doc(a, "users/user-a/races/record"), {
      ...fixtures.races,
      distanceKm: 0,
    }),
  );
  await assertFails(
    setDoc(doc(a, "users/user-a/plans/record"), {
      ...fixtures.plans,
      startDate: "2026-12-01",
    }),
  );
  await assertSucceeds(
    getDocs(query(collection(a, "users/user-a/sessions"), limit(200))),
  );
});

// Import execution uses the real authenticated emulator SDK, not a mocked database.
import { expect } from "vitest";
import type { Firestore } from "firebase/firestore";
import { executeImport, ImportCancelled, ImportStale } from "./importExecution";
import { makePreview, syntheticCsv } from "./importFixtures";
import { previewImport, parsePlanCsv } from "./planImport";
import { schemas } from "../types/data";
const modular = (uid: string) =>
  env.authenticatedContext(uid).firestore() as unknown as Firestore;
it("imports 69 synthetic rows with source metadata, zero Rest/Race durations and retry-safe identities", async () => {
  const a = modular("user-a");
  const preview = await makePreview(
    syntheticCsv(69),
    [],
    [],
    "create",
    "user-a",
  );
  await executeImport(a, "user-a", preview, { assertOwner: () => {} });
  const imported = await getDocs(
    query(collection(a, "users/user-a/sessions"), limit(200)),
  );
  expect(imported.size).toBe(69);
  const rows = imported.docs.map((snapshot) =>
    schemas.sessions.parse(snapshot.data()),
  );
  expect(rows.some((row) => row.type === "Race" && row.minutes === 0)).toBe(
    true,
  );
  expect(
    rows.every(
      (row) =>
        row.slot !== undefined &&
        row.week !== undefined &&
        row.phase === "Synthetic phase",
    ),
  ).toBe(true);
  const retry = await executeImport(a, "user-a", preview, {
    assertOwner: () => {},
  });
  expect(retry.written).toBe(0);
  expect(
    (await getDocs(query(collection(a, "users/user-a/plans"), limit(200))))
      .size,
  ).toBe(1);
  expect(
    (await getDocs(query(collection(a, "users/user-a/sessions"), limit(200))))
      .size,
  ).toBe(69);
});
it("rejects cross-user imported plan/session CRUD and malformed optional metadata while old records still work", async () => {
  const a = modular("user-a"),
    b = modular("user-b");
  const previewB = await makePreview(
    syntheticCsv(2),
    [],
    [],
    "create",
    "user-b",
  );
  await assertFails(
    executeImport(a, "user-b", previewB, { assertOwner: () => {} }),
  );
  await executeImport(b, "user-b", previewB, { assertOwner: () => {} });
  for (const [name, incoming] of [
    ["plans", previewB.plan],
    ["sessions", previewB.rows[0].incoming],
  ] as const) {
    const ref = doc(a, "users/user-b", name, incoming.id);
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, incoming));
    await assertFails(updateDoc(ref, incoming));
    await assertFails(deleteDoc(ref));
  }
  const own = await makePreview(syntheticCsv(1), [], [], "create", "user-a");
  const row = own.rows[0].incoming,
    ref = doc(a, "users/user-a/sessions", row.id);
  for (const patch of [
    { slot: 0 },
    { slot: 1.5 },
    { week: -1 },
    { day: "Wrong" },
    { phase: 1 },
    { importSource: { ...row.importSource, otherOwner: "user-b" } },
    { importSource: { ...row.importSource, sourceId: "bad" } },
    { importSource: { ...row.importSource, rowId: "a".repeat(64) } },
  ])
    await assertFails(setDoc(ref, { ...row, ...patch }));
  const missing = { ...row };
  delete missing.slot;
  await assertFails(setDoc(ref, missing));
  await assertSucceeds(
    setDoc(doc(a, "users/user-a/sessions/old"), {
      ...fixtures.sessions,
      id: "old",
    }),
  );
  await assertSucceeds(
    setDoc(doc(a, "users/user-a/sessions/zero-race"), {
      ...fixtures.sessions,
      id: "zero-race",
      type: "Race",
      minutes: 0,
    }),
  );
});
it("stops on an edit or status change after preview instead of overwriting it", async () => {
  const a = modular("user-a"),
    preview = await makePreview(syntheticCsv(2), [], [], "create", "user-a");
  const changed = {
    ...preview.rows[0].incoming,
    title: "Synthetic manual edit",
    status: "Done",
  };
  await setDoc(doc(a, "users/user-a/sessions", changed.id), changed);
  await expect(
    executeImport(a, "user-a", preview, { assertOwner: () => {} }),
  ).rejects.toBeInstanceOf(ImportStale);
  expect(
    (await getDoc(doc(a, "users/user-a/sessions", changed.id))).data()?.title,
  ).toBe("Synthetic manual edit");
  expect(
    (
      await getDoc(doc(a, "users/user-a/sessions", preview.rows[1].incoming.id))
    ).exists(),
  ).toBe(false);
});
it("cancels between chunks and resumes via update without duplicating committed rows", async () => {
  const a = modular("user-a"),
    preview = await makePreview(syntheticCsv(45), [], [], "create", "user-a");
  const controller = new AbortController();
  await expect(
    executeImport(a, "user-a", preview, {
      signal: controller.signal,
      assertOwner: () => {},
      onProgress: (count) => {
        if (count >= 20) controller.abort();
      },
    }),
  ).rejects.toBeInstanceOf(ImportCancelled);
  const partial = await getDocs(
    query(collection(a, "users/user-a/sessions"), limit(200)),
  );
  expect(partial.size).toBe(20);
  const plan = schemas.plans.parse(
    (await getDoc(doc(a, "users/user-a/plans", preview.plan.id))).data(),
  );
  const resume = await previewImport({
    ownerUid: "user-a",
    parsed: parsePlanCsv(syntheticCsv(45)),
    sourceLabel: "not-needed-for-update",
    title: plan.title,
    mode: "update",
    selectedPlan: plan,
    plans: [plan],
    sessions: partial.docs.map((row) => schemas.sessions.parse(row.data())),
  });
  expect(resume.rows.filter((row) => row.kind === "unchanged")).toHaveLength(
    20,
  );
  await executeImport(a, "user-a", resume, { assertOwner: () => {} });
  expect(
    (await getDocs(query(collection(a, "users/user-a/sessions"), limit(200))))
      .size,
  ).toBe(45);
});
it("refuses stale plan metadata and aborted or other-account previews before writing", async () => {
  const a = modular("user-a"),
    preview = await makePreview(syntheticCsv(1), [], [], "create", "user-a");
  const controller = new AbortController();
  controller.abort();
  await expect(
    executeImport(a, "user-a", preview, {
      assertOwner: () => {},
      signal: controller.signal,
    }),
  ).rejects.toBeInstanceOf(ImportCancelled);
  await expect(
    executeImport(a, "user-b", preview, { assertOwner: () => {} }),
  ).rejects.toThrow("another account");
  await setDoc(doc(a, "users/user-a/plans", preview.plan.id), {
    ...preview.plan,
    title: "Manual rename",
  });
  await expect(
    executeImport(a, "user-a", preview, { assertOwner: () => {} }),
  ).rejects.toBeInstanceOf(ImportStale);
  expect(
    (await getDocs(query(collection(a, "users/user-a/sessions"), limit(200))))
      .size,
  ).toBe(0);
});
