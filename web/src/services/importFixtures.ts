import Papa from "papaparse";
import type { PlanRecord, Session } from "../types/data";
import { PLAN_HEADERS, parsePlanCsv, previewImport } from "./planImport";
const day = (date: string) =>
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
    new Date(`${date}T00:00:00Z`).getUTCDay()
  ];
export function syntheticCsv(count = 3): string {
  const rows = Array.from({ length: count }, (_, i) => {
    const date = new Date(Date.UTC(2028, 1, 7 + Math.floor(i / 2)))
      .toISOString()
      .slice(0, 10);
    const type = ["Run", "Strength", "Rest", "Race"][i % 4];
    return [
      date,
      day(date),
      String((i % 2) + 1),
      String(Math.floor(i / 14) + 1),
      "Synthetic phase",
      type,
      `Synthetic session ${i + 1}`,
      "Synthetic instructions, Unicode × —\nSecond line",
      "Synthetic target 6:10–6:40 /km",
      type === "Rest" || type === "Race" ? "0" : "35",
    ];
  });
  return Papa.unparse([Array.from(PLAN_HEADERS), ...rows]);
}
export async function makePreview(
  csv = syntheticCsv(),
  plans: PlanRecord[] = [],
  sessions: Session[] = [],
  mode: "create" | "update" = "create",
  uid = "synthetic-owner",
) {
  return previewImport({
    ownerUid: uid,
    parsed: parsePlanCsv(csv),
    sourceLabel: "synthetic-source",
    title: "Synthetic imported plan",
    mode,
    selectedPlan: plans[0],
    plans,
    sessions,
  });
}
