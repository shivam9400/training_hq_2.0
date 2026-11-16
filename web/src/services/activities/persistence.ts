import { doc, runTransaction, type Firestore } from "firebase/firestore";
import { schemas } from "../../types/data";
import { sameRecord } from "../planImport";
import {
  ImportCancelled,
  ImportStale,
  type ImportOptions,
} from "../importExecution";
import type { ActivityPreview } from "./preview";
export async function saveActivityImport(
  database: Firestore,
  uid: string,
  preview: ActivityPreview,
  options: ImportOptions,
) {
  const guard = () => {
    options.assertOwner();
    if (options.signal?.aborted) throw new ImportCancelled();
    if (uid !== preview.ownerUid) throw new Error("Account changed");
  };
  guard();
  if (preview.errors.length || preview.rows.some((r) => r.action === "review"))
    throw new Error("Resolve duplicate candidates before confirmation.");
  const rows = preview.rows.filter(
    (r) => r.action === "addition" || r.action === "enrichment",
  );
  if (new Set(rows.map((r) => r.incoming.id)).size !== rows.length)
    throw new Error("Duplicate target");
  let processed = 0,
    written = 0;
  options.onProgress?.(0, rows.length);
  // Rich summary validation has a per-request rules expression budget. Keep chunks small.
  for (let offset = 0; offset < rows.length; offset += 1) {
    guard();
    const chunk = rows.slice(offset, offset + 1);
    const count = await runTransaction(
      database,
      async (tx) => {
        guard();
        const pending = [];
        for (const row of chunk) {
          const incoming = schemas.workouts.parse(row.incoming);
          if (
            incoming.source !== "health-sync" ||
            !incoming.provenance ||
            incoming.id !== `act_${incoming.sourceId}`
          )
            throw new Error("Invalid import");
          const ref = doc(database, "users", uid, "workouts", incoming.id),
            snapshot = await tx.get(ref);
          guard();
          const current = snapshot.exists() ? snapshot.data() : null;
          if (sameRecord(current, incoming)) continue;
          if (!sameRecord(current, row.expected)) throw new ImportStale();
          pending.push({ ref, incoming });
        }
        guard();
        for (const item of pending) tx.set(item.ref, item.incoming);
        return pending.length;
      },
      { maxAttempts: 3 },
    );
    written += count;
    processed += chunk.length;
    options.onProgress?.(processed, rows.length);
  }
  return { written, processed };
}
