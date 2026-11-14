import {
  collection,
  doc,
  documentId,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  setDoc,
  startAfter,
  writeBatch,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import {
  collections,
  emptyRecords,
  schemas,
  validateRow,
  type Collection,
  type Records,
  type Row,
} from "../types/data";
/** uid is captured from the authenticated observer, never supplied by a form or URL. Rules remain the authorization boundary. */
export function userStore(uid: string) {
  const guard = () => {
    if (!db || !auth?.currentUser || auth.currentUser.uid !== uid)
      throw new Error("Account changed. Reload your data.");
    if (!navigator.onLine)
      throw new Error("Reconnect before accessing cloud data.");
    return db;
  };
  async function readAll(): Promise<Records> {
    const result = emptyRecords();
    for (const name of collections) {
      let last: QueryDocumentSnapshot | undefined;
      let count = 0;
      do {
        const database = guard();
        const ref = collection(database, "users", uid, name);
        const page = await getDocsFromServer(
          query(
            ref,
            orderBy(documentId()),
            ...(last ? [startAfter(last)] : []),
            limit(200),
          ),
        );
        guard();
        for (const item of page.docs) {
          const row = schemas[name].parse(item.data());
          if (row.id !== item.id) throw new Error("Stored identity mismatch");
          // Each union member has been validated with its collection schema.
          (result[name] as Row[]).push(row);
        }
        count += page.size;
        if (count > 10000)
          throw new Error(
            "Dataset exceeds browser safety limit. Use a controlled export before continuing.",
          );
        last = page.size === 200 ? page.docs.at(-1) : undefined;
      } while (last);
    }
    return result;
  }
  return {
    readAll,
    async save(name: Collection, row: Row) {
      const data = validateRow(name, row);
      await setDoc(doc(guard(), "users", uid, name, data.id), data);
      guard();
    },
    async deleteAll() {
      // Bounded batches, idempotent and resumable if interrupted. Only known owner paths.
      for (const name of collections) {
        for (;;) {
          const database = guard();
          const page = await getDocsFromServer(
            query(collection(database, "users", uid, name), limit(100)),
          );
          guard();
          if (page.empty) break;
          const batch = writeBatch(database);
          page.docs.forEach((item) => batch.delete(item.ref));
          await batch.commit();
          guard();
        }
      }
    },
  };
}
