import { z } from "zod";
import {
  deleteDoc,
  doc,
  getDocFromServer,
  setDoc,
  type Firestore,
} from "firebase/firestore";
export const folderId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const healthSyncConfig = z
  .object({
    id: z.literal("health-sync"),
    version: z.literal(1),
    folderId,
    access: z.literal("unverified"),
  })
  .strict();
export type HealthSyncConfig = z.infer<typeof healthSyncConfig>;
export const folderUrl = (id: string) =>
  `https://drive.google.com/drive/folders/${folderId.parse(id)}`;
/** Syntax validation only: never a claim of ownership, permission or even existence. */
export function parseFolderUrl(value: string): HealthSyncConfig {
  const invalid = () =>
    new Error(
      "Use a canonical HTTPS Google Drive folder URL without resource keys, credentials or extra parameters.",
    );
  if (value.length > 2048) throw invalid();
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw invalid();
  }
  if (
    url.origin !== "https://drive.google.com" ||
    url.username ||
    url.password ||
    url.hash
  )
    throw invalid();
  const legacy = url.pathname === "/folderview";
  const allowed = legacy ? ["id", "usp", "hl"] : ["usp", "hl"];
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1)
      throw invalid();
  }
  const id = legacy
    ? url.searchParams.get("id")
    : url.pathname.match(
        /^\/drive\/(?:u\/\d{1,2}\/)?folders\/([A-Za-z0-9_-]{1,128})\/?$/,
      )?.[1];
  if (!folderId.safeParse(id).success) throw invalid();
  return healthSyncConfig.parse({
    id: "health-sync",
    version: 1,
    folderId: id,
    access: "unverified",
  });
}
/** uid must come from Firebase's observer; injected guard is rechecked around each request. */
export function healthSyncStore(
  database: Firestore,
  uid: string,
  assertOwner: () => void,
) {
  const ref = doc(database, "users", uid, "integrations", "health-sync");
  return {
    async read() {
      assertOwner();
      const value = await getDocFromServer(ref);
      assertOwner();
      return value.exists() ? healthSyncConfig.parse(value.data()) : null;
    },
    async save(value: HealthSyncConfig) {
      assertOwner();
      const config = healthSyncConfig.parse(value);
      await setDoc(ref, config);
      assertOwner();
      return config;
    },
    async remove() {
      assertOwner();
      await deleteDoc(ref);
      assertOwner();
    },
  };
}
