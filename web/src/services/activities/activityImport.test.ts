import { describe, it, expect } from "vitest";
import { parseFit, fitBudget } from "./fit";
import { parseXml, safeXml } from "./xml";
import { parseActivityCsv } from "./csv";
import { expandFiles, safePath } from "./files";
import { normalizeActivity, summaryContent } from "./normalize";
import { activityPreview, consolidate } from "./preview";
import { processActivities } from "./pipeline";
import { LIMITS, raw, timestamp } from "./model";
import { hash } from "../planImport";
import { validateDistance } from "../gps";
import { suggestedSessions, confirmedActual } from "./matching";
import type { Session } from "../../types/data";
import {
  START,
  syntheticFit,
  syntheticTcx,
  syntheticCsv,
  syntheticGpx,
  syntheticZip,
  syntheticFixes,
  wire,
} from "./fixtures";
const fileHash = "a".repeat(64);
describe("actual file parsing with synthetic fixtures", () => {
  it("decodes binary FIT, rejects hundreds of sentinel coordinates and validates ~4.26 km vs reported 8.32 km", async () => {
    const parsed = await parseFit(syntheticFit(), fileHash);
    expect(parsed).toHaveLength(1);
    const { workout: w } = await normalizeActivity(parsed[0]);
    expect(w.type).toBe("Walk");
    expect(w.reportedMeters).toBe(8320);
    expect(w.gpsMeters).toBeCloseTo(4260, 0);
    expect(w.distanceSource).toBe("gps-validated");
    expect(w.details?.invalidGpsCount).toBe(300);
    expect(w.details?.hrSampleCount).toBeGreaterThan(300);
    expect(w.averageHr).toBe(120);
    expect(w.details?.maxHr).toBe(140);
    expect(w.details?.movingSeconds).toBeNull();
    expect(w.qualityFlags).toContain("distance-mismatch");
  });
  it("accepts non-GPS FIT workouts with HR and never guesses strength", async () => {
    const parsed = await parseFit(syntheticFit(false, 0), fileHash),
      { workout: w } = await normalizeActivity(parsed[0]);
    expect(w.type).toBe("Training");
    expect(w.gpsMeters).toBeNull();
    expect(w.details?.hrSampleCount).toBe(301);
    expect(w.averageHr).toBe(120);
  });
  it("rejects bad binary framing, bad CRC and over-budget FIT", async () => {
    const corrupt = syntheticFit();
    corrupt[corrupt.length - 10] ^= 1;
    await expect(parseFit(corrupt, fileHash)).rejects.toBeDefined();
    expect(() => fitBudget(new Uint8Array(4 * 1024 * 1024 + 1))).toThrow();
    await expect(parseFit(wire("not FIT"), fileHash)).rejects.toBeDefined();
  });
  it("reads namespaced TCX HR/GPS/cadence and missing optional fields", async () => {
    const a = parseXml(syntheticTcx(), "TCX", fileHash)[0];
    expect(a.hrSamples).toHaveLength(301);
    expect(a.fixes).toHaveLength(301);
    const { workout: w } = await normalizeActivity(a);
    expect(w.details?.maxHr).toBe(140);
    expect(w.details?.cadence).toBe(60);
    expect(w.details?.metricSources.cadence).toBe("TCX-samples");
    expect(w.gpsMeters).toBeCloseTo(4260, 0);
    const n = await normalizeActivity(
      parseXml(syntheticTcx(false), "TCX", fileHash)[0],
    );
    expect(n.workout.type).toBe("Training");
    expect(n.workout.reportedMeters).toBeNull();
    expect(n.workout.details?.movingSeconds).toBeNull();
  });
  it("reads quoted Unicode/BOM CSV, requires explicit units/timezones and preserves generic TRAINING", () => {
    const parsed = parseActivityCsv(
      "\uFEFF" + syntheticCsv("TRAINING"),
      fileHash,
      "",
    );
    expect(parsed.activities[0].kind).toBe("Training");
    expect(parsed.activities[0].steps).toBe(6000);
    expect(parsed.activities[0].reportedMeters).toBe(8320);
    expect(() =>
      parseActivityCsv(
        syntheticCsv("Walking", "2028-02-07 07:00:00"),
        fileHash,
        "",
      ),
    ).toThrow();
    expect(
      parseActivityCsv(
        syntheticCsv("Walking", "2028-02-07 07:00:00"),
        fileHash,
        "+05:30",
      ).activities[0].start,
    ).toBe(START - 19800000);
    const unknown = parseActivityCsv(
      syntheticCsv().replace("Distance km", "Distance"),
      fileHash,
      "",
    );
    expect(unknown.activities[0].reportedMeters).toBeNull();
  });
  it("keeps elapsed and moving time distinct, supports separate date/clock headers and flags contradictory source summaries", async () => {
    const result = parseActivityCsv(
      "Date,Start time,End time,Type,Duration min,Moving min\n2028-02-07,07:00:00,08:00:00,TRAINING,50,40",
      fileHash,
      "+00:00",
    );
    expect(result.activities[0].start).toBe(START);
    expect(result.activities[0].end).toBe(START + 3600000);
    const { workout, notes } = await normalizeActivity(result.activities[0]);
    expect(workout.details?.elapsedSeconds).toBe(3600);
    expect(workout.details?.reportedElapsedSeconds).toBe(3000);
    expect(workout.details?.movingSeconds).toBe(2400);
    expect(workout.qualityFlags).toContain("source-conflict");
    expect(notes.join(" ")).toContain("conflicts with timestamps");
    expect(() =>
      parseActivityCsv(
        "Date,Start time,Type,Moving min\n2028-02-07,07:00:00,TRAINING,40",
        fileHash,
        "+00:00",
      ),
    ).toThrow();
  });
  it("reports overlapping daily/historical HR CSVs as unsupported rather than workouts", () => {
    for (const name of ["Daily HR", "Historical HR"]) {
      const parsed = parseActivityCsv(
        `Date,Heart rate,Source\n2028-02-07T07:00:00Z,120,${name}`,
        fileHash,
        "",
      );
      expect(parsed.activities).toHaveLength(0);
      expect(parsed.notice).toContain("Separate health-series");
    }
  });
  it("reads timestamped GPX and KML fallback without inventing missing metrics", async () => {
    const g = await normalizeActivity(
      parseXml(syntheticGpx(), "GPX", fileHash)[0],
    );
    expect(g.workout.gpsMeters).toBeCloseTo(4260, 0);
    expect(g.workout.reportedMeters).toBeNull();
    expect(g.workout.averageHr).toBeNull();
    const k = parseXml(
      '<kml><Document><Placemark><gx:Track xmlns:gx="urn:gx"><when>2028-02-07T07:00:00Z</when><when>2028-02-07T07:10:00Z</when><gx:coord>1 1 20</gx:coord><gx:coord>1.01 1 20</gx:coord></gx:Track></Placemark></Document></kml>',
      "KML",
      fileHash,
    );
    expect(k[0].kind).toBe("Other");
    expect(k[0].movingSeconds).toBeNull();
    expect(() =>
      parseXml(
        '<gpx><trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk></gpx>',
        "GPX",
        fileHash,
      ),
    ).toThrow();
  });
  it("rejects DTD/entities, malformed/deep XML and invalid timestamps", () => {
    expect(() =>
      safeXml(
        '<!DOCTYPE x [<!ENTITY p SYSTEM "https://invalid.example/private">]><x>&p;</x>',
      ),
    ).toThrow();
    expect(() => safeXml("<a><b></a>")).toThrow();
    expect(() => safeXml("<a>".repeat(50) + "</a>".repeat(50))).toThrow();
    expect(timestamp("2028-02-30T07:00:00Z")).toBeNull();
    expect(timestamp("2028-02-07T27:00:00Z")).toBeNull();
  });
});
describe("ZIP safety and local pipeline", () => {
  it("accepts nested Health Sync folders and ignores unrelated metadata", async () => {
    const zip = await syntheticZip([
      {
        name: "Health Sync/workouts/synthetic.csv",
        bytes: wire(syntheticCsv()),
      },
      {
        name: "Health Sync/meta/readme.txt",
        bytes: wire("Synthetic metadata"),
      },
    ]);
    const result = await processActivities([
      { name: "synthetic.zip", bytes: zip },
    ]);
    expect(result.activities).toHaveLength(1);
    expect(result.notices.join(" ")).toContain("ignored");
  });
  it("rejects path traversal, expansion bombs, CRC corruption, nested ZIPs and oversize input", async () => {
    expect(safePath("../private.csv")).toBe(false);
    expect(safePath("C:\\private.csv")).toBe(false);
    await expect(
      expandFiles([
        {
          name: "bomb.zip",
          bytes: await syntheticZip([
            { name: "huge.csv", bytes: wire("A".repeat(2 * 1024 * 1024)) },
          ]),
        },
      ]),
    ).rejects.toBeDefined();
    await expect(
      expandFiles([
        {
          name: "nested.zip",
          bytes: await syntheticZip([
            { name: "nested.zip", bytes: wire("fake zip") },
          ]),
        },
      ]),
    ).rejects.toBeDefined();
    await expect(
      expandFiles([{ name: "unknown.exe", bytes: wire("x") }]),
    ).rejects.toBeDefined();
    await expect(
      expandFiles([
        { name: "big.csv", bytes: new Uint8Array(LIMITS.file + 1) },
      ]),
    ).rejects.toBeDefined();
    const zip = await syntheticZip(
      [{ name: "data.csv", bytes: wire(syntheticCsv()) }],
      0,
    );
    const needle = wire("Start datetime");
    const index = zip.findIndex((_, offset) =>
      needle.every((byte, i) => zip[offset + i] === byte),
    );
    expect(index).toBeGreaterThan(0);
    zip[index] ^= 1;
    await expect(
      expandFiles([{ name: "corrupt.zip", bytes: zip }]),
    ).rejects.toBeDefined();
  });
  it("never emits raw GPS/HR samples in normalized summaries and cancels local work", async () => {
    const result = await processActivities([
      { name: "synthetic.tcx", bytes: wire(syntheticTcx()) },
    ]);
    const json = JSON.stringify(result.activities[0].workout);
    expect(json).not.toContain("latitude");
    expect(json).not.toContain("hrSamples");
    expect(json).not.toContain("Trackpoint");
    const control = new AbortController();
    control.abort();
    await expect(
      processActivities(
        [{ name: "synthetic.csv", bytes: wire(syntheticCsv()) }],
        "",
        control.signal,
      ),
    ).rejects.toBeDefined();
  });
});
describe("quality, deduplication and matching", () => {
  it("rejects sparse, reversed, discontinuous, conflicting-time and jumping GPS before correction", () => {
    const p = syntheticFixes().map((f) => ({
      seconds: (f.time - START) / 1000,
      latitude: f.latitude,
      longitude: f.longitude,
      segment: 0,
    }));
    for (const points of [
      p.slice(0, 50),
      [...p].reverse(),
      p.map((f, i) => ({ ...f, segment: i })),
      [...p, { ...p[10], longitude: 5 }],
      p.map((f, i) => ({ ...f, longitude: i % 2 ? 5 : 1 })),
    ])
      expect(validateDistance(8320, 3000, "Walk", points).source).toBe(
        "reported",
      );
  });
  it("merges uniquely aligned FIT/TCX/CSV records preserving complementary summaries and raw distances", async () => {
    const parsed = await processActivities([
      { name: "a.fit", bytes: syntheticFit() },
      { name: "a.tcx", bytes: wire(syntheticTcx()) },
      { name: "a.csv", bytes: wire(syntheticCsv()) },
    ]);
    const result = await consolidate(parsed.activities);
    expect(result).toHaveLength(1);
    expect(result[0].workout.provenance?.formats).toHaveLength(3);
    expect(result[0].workout.details?.steps).toBe(6000);
    expect(result[0].workout.details?.reportedByFormat.FIT).toBe(8320);
    expect(result[0].workout.gpsMeters).toBeCloseTo(4260, 0);
  });
  it("reimports the same ZIP without duplicate activities, independent of ZIP entry order", async () => {
    const files = [
      { name: "x.tcx", bytes: wire(syntheticTcx()) },
      { name: "x.fit", bytes: syntheticFit() },
    ];
    const first = await processActivities([
      { name: "first.zip", bytes: await syntheticZip(files) },
    ]);
    const p = await activityPreview("user-a", first.activities, []);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].action).toBe("addition");
    const second = await processActivities([
      { name: "again.zip", bytes: await syntheticZip([...files].reverse()) },
    ]);
    const retry = await activityPreview(
      "user-a",
      second.activities,
      p.rows.map((r) => r.incoming),
    );
    expect(retry.rows).toHaveLength(1);
    expect(retry.rows[0].action).toBe("unchanged");
  });
  it("requires review for ambiguous matches and protects manually edited summaries", async () => {
    const parsed = await processActivities([
      {
        name: "one.csv",
        bytes: wire(
          syntheticCsv("Walking", new Date(START).toISOString(), "id-one"),
        ),
      },
      {
        name: "two.csv",
        bytes: wire(
          syntheticCsv("Walking", new Date(START).toISOString(), "id-two"),
        ),
      },
    ]);
    const p = await activityPreview("user-a", parsed.activities, []);
    expect(p.rows.every((r) => r.action === "review")).toBe(true);
    const decision = await activityPreview(
      "user-a",
      parsed.activities,
      [],
      Object.fromEntries(p.rows.map((r) => [r.key, "keep"])),
    );
    expect(decision.rows.filter((r) => r.action === "addition")).toHaveLength(
      2,
    );
    const w = parsed.activities[0].workout,
      manual = { ...w, title: "Synthetic manual edit" };
    const conflict = await activityPreview(
      "user-a",
      [parsed.activities[0]],
      [manual],
    );
    expect(conflict.rows[0].action).toBe("conflict");
  });
  it("proposes multiple same-day sessions without arbitrary assignment, never treats TRAINING as strength", async () => {
    const a = raw(
      "CSV",
      fileHash,
      START,
      START + 1800000,
      "Run",
      "Synthetic run",
    );
    const w = (await normalizeActivity(a)).workout;
    const s: Session = {
      id: "s1",
      planId: "p",
      date: "2028-02-07",
      type: "Run",
      title: "Synthetic run",
      minutes: 30,
      target: "",
      instructions: "",
      status: "Planned",
    };
    expect(suggestedSessions(w, [s, { ...s, id: "s2", slot: 2 }])).toHaveLength(
      2,
    );
    expect(
      suggestedSessions({ ...w, type: "Training" }, [
        { ...s, type: "Strength" },
      ]),
    ).toHaveLength(0);
    expect(
      confirmedActual({ ...s, actualWorkoutId: w.id }, [
        { ...w, matchSessionId: s.id },
      ])?.id,
    ).toBe(w.id);
    expect(
      confirmedActual({ ...s, actualWorkoutId: w.id }, [w]),
    ).toBeUndefined();
  });
  it("summary fingerprints exclude user-confirmed match links and do not erase reported data", async () => {
    const w = (
      await normalizeActivity(
        raw("CSV", fileHash, START, START + 600000, "Training"),
      )
    ).workout;
    expect(
      await hash(summaryContent({ ...w, matchSessionId: "manual-session" })),
    ).toBe(w.provenance?.summaryHash);
    expect(w.reportedMeters).toBeNull();
  });
});
