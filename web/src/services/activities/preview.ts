import { schemas, type Workout } from "../../types/data";
import { hash, sameRecord } from "../planImport";
import { summaryContent } from "./normalize";
import type { Candidate } from "./model";
export interface ActivityRow {
  key: string;
  incoming: Workout;
  expected: Workout | null;
  action:
    "addition" | "enrichment" | "unchanged" | "review" | "conflict" | "skip";
  notes: string[];
  targets: string[];
}
export interface ActivityPreview {
  ownerUid: string;
  rows: ActivityRow[];
  errors: string[];
}
export type Decisions = Record<string, string>;
const overlap = (a: Workout, b: Workout) =>
  a.provenance?.aliases.some((alias) =>
    b.provenance?.aliases.includes(alias),
  ) ?? false;
const near = (a: Workout, b: Workout) =>
  Math.abs(Date.parse(a.start) - Date.parse(b.start)) <= 300000 &&
  Math.abs(Date.parse(a.end) - Date.parse(b.end)) <=
    Math.max(180000, (Date.parse(a.end) - Date.parse(a.start)) * 0.15);
const disjoint = (a: Workout, b: Workout) =>
  a.provenance &&
  b.provenance &&
  !a.provenance.formats.some((f) => b.provenance!.formats.includes(f));
function strong(a: Workout, b: Workout): boolean {
  return Boolean(
    disjoint(a, b) &&
    a.type === b.type &&
    Math.abs(Date.parse(a.start) - Date.parse(b.start)) <= 2000 &&
    Math.abs(Date.parse(a.end) - Date.parse(b.end)) <= 2000,
  );
}
const rank = (a: Workout) =>
  Math.min(
    ...(a.provenance?.formats ?? []).map((f) =>
      ["FIT", "TCX", "CSV", "GPX", "KML"].indexOf(f),
    ),
  );
