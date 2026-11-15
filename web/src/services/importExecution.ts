import { doc, runTransaction, type Firestore } from "firebase/firestore";
import { schemas, type PlanRecord } from "../types/data";
import { sameRecord, type ImportPreview } from "./planImport";
export const IMPORT_CHUNK_SIZE = 20;
export class ImportCancelled extends Error {
  constructor() {
    super("Import cancelled. Committed chunks remain saved.");
  }
}
export class ImportStale extends Error {
  constructor() {
    super(
      "Records changed after preview. Refresh and preview again; committed chunks remain saved.",
    );
  }
}
export interface ImportOptions {
  signal?: AbortSignal;
  assertOwner: () => void;
  onProgress?: (processed: number, total: number) => void;
}
/** No credentials or private values are logged. Caller binds uid to the active Auth observer; rules reauthorize every write. */
export async function executeImport(
  database: Firestore,
  uid: string,
  preview: ImportPreview,
  options: ImportOptions,
) {
  const guard = () => {
    options.assertOwner();
    if (uid !== preview.ownerUid)
      throw new Error("Preview belongs to another account");
    if (options.signal?.aborted) throw new ImportCancelled();
  };
  guard();
  if (preview.errors.length)
    throw new Error("Resolve import errors before writing");
  const incomingPlan = schemas.plans.parse(preview.plan);
  const planRef = doc(database, "users", uid, "plans", incomingPlan.id);
  const targetPlan: PlanRecord =
    preview.planKind === "conflict" || preview.planKind === "unchanged"
      ? preview.expectedPlan!
      : incomingPlan;
  if (!targetPlan) throw new Error("Invalid preview");
  await runTransaction(
    database,
    async (transaction) => {
      guard();
      const snapshot = await transaction.get(planRef);
      guard();
      const current = snapshot.exists() ? snapshot.data() : null;
      if (sameRecord(current, targetPlan)) return; // Retry after a confirmed/ambiguous previous commit.
      if (!sameRecord(current, preview.expectedPlan)) throw new ImportStale();
      if (!["addition", "change"].includes(preview.planKind))
        throw new ImportStale();
      transaction.set(planRef, targetPlan);
    },
    { maxAttempts: 3 },
  );
  const writes = preview.rows.filter(
    (row) => row.kind === "addition" || row.kind === "change",
  );
  let processed = 0,
    written = 0;
  options.onProgress?.(0, writes.length);
  for (let offset = 0; offset < writes.length; offset += IMPORT_CHUNK_SIZE) {
    guard();
    const chunk = writes.slice(offset, offset + IMPORT_CHUNK_SIZE);
    const count = await runTransaction(
      database,
      async (transaction) => {
        guard();
        const plan = await transaction.get(planRef);
        guard();
        if (!plan.exists() || !sameRecord(plan.data(), targetPlan))
          throw new ImportStale();
        const pending = [];
        for (const change of chunk) {
          const incoming = schemas.sessions.parse(change.incoming);
          if (
            incoming.planId !== targetPlan.id ||
            incoming.importSource?.sourceId !==
              targetPlan.importSource?.sourceId
          )
            throw new Error("Source identity mismatch");
          const ref = doc(database, "users", uid, "sessions", incoming.id);
          const snapshot = await transaction.get(ref);
          guard();
          const current = snapshot.exists() ? snapshot.data() : null;
          if (sameRecord(current, incoming)) continue;
          if (!sameRecord(current, change.expected)) throw new ImportStale();
          pending.push({ ref, incoming });
        }
        guard();
        for (const item of pending) transaction.set(item.ref, item.incoming);
        return pending.length;
      },
      { maxAttempts: 3 },
    );
    written += count;
    processed += chunk.length;
    options.onProgress?.(processed, writes.length);
  }
  return { written, processed };
}
