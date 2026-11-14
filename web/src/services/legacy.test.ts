import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
const ctx = createContext({
  Utilities: {
    parseCsv: (text: string) =>
      text
        .trim()
        .split("\n")
        .map((row) => row.split(",")),
  },
});
runInContext(readFileSync("../legacy/apps-script/Code.gs", "utf8"), ctx);
describe("unchanged legacy reference: synthetic fixtures, no external services", () => {
  it("preserves TRAINING, walking and valid dotted dates", () => {
    expect(ctx.healthSport_("TRAINING")).toBe("Workout");
    expect(ctx.healthSport_("walking")).toBe("Walk");
    expect(ctx.healthISO_("2026.01.01")).toBe("2026-01-01");
    expect(ctx.healthISO_("2026-02-31")).toBe("");
  });
  it("keeps legacy duration thresholds and manual overrides", () => {
    expect(ctx.effStatus_({ ovr: "Skipped", auto: "Done" })).toBe("Skipped");
    expect(ctx.cleanPace_("", 5, 30)).toBe("6:00");
  });
  it("accepts non-GPS generic TRAINING CSV without reclassifying it as strength", () => {
    const workouts: Record<string, unknown[]> = {};
    const file = {
      getName: () => "synthetic-fixture.csv",
      getBlob: () => ({
        getDataAsString: () =>
          "date,activitytype,durationminutes,distancekm\n2026-01-01T07:00:00,TRAINING,30,0",
      }),
    };
    ctx.healthParseCsv_(file, workouts, {}, [], {});
    const rows = Object.values(workouts);
    expect(rows).toHaveLength(1);
    expect(rows[0][4]).toBe("Workout");
    expect(rows[0][5]).toBe(0);
    expect(rows[0][6]).toBe(30);
  });
  it.fails(
    "known legacy defect: CSV workout rows must match the 13-column header",
    () => {
      const workouts = {};
      const file = {
        getName: () => "synthetic-fixture.csv",
        getBlob: () => ({
          getDataAsString: () =>
            "date,activitytype,durationminutes,distancekm\n2026-01-01T07:00:00,TRAINING,30,0",
        }),
      };
      ctx.healthParseCsv_(file, workouts, {}, [], {});
      const rows = Object.values(workouts) as unknown[][];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveLength(ctx.HEALTH_WORKOUT_HEADERS.length);
    },
  );
});