export async function mergeSummaries(
  primary: Workout,
  extra: Workout,
): Promise<Workout> {
  if (
    !primary.details ||
    !extra.details ||
    !primary.provenance ||
    !extra.provenance
  )
    throw new Error("Only imported summaries can be merged.");
  const result: Workout = structuredClone(primary),
    d = result.details!,
    e = extra.details;
  if (
    result.title.startsWith("Untitled ") &&
    !extra.title.startsWith("Untitled ")
  )
    result.title = extra.title;
  const flags = new Set([...primary.qualityFlags, ...extra.qualityFlags]);
  for (const [field, source] of [
    ["maxHr", "maxHr"],
    ["calories", "calories"],
    ["steps", "steps"],
    ["cadence", "cadence"],
    ["elevationGainMeters", "elevation"],
    ["movingSeconds", "moving"],
  ] as const) {
    if (d[field] === null && e[field] !== null) {
      d[field] = e[field];
      d.metricSources[source] = e.metricSources[source];
      if (field === "cadence") d.cadenceUnit = e.cadenceUnit;
    } else if (
      d[field] !== null &&
      e[field] !== null &&
      Math.abs(d[field]! - e[field]!) > 0.01
    )
      flags.add("source-conflict");
  }
  if (result.averageHr === null && extra.averageHr !== null) {
    result.averageHr = extra.averageHr;
    d.metricSources.averageHr = e.metricSources.averageHr;
    d.hrSampleCount = e.hrSampleCount;
  } else if (
    result.averageHr !== null &&
    extra.averageHr !== null &&
    Math.abs(result.averageHr - extra.averageHr) > 1
  )
    flags.add("source-conflict");
  for (const format of ["FIT", "TCX", "CSV", "GPX", "KML"] as const) {
    if (d.reportedByFormat[format] === null)
      d.reportedByFormat[format] = e.reportedByFormat[format];
    else if (
      e.reportedByFormat[format] !== null &&
      d.reportedByFormat[format] !== e.reportedByFormat[format]
    )
      throw new Error("Same-format values conflict; keep separate or skip.");
  }
  if (result.reportedMeters === null && extra.reportedMeters !== null) {
    result.reportedMeters = extra.reportedMeters;
    d.metricSources.distance = e.metricSources.distance;
  } else if (
    result.reportedMeters !== null &&
    extra.reportedMeters !== null &&
    Math.abs(result.reportedMeters - extra.reportedMeters) >
      Math.max(10, result.reportedMeters * 0.1)
  )
    flags.add("source-conflict");
  if (
    (result.gpsMeters === null || result.distanceSource !== "gps-validated") &&
    extra.gpsMeters !== null
  ) {
    result.gpsMeters = extra.gpsMeters;
    d.gpsSource = e.gpsSource;
    d.gpsSampleCount = e.gpsSampleCount;
    d.invalidGpsCount = e.invalidGpsCount;
    if (extra.distanceSource === "gps-validated")
      result.distanceSource = "gps-validated";
  }
  if (result.distanceSource !== "gps-validated")
    result.distanceSource =
      result.reportedMeters === null ? "unavailable" : "reported";
  if (d.minElevationMeters === null) {
    d.minElevationMeters = e.minElevationMeters;
    d.maxElevationMeters = e.maxElevationMeters;
    d.elevationSampleCount = e.elevationSampleCount;
  }
  if (
    result.reportedMeters !== null ||
    result.distanceSource === "gps-validated"
  )
    flags.delete("no-distance");
  const aliases = [
    ...new Set([...primary.provenance.aliases, ...extra.provenance.aliases]),
  ].sort();
  if (aliases.length > 8)
    throw new Error("Provenance limit; split or skip records.");
  result.qualityFlags = [...flags].sort();
  result.provenance = {
    version: 1,
    aliases,
    formats: [
      ...new Set([...primary.provenance.formats, ...extra.provenance.formats]),
    ].sort(),
    summaryHash: "",
  };
  result.provenance.summaryHash = await hash(summaryContent(result));
  return schemas.workouts.parse(result);
}
export async function consolidate(input: Candidate[]): Promise<Candidate[]> {
  const exact: Candidate[] = [];
  for (const candidate of [...input].sort(
    (a, b) =>
      rank(a.workout) - rank(b.workout) ||
      a.workout.id.localeCompare(b.workout.id),
  )) {
    const duplicate = exact.find(
      (c) =>
        overlap(c.workout, candidate.workout) &&
        sameRecord(
          summaryContent(c.workout),
          summaryContent(candidate.workout),
        ),
    );
    if (duplicate) continue;
    exact.push(candidate);
  }
  const used = new Set<number>(),
    output: Candidate[] = [];
  for (let i = 0; i < exact.length; i++) {
    if (used.has(i)) continue;
    const group = [
      i,
      ...exact
        .map((c, j) =>
          j !== i && strong(exact[i].workout, c.workout) ? j : -1,
        )
        .filter((j) => j >= 0),
    ];
    const unambiguous =
      group.every((a) =>
        group.every(
          (b) => a === b || strong(exact[a].workout, exact[b].workout),
        ),
      ) &&
      group.every((a) =>
        exact.every(
          (c, j) => group.includes(j) || !strong(exact[a].workout, c.workout),
        ),
      );
    let candidate = structuredClone(exact[i]);
    used.add(i);
    if (unambiguous)
      for (const j of group.slice(1)) {
        try {
          candidate = {
            workout: await mergeSummaries(candidate.workout, exact[j].workout),
            notes: [
              ...new Set([
                ...candidate.notes,
                ...exact[j].notes,
                "Uniquely aligned companion formats merged; complementary summary fields retained.",
              ]),
            ],
          };
          used.add(j);
        } catch {
          candidate.notes.push("Conflicting companion values require review.");
        }
      }
    output.push(candidate);
  }
  return output;
}
export async function activityPreview(
  uid: string,
  candidates: Candidate[],
  existing: Workout[],
  decisions: Decisions = {},
): Promise<ActivityPreview> {
  const groups = await consolidate(candidates);
  const rows: ActivityRow[] = [];
  const errors: string[] = [];
  for (const candidate of groups) {
    const w = candidate.workout,
      key = await hash([w.id, w.provenance?.summaryHash]);
    const matches = existing.filter((old) => overlap(w, old) || strong(w, old));
    const exact = matches.filter((old) =>
      sameRecord(summaryContent(old), summaryContent(w)),
    );
    const target =
      exact.length === 1
        ? exact[0]
        : matches.length === 1
          ? matches[0]
          : undefined;
    const possible = existing.filter((old) => near(w, old));
    const peers = groups.filter(
      (c) => c !== candidate && (overlap(w, c.workout) || near(w, c.workout)),
    );
    const row: ActivityRow = {
      key,
      incoming: w,
      expected: null,
      action: "addition",
      notes: [...candidate.notes],
      targets: [
        ...new Set([
          ...possible.map((w) => w.id),
          ...peers.map((p) => p.workout.id),
        ]),
      ],
    };
    if (target) {
      row.expected = target;
      row.incoming = {
        ...w,
        id: target.id,
        sourceId: target.sourceId,
        ...(target.matchSessionId !== undefined
          ? { matchSessionId: target.matchSessionId }
          : {}),
      };
      if (
        !target.provenance ||
        (await hash(summaryContent(target))) !== target.provenance.summaryHash
      ) {
        row.action = "conflict";
        row.notes.push(
          "Saved summary has manual edits; it will not be overwritten.",
        );
      } else if (exact.length === 1) {
        row.action = "unchanged";
        row.incoming = target;
      } else if (disjoint(target, w) && matches.length === 1 && !peers.length) {
        try {
          row.incoming = await mergeSummaries(target, w);
          row.action = "enrichment";
        } catch {
          row.action = "review";
          row.notes.push("Conflicting source values need review.");
        }
      } else {
        row.action = "review";
        row.notes.push(
          "Same-source revision or multiple candidates require explicit review.",
        );
      }
    } else if (possible.length || peers.length) {
      row.action = "review";
      row.notes.push(
        "Possible duplicate: timestamps alone are not sufficient to choose automatically.",
      );
    }
    const decision = decisions[key];
    if (decision === "skip") row.action = "skip";
    else if (decision === "keep") {
      // Explicitly distinct identity is deterministic across retries/reimports.
      const collision =
        existing.some((old) => old.id === w.id) ||
        peers.some((peer) => peer.workout.id === w.id);
      const sourceId = collision
        ? await hash([
            "confirmed-distinct",
            w.sourceId,
            w.provenance!.summaryHash,
          ])
        : w.sourceId;
      row.incoming = { ...w, id: `act_${sourceId}`, sourceId };
      row.expected = existing.find((old) => old.id === row.incoming.id) ?? null;
      row.action = row.expected
        ? sameRecord(summaryContent(row.expected), summaryContent(row.incoming))
          ? "unchanged"
          : "conflict"
        : "addition";
    }
    rows.push(row);
  }
  // Explicit merge can target a stored import or another incoming preview row. Target values win on conflicts.
  for (const row of rows) {
    const decision = decisions[row.key];
    if (!decision?.startsWith("merge:")) continue;
    const id = decision.slice(6),
      targetRow = rows.find((r) => r.incoming.id === id && r.key !== row.key);
    const saved = existing.find((w) => w.id === id),
      target = saved ?? targetRow?.incoming;
    if (
      !target?.provenance ||
      !row.targets.includes(id) ||
      (target.id === row.incoming.id && !saved) ||
      (targetRow &&
        ["skip", "conflict", "review"].includes(targetRow.action)) ||
      (saved &&
        (await hash(summaryContent(saved))) !== saved.provenance?.summaryHash)
    ) {
      row.action = "review";
      row.notes.push("Choose an unedited imported target first, or keep/skip.");
      continue;
    }
    try {
      const incoming = await mergeSummaries(target, row.incoming);
      if (targetRow) {
        targetRow.incoming = incoming;
        if (saved) targetRow.expected = saved;
        targetRow.action = saved ? "enrichment" : "addition";
      } else
        rows.push({
          key: `merge-${row.key}`,
          incoming,
          expected: saved!,
          action: "enrichment",
          notes: ["Explicit companion merge confirmed."],
          targets: [],
        });
      row.action = "skip";
    } catch {
      row.action = "review";
      row.notes.push(
        "Merge cannot preserve conflicting same-format values; keep separate or skip.",
      );
    }
  }
  const writable = rows.filter(
    (r) => r.action === "addition" || r.action === "enrichment",
  );
  if (new Set(writable.map((r) => r.incoming.id)).size !== writable.length)
    errors.push(
      "Multiple changes target one record. Resolve by merging into one preview row or skipping extras.",
    );
  return { ownerUid: uid, rows, errors };
}
