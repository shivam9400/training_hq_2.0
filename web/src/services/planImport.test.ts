import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { schemas } from "../types/data";
import {
  MAX_CSV_BYTES,
  hash,
  parsePlanCsv,
  sessionContent,
  sortSessions,
  preserveEditorText,
} from "./planImport";
import { syntheticCsv, makePreview } from "./importFixtures";
describe("private 10-column plan parser", () => {
  it("maps 69 synthetic rows with metadata, Unicode, quoted commas, BOM and multiline text, retaining zero-minute rest/race", () => {
    const result = parsePlanCsv(`\uFEFF${syntheticCsv(69)}`);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(69);
    expect(result.rows[0]).toMatchObject({
      slot: 1,
      week: 1,
      phase: "Synthetic phase",
      minutes: 35,
      type: "Run",
      title: "Synthetic session 1",
      instructions: "Synthetic instructions, Unicode × —\nSecond line",
      target: "Synthetic target 6:10–6:40 /km",
    });
    expect(result.rows[2].minutes).toBe(0);
    expect(result.rows[2].type).toBe("Rest");
    expect(result.rows[3].minutes).toBe(0);
    expect(result.rows[3].type).toBe("Race");
    expect(Object.values(result.types).reduce((a, b) => a + b, 0)).toBe(69);
    expect(Object.values(result.weeks).reduce((a, b) => a + b, 0)).toBe(69);
  });
  it("matches normalized headers by name, not position; preserves text whitespace", () => {
    const rows = Papa.parse<string[]>(syntheticCsv(1)).data;
    rows[0] = rows[0].map((h) => `  ${h.toUpperCase()} `);
    rows[1][6] = "  Synthetic title  ";
    rows[1][7] = "  Unicode text\n  indented instructions  ";
    const result = parsePlanCsv(
      Papa.unparse(rows.map((row) => [...row].reverse())),
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0].title).toBe("  Synthetic title  ");
    expect(result.rows[0].instructions).toBe(
      "  Unicode text\n  indented instructions  ",
    );
  });
  it("rejects malformed/duplicate headers, bad row widths, ISO dates, Day mismatches, slots, weeks, types and minutes", () => {
    const rows = Papa.parse<string[]>(syntheticCsv(1)).data;
    for (const [index, value] of [
      [0, "2028-02-31"],
      [1, "Wrong"],
      [2, "0"],
      [2, "1.5"],
      [3, "-1"],
      [5, "Walking"],
      [9, "-1"],
      [9, "Infinity"],
      [9, "0"],
      [9, "901"],
      [9, ""],
      [6, " "],
    ] as const) {
      const bad = rows.map((row) => [...row]);
      bad[1][index] = value;
      expect(parsePlanCsv(Papa.unparse(bad)).errors.length).toBeGreaterThan(0);
    }
    const duplicate = rows.map((row) => [...row]);
    duplicate[0][1] = "Date";
    expect(parsePlanCsv(Papa.unparse(duplicate)).errors.length).toBeGreaterThan(
      0,
    );
    expect(
      parsePlanCsv(Papa.unparse([rows[0], rows[1].slice(0, 9)])).errors.length,
    ).toBeGreaterThan(0);
    expect(parsePlanCsv('"unterminated').errors.length).toBeGreaterThan(0);
    expect(parsePlanCsv(" ").errors.length).toBeGreaterThan(0);
    expect(
      parsePlanCsv("x".repeat(MAX_CSV_BYTES + 1)).errors.length,
    ).toBeGreaterThan(0);
    expect(parsePlanCsv(syntheticCsv(501)).errors.length).toBeGreaterThan(0);
  });
  it("rejects duplicate date/slot keys and sorts slots numerically, not file order", () => {
    const rows = Papa.parse<string[]>(syntheticCsv(2)).data;
    const parsed = parsePlanCsv(Papa.unparse([rows[0], rows[2], rows[1]]));
    expect(parsed.rows.map((row) => row.slot)).toEqual([1, 2]);
    expect(
      parsePlanCsv(Papa.unparse([rows[0], rows[1], rows[1]])).errors.some((e) =>
        e.includes("duplicate"),
      ),
    ).toBe(true);
  });
  it("flags contradictory distances and long/recovery instructions without rewriting", () => {
    const rows = Papa.parse<string[]>(syntheticCsv(1)).data;
    rows[1][6] = "Synthetic 12–18 km long run";
    rows[1][7] = "Synthetic 3 km recovery run";
    const parsed = parsePlanCsv(Papa.unparse(rows));
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toHaveLength(2);
    expect(parsed.rows[0].title).toBe(rows[1][6]);
    expect(parsed.rows[0].instructions).toBe(rows[1][7]);
  });
});
describe("stable import preview and update protection", () => {
  it("reorders files without changing plan/session identities and blocks duplicate create mode", async () => {
    const first = await makePreview();
    const stored = first.rows.map((r) => r.incoming);
    const rows = Papa.parse<string[]>(syntheticCsv()).data;
    const update = await makePreview(
      Papa.unparse([rows[0], ...rows.slice(1).reverse()]),
      [first.plan],
      stored,
      "update",
    );
    expect(update.errors).toEqual([]);
    expect(update.rows.map((r) => r.incoming.id)).toEqual(
      first.rows.map((r) => r.incoming.id),
    );
    expect(update.rows.every((r) => r.kind === "unchanged")).toBe(true);
    expect(
      (await makePreview(syntheticCsv(), [first.plan], stored)).errors.some(
        (e) => e.includes("already imported"),
      ),
    ).toBe(true);
  });
  it("previews safe changes and preserves manual edits/completed/status changes", async () => {
    const first = await makePreview(syntheticCsv(4));
    const stored = first.rows.map((r) => r.incoming);
    const rows = Papa.parse<string[]>(syntheticCsv(4)).data;
    for (const row of rows.slice(1)) row[7] = "Synthetic source update";
    stored[0] = { ...stored[0], instructions: "Manual synthetic edit" };
    stored[1] = { ...stored[1], status: "Done" };
    stored[2] = { ...stored[2], status: "Partial" };
    const preview = await makePreview(
      Papa.unparse(rows),
      [first.plan],
      stored,
      "update",
    );
    expect(preview.rows.map((r) => r.kind)).toEqual([
      "conflict",
      "conflict",
      "conflict",
      "change",
    ]);
    expect(preview.rows[3].incoming.minutes).toBe(0);
    const unchangedDone = await makePreview(
      syntheticCsv(4),
      [first.plan],
      [
        { ...first.rows[0].incoming, status: "Skipped" },
        ...first.rows.slice(1).map((r) => r.incoming),
      ],
      "update",
    );
    expect(unchangedDone.rows[0].kind).toBe("unchanged");
    expect(unchangedDone.rows[0].expected?.status).toBe("Skipped");
  });
  it("retains missing source rows and edited plan metadata rather than deleting/overwriting", async () => {
    const first = await makePreview();
    const edited = { ...first.plan, title: "Manually renamed" };
    const update = await makePreview(
      syntheticCsv(1),
      [edited],
      first.rows.map((r) => r.incoming),
      "update",
    );
    expect(update.retained).toBe(2);
    expect(update.planKind).toBe("conflict");
    expect(update.warnings.length).toBeGreaterThan(0);
  });
  it("keeps old records compatible, rejects unknown source fields and allows Race/Rest at zero but not Run", () => {
    const old = {
      id: "old",
      planId: "old",
      date: "2028-02-07",
      type: "Race",
      title: "Synthetic",
      minutes: 0,
      target: "",
      instructions: "",
      status: "Planned",
    };
    expect(schemas.sessions.safeParse(old).success).toBe(true);
    expect(schemas.sessions.safeParse({ ...old, type: "Rest" }).success).toBe(
      true,
    );
    expect(schemas.sessions.safeParse({ ...old, type: "Run" }).success).toBe(
      false,
    );
    expect(
      schemas.sessions.safeParse({ ...old, importSource: { sourceId: "bad" } })
        .success,
    ).toBe(false);
  });
  it("hashes only source fields for edit detection, preserving statuses and numeric slot order", async () => {
    const first = await makePreview();
    const row = first.rows[0].incoming;
    expect(await hash(sessionContent({ ...row, status: "Done" }))).toBe(
      row.importSource?.sourceHash,
    );
    expect(
      [
        { ...row, slot: 10 },
        { ...row, slot: 2 },
      ]
        .sort(sortSessions)
        .map((r) => r.slot),
    ).toEqual([2, 10]);
  });
});

it("retains source CRLF/text whitespace when unchanged HTML editor values normalize it", () => {
  expect(
    preserveEditorText("  Line one\nLine two  ", "  Line one\r\nLine two  "),
  ).toBe("  Line one\r\nLine two  ");
  expect(preserveEditorText("Source title", "Source\r\n title", false)).toBe(
    "Source\r\n title",
  );
  expect(preserveEditorText("changed\ntext", "original\r\ntext")).toBe(
    "changed\ntext",
  );
});
