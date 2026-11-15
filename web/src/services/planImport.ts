import Papa from "papaparse";
import { schemas, type Session, type PlanRecord } from "../types/data";
export const PLAN_HEADERS = [
  "Date",
  "Day",
  "Slot",
  "Wk",
  "Phase",
  "Type",
  "Session",
  "What to do",
  "Target (HR / pace)",
  "Planned min",
] as const;
export const MAX_CSV_BYTES = 1024 * 1024;
export const MAX_IMPORT_ROWS = 500;
export const normalizeHeader = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export type SourceRow = Pick<
  Session,
  | "date"
  | "day"
  | "slot"
  | "week"
  | "phase"
  | "type"
  | "title"
  | "instructions"
  | "target"
  | "minutes"
> & { line: number };
export interface ParsedPlan {
  rows: SourceRow[];
  errors: string[];
  warnings: string[];
  totalRows: number;
  startDate: string;
  endDate: string;
  types: Record<string, number>;
  weeks: Record<string, number>;
}
export function sortSessions(a: Session, b: Session): number {
  return (
    a.date.localeCompare(b.date) ||
    (a.slot ?? 100) - (b.slot ?? 100) ||
    a.id.localeCompare(b.id)
  );
}
/** Fixed canonical serialization, including optional metadata but excluding status/import markers. */
export function sessionContent(s: SourceRow | Session): object {
  return {
    date: s.date,
    day: s.day ?? null,
    slot: s.slot ?? null,
    week: s.week ?? null,
    phase: s.phase ?? null,
    type: s.type,
    title: s.title,
    instructions: s.instructions,
    target: s.target,
    minutes: s.minutes,
  };
}
export const planContent = (p: PlanRecord) => ({
  title: p.title,
  startDate: p.startDate,
  endDate: p.endDate,
});
export async function hash(value: unknown): Promise<string> {
  const result = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(result), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
/** Compare complete snapshots, regardless of Firestore's map-key ordering. */
export function sameRecord(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, canonical(v)]),
      );
    return value;
  };
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
export function parsePlanCsv(csv: string): ParsedPlan {
  const result: ParsedPlan = {
    rows: [],
    errors: [],
    warnings: [],
    totalRows: 0,
    startDate: "",
    endDate: "",
    types: {},
    weeks: {},
  };
  if (new TextEncoder().encode(csv).byteLength > MAX_CSV_BYTES) {
    result.errors.push("CSV exceeds the 1 MiB import limit.");
    return result;
  }
  const parsed = Papa.parse<string[]>(csv.replace(/^\uFEFF/, ""), {
    skipEmptyLines: "greedy",
    dynamicTyping: false,
  });
  if (parsed.errors.length) {
    result.errors.push(
      ...parsed.errors
        .slice(0, 10)
        .map(
          (error) =>
            `CSV syntax error near record ${(error.row ?? 0) + 1} (${error.code}).`,
        ),
    );
    return result;
  }
  const [headers, ...data] = parsed.data;
  if (!headers) {
    result.errors.push("CSV is empty.");
    return result;
  }
  const names = headers.map(normalizeHeader);
  const expected = PLAN_HEADERS.map(normalizeHeader);
  if (
    headers.length !== 10 ||
    new Set(names).size !== 10 ||
    expected.some((name) => !names.includes(name))
  ) {
    result.errors.push(
      "Expected exactly the 10 distinct Plan headers. Check the worksheet and header row.",
    );
    return result;
  }
  result.totalRows = data.length;
  if (data.length === 0 || data.length > MAX_IMPORT_ROWS) {
    result.errors.push(`CSV must contain 1–${MAX_IMPORT_ROWS} data rows.`);
    return result;
  }
  const keys = new Set<string>();
  const integer = (value: string, max: number) =>
    /^\d+$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= max;
  for (let index = 0; index < data.length; index++) {
    const cells = data[index],
      line = index + 2;
    const fail = (message: string) =>
      result.errors.push(`Record ${line}: ${message}`);
    if (cells.length !== 10) {
      fail("expected exactly 10 values.");
      continue;
    }
    const get = (header: (typeof PLAN_HEADERS)[number]) =>
      cells[names.indexOf(normalizeHeader(header))];
    const date = get("Date").trim();
    if (!schemas.plans.shape.startDate.safeParse(date).success) {
      fail("Date must be a valid YYYY-MM-DD date.");
      continue;
    }
    const day = get("Day").trim();
    const expectedDay = weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()];
    if (day !== expectedDay) {
      fail(
        `Day does not match Date (expected ${expectedDay}); source was not changed.`,
      );
      continue;
    }
    if (!integer(get("Slot"), 99) || !integer(get("Wk"), 9999)) {
      fail(
        "Slot and Wk must be positive integers within 99 and 9999 respectively.",
      );
      continue;
    }
    const rawMinutes = get("Planned min").trim();
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(rawMinutes)) {
      fail("Planned min must be a nonnegative decimal number.");
      continue;
    }
    const type = get("Type").trim();
    if (!["Run", "Strength", "Race", "Rest"].includes(type)) {
      fail("unsupported Type; expected Run, Strength, Race or Rest.");
      continue;
    }
    const row: SourceRow = {
      date,
      day: expectedDay,
      slot: Number(get("Slot")),
      week: Number(get("Wk")),
      phase: get("Phase"),
      type: type as Session["type"],
      title: get("Session"),
      instructions: get("What to do"),
      target: get("Target (HR / pace)"),
      minutes: Number(rawMinutes),
      line,
    };
    const { line: _line, ...content } = row;
    void _line;
    if (
      !schemas.sessions.safeParse({
        ...content,
        id: "validation",
        planId: "validation",
        status: "Planned",
      }).success
    ) {
      fail(
        "session exceeds field limits or has invalid duration (Run must be above zero; Race/Rest may be zero).",
      );
      continue;
    }
    if (!row.title.trim()) {
      fail("Session title must not be blank.");
      continue;
    }
    const key = `${date}|${row.slot}`;
    if (keys.has(key)) {
      fail(
        "duplicate Date + Slot identity; resolve the duplicate in the source.",
      );
      continue;
    }
    keys.add(key);
    // Detect likely contradictory distance descriptions without interpreting targets/pace as distances.
    const distances = (value: string) =>
      Array.from(
        value.matchAll(
          /(\d+(?:\.\d+)?)\s*(?:[–—-]\s*(\d+(?:\.\d+)?))?\s*km\b/gi,
        ),
        (m) => [Number(m[1]), Number(m[2] ?? m[1])],
      );
    const titles = distances(row.title),
      details = distances(row.instructions);
    if (
      titles.length &&
      details.length &&
      !titles.some((a) => details.some((b) => a[0] <= b[1] && b[0] <= a[1]))
    )
      result.warnings.push(
        `Record ${line}: title and instructions mention non-overlapping km distances. Review the source; nothing was corrected.`,
      );
    if (/long\s*run/i.test(row.title) && /recovery/i.test(row.instructions))
      result.warnings.push(
        `Record ${line}: long-run title and recovery instructions may disagree. Review before confirming.`,
      );
    result.rows.push(row);
    result.types[row.type] = (result.types[row.type] ?? 0) + 1;
    result.weeks[String(row.week)] = (result.weeks[String(row.week)] ?? 0) + 1;
  }
  result.rows.sort(
    (a, b) => a.date.localeCompare(b.date) || (a.slot ?? 0) - (b.slot ?? 0),
  );
  result.startDate = result.rows.at(0)?.date ?? "";
  result.endDate = result.rows.at(-1)?.date ?? "";
  for (const date of new Set(result.rows.map((row) => row.date))) {
    const slots = result.rows
      .filter((row) => row.date === date)
      .map((row) => row.slot!);
    if (slots.some((slot, i) => slot !== i + 1))
      result.warnings.push(
        `Date ${date}: slots have gaps or do not start at 1. Values are retained.`,
      );
  }
  return result;
}
export type ChangeKind = "addition" | "change" | "unchanged" | "conflict";
export interface ImportRow {
  incoming: Session;
  expected: Session | null;
  kind: ChangeKind;
  reason: string;
}
export interface ImportPreview {
  ownerUid: string;
  parsed: ParsedPlan;
  plan: PlanRecord;
  expectedPlan: PlanRecord | null;
  planKind: ChangeKind;
  rows: ImportRow[];
  retained: number;
  errors: string[];
  warnings: string[];
}
export async function previewImport(input: {
  ownerUid: string;
  parsed: ParsedPlan;
  sourceLabel: string;
  title: string;
  mode: "create" | "update";
  selectedPlan?: PlanRecord;
  plans: PlanRecord[];
  sessions: Session[];
}): Promise<ImportPreview> {
  const { parsed, selectedPlan } = input;
  const sourceId =
    input.mode === "update" && selectedPlan?.importSource
      ? selectedPlan.importSource.sourceId
      : await hash([
          "training-hq-plan-v1",
          input.sourceLabel.trim().normalize("NFC"),
        ]);
  const planId = `imp_${sourceId}`;
  const expectedPlan = input.plans.find((plan) => plan.id === planId) ?? null;
  const errors = [...parsed.errors],
    warnings = [...parsed.warnings];
  if (input.mode === "create" && !input.sourceLabel.trim())
    errors.push("Enter a stable source reference for this plan.");
  if (input.mode === "create" && expectedPlan)
    errors.push(
      "This source is already imported. Choose Update Existing Imported Plan to resume or reimport.",
    );
  if (
    input.mode === "update" &&
    (!selectedPlan?.importSource || selectedPlan.id !== planId || !expectedPlan)
  )
    errors.push("Select an existing imported plan.");
  const plan = schemas.plans.parse({
    id: planId,
    title:
      input.mode === "update" && expectedPlan
        ? expectedPlan.title
        : input.title,
    startDate: parsed.startDate || "2000-01-01",
    endDate: parsed.endDate || "2000-01-01",
  });
  plan.importSource = {
    sourceId,
    sourceHash: await hash(planContent(plan)),
    version: 1,
  };
  let planKind: ChangeKind = expectedPlan ? "unchanged" : "addition";
  if (expectedPlan) {
    if (
      (await hash(planContent(expectedPlan))) !==
      expectedPlan.importSource?.sourceHash
    ) {
      planKind = "conflict";
      warnings.push(
        "Plan details were manually edited; the existing plan title/date range will be retained.",
      );
    } else if (
      expectedPlan.importSource?.sourceHash !== plan.importSource.sourceHash
    )
      planKind = "change";
  }
  const existing = new Map(
    input.sessions.map((session) => [session.id, session]),
  );
  const rows: ImportRow[] = [];
  for (const row of parsed.rows) {
    const { line: _line, ...content } = row;
    void _line;
    const rowId = await hash([sourceId, row.date, row.slot]);
    const sourceHash = await hash(sessionContent(row));
    const incoming = schemas.sessions.parse({
      ...content,
      id: `row_${rowId}`,
      planId,
      status: "Planned",
      importSource: { sourceId, rowId, sourceHash, version: 1 },
    });
    const current = existing.get(incoming.id) ?? null;
    let kind: ChangeKind = "addition",
      reason = "New source row";
    if (current) {
      if (
        current.planId !== planId ||
        current.importSource?.rowId !== rowId ||
        current.importSource.sourceId !== sourceId
      ) {
        kind = "conflict";
        reason = "Identity is already used by another record";
      } else if (
        (await hash(sessionContent(current))) !==
        current.importSource.sourceHash
      ) {
        kind = "conflict";
        reason = "Manual content/metadata edits are retained";
      } else if (sourceHash === current.importSource.sourceHash) {
        kind = "unchanged";
        reason = "Already imported; current status retained";
      } else if (current.status !== "Planned") {
        kind = "conflict";
        reason = "Completed/partial/skipped status is protected";
      } else {
        kind = "change";
        reason = "Source fields changed; unedited Planned session";
      }
    }
    rows.push({ incoming, expected: current, kind, reason });
  }
  const retained = input.sessions.filter(
    (s) =>
      s.planId === planId &&
      s.importSource?.sourceId === sourceId &&
      !rows.some((r) => r.incoming.id === s.id),
  ).length;
  if (retained)
    warnings.push(
      `${retained} existing source row(s) are absent from this CSV and will be retained. Changed dates/slots create additions; no records are deleted.`,
    );
  return {
    ownerUid: input.ownerUid,
    parsed,
    plan,
    expectedPlan,
    planKind,
    rows,
    retained,
    errors,
    warnings,
  };
}

/** HTML controls normalize line endings; an unchanged edit must retain original source bytes. */
export function preserveEditorText(
  value: string,
  original: string | undefined,
  multiline = true,
): string {
  if (original === undefined) return value;
  const displayed = multiline
    ? original.replace(/\r\n?/g, "\n")
    : original.replace(/[\r\n]/g, "");
  return value === displayed ? original : value;
}
