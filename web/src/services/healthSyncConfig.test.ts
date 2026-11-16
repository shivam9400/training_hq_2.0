import { describe, it, expect } from "vitest";
import {
  folderUrl,
  healthSyncConfig,
  parseFolderUrl,
} from "./healthSyncConfig";
const id = "synthetic-folder-reference-0001";
describe("private folder references, never authorization", () => {
  it("accepts canonical, account-indexed and legacy folder URLs without retaining query metadata", () => {
    for (const url of [
      ` https://drive.google.com/drive/folders/${id}?usp=drive_link `,
      `https://drive.google.com/drive/u/1/folders/${id}/`,
      `https://drive.google.com/folderview?id=${id}&hl=en`,
    ]) {
      const value = parseFolderUrl(url);
      expect(value).toEqual({
        id: "health-sync",
        version: 1,
        folderId: id,
        access: "unverified",
      });
      expect(folderUrl(value.folderId)).toBe(
        `https://drive.google.com/drive/folders/${id}`,
      );
      expect(JSON.stringify(value)).not.toContain("usp");
    }
  });
  it("rejects other hosts, files, credentials, tokens, fragments, encoded paths, duplicate parameters and excessive input", () => {
    for (const value of [
      "",
      "javascript:alert(1)",
      `http://drive.google.com/drive/folders/${id}`,
      `https://drive.google.com.evil.example/drive/folders/${id}`,
      `https://drive.google.com:444/drive/folders/${id}`,
      `https://user:pass@drive.google.com/drive/folders/${id}`,
      `https://drive.google.com/file/d/${id}/view`,
      `https://docs.google.com/drive/folders/${id}`,
      `https://drive.google.com/drive/folders/${id}%2Fchild`,
      `https://drive.google.com/drive/folders/${id}#token`,
      `https://drive.google.com/drive/folders/${id}?access_token=synthetic`,
      `https://drive.google.com/drive/folders/${id}?resourcekey=synthetic`,
      `https://drive.google.com/folderview?id=${id}&id=other`,
      `https://drive.google.com/drive/folders/${"x".repeat(129)}`,
      "x".repeat(2049),
    ])
      expect(() => parseFolderUrl(value)).toThrow();
  });
  it("cannot claim verified access or persist tokens, Google identity, raw files or UID fields", () => {
    const value = parseFolderUrl(
      `https://drive.google.com/drive/folders/${id}`,
    );
    for (const patch of [
      { access: "verified" },
      { version: 2 },
      { uid: "synthetic-user" },
      { accessToken: "synthetic" },
      { googleSubject: "synthetic" },
      { files: [] },
    ])
      expect(healthSyncConfig.safeParse({ ...value, ...patch }).success).toBe(
        false,
      );
  });
});
