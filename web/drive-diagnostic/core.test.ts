import { it, expect, vi, afterEach } from "vitest";
import {
  DriveSession,
  SCOPE,
  ORIGIN,
  LIMITS,
  DiagnosticError,
  discovery,
  folderFromUrl,
  localhostOnly,
  type Result,
} from "./core";
const instances: DriveSession[] = [];
afterEach(() => {
  instances.forEach((s) => s.clear());
  instances.length = 0;
});
const response = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) => new Response(JSON.stringify(data), { status, headers });
function session(
  handler: (u: URL, init?: RequestInit) => Response | Promise<Response>,
  clock = () => 1000,
) {
  const events: Result[] = [],
    expired = vi.fn(),
    fetcher = vi.fn(async (u: string | URL | Request, init?: RequestInit) =>
      handler(new URL(String(u)), init),
    );
  const value = new DriveSession(
    (r) => events.push(r),
    expired,
    fetcher as typeof fetch,
    clock,
    async () => {},
  );
  instances.push(value);
  return { value, events, expired, fetcher };
}
const grant = {
  access_token: "synthetic-token-never-real",
  expires_in: 3600,
  scope: SCOPE,
};
async function connected(
  handler: (u: URL, init?: RequestInit) => Response | Promise<Response>,
  clock?: () => number,
) {
  const s = session(
    (u, init) =>
      u.pathname.endsWith("about")
        ? response({
            user: {
              permissionId: "synthetic-drive-a",
              emailAddress: "drive-a@example.invalid",
              me: true,
            },
          })
        : handler(u, init),
    clock,
  );
  s.value.adopt(grant);
  await s.value.identify(new AbortController().signal);
  return s;
}
it("enforces exact localhost development origin, safe folder URLs and no implicit grant", () => {
  expect(() => localhostOnly(ORIGIN, true)).not.toThrow();
  for (const origin of [
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "https://example.invalid",
    "http://localhost.evil:5173",
  ])
    expect(() => localhostOnly(origin, true)).toThrow();
  expect(() => localhostOnly(ORIGIN, false)).toThrow();
  expect(
    folderFromUrl(
      "https://drive.google.com/drive/u/1/folders/synthetic-root?usp=drive_link",
    ),
  ).toBe("synthetic-root");
  for (const url of [
    "https://user:pass@drive.google.com/drive/folders/root",
    "https://drive.google.com.evil/drive/folders/root",
    "https://drive.google.com/file/d/root/view",
    "https://drive.google.com/drive/folders/root?access_token=synthetic",
    "https://drive.google.com/drive/folders/root?resourcekey=synthetic",
  ])
    expect(() => folderFromUrl(url)).toThrow();
});
it("accepts only drive.file token responses and verifies identity with Drive about, never another scope", async () => {
  const s = session(() =>
    response({
      user: {
        permissionId: "synthetic",
        emailAddress: "synthetic@example.invalid",
      },
    }),
  );
  for (const scope of [
    "",
    `${SCOPE} openid`,
    "https://www.googleapis.com/auth/drive.readonly",
  ])
    expect(() => s.value.adopt({ ...grant, scope })).toThrow();
  expect(() => s.value.adopt({ ...grant, expires_in: 0 })).toThrow();
  s.value.adopt(grant);
  await s.value.identify(new AbortController().signal);
  expect(s.value.identity?.email).toBe("synthetic@example.invalid");
  const [u, init] = s.fetcher.mock.calls[0];
  expect(String(u)).toContain("/drive/v3/about?");
  expect(init?.method).toBe("GET");
  expect(String(u)).not.toContain(grant.access_token);
  expect(init?.headers).toEqual({
    Authorization: `Bearer ${grant.access_token}`,
  });
});
it("cannot use a folder URL or download without authorization", async () => {
  const s = session(() => response({}));
  await expect(
    s.value.metadata("synthetic-root", new AbortController().signal),
  ).rejects.toThrow();
  expect(s.fetcher).not.toHaveBeenCalled();
});
it("paginates nested folders, ignores unsupported/shortcut entries and removes private filenames from retained entries/results", async () => {
  const s = await connected((u) =>
    u.searchParams.get("pageToken") === "two"
      ? response({
          files: [
            {
              id: "csv",
              name: "private-do-not-log.csv",
              mimeType: "text/csv",
              size: "3",
            },
          ],
        })
      : u.searchParams.get("q")?.startsWith("'nested'")
        ? response({
            files: [
              {
                id: "tcx",
                name: "private.tcx",
                mimeType: "application/xml",
                size: "4",
              },
            ],
          })
        : response({
            nextPageToken: "two",
            files: [
              {
                id: "nested",
                name: "private-folder",
                mimeType: "application/vnd.google-apps.folder",
              },
              {
                id: "shortcut",
                name: "escape.fit",
                mimeType: "application/vnd.google-apps.shortcut",
              },
            ],
          }),
  );
  const scan = await s.value.scan("root", new AbortController().signal);
  expect(scan.complete).toBe(true);
  expect(scan.pages).toBe(3);
  expect(scan.entries.find((e) => e.id === "tcx")?.depth).toBe(1);
  expect(scan.entries.find((e) => e.id === "shortcut")?.kind).toBe(
    "unsupported",
  );
  expect(JSON.stringify(scan)).not.toContain("private");
  expect(JSON.stringify(s.events)).not.toContain("private");
});
it("bounds repeated pagination and refuses partial listings", async () => {
  const s = await connected(() =>
    response({ files: [], nextPageToken: "same" }),
  );
  const scan = await s.value.scan("root", new AbortController().signal);
  expect(scan.complete).toBe(false);
  expect(scan.pages).toBe(2);
  const partial = await connected(() =>
    response({ files: [], incompleteSearch: true }),
  );
  expect(
    (await partial.value.scan("root", new AbortController().signal)).complete,
  ).toBe(false);
});
it("reports expected future direct/nested IDs separately from HTTP 200 and detects prior/picked/missing items", () => {
  const before = { entries: [], complete: true, pages: 1 };
  const after = {
    entries: [
      { id: "new", kind: "file" as const, format: "CSV", size: 1, depth: 0 },
      {
        id: "folder",
        kind: "folder" as const,
        format: null,
        size: null,
        depth: 1,
      },
      { id: "child", kind: "file" as const, format: "TCX", size: 1, depth: 1 },
    ],
    complete: true,
    pages: 2,
  };
  expect(discovery(before, "new", before).outcome).toBe("FAIL");
  expect(discovery(after, "new", before).outcome).toBe("PASS");
  expect(discovery(after, "child", before, new Set(), "nested").outcome).toBe(
    "PASS",
  );
  expect(discovery(after, "folder", before, new Set(), "folder").outcome).toBe(
    "PASS",
  );
  expect(discovery(after, "new", after).outcome).toBe("FAIL");
  expect(discovery(after, "new", before, new Set(["new"])).outcome).toBe(
    "NOT RUN",
  );
  expect(discovery(after, "", before).outcome).toBe("NOT RUN");
});
it("retries only 429/5xx within a bound and never retries or escalates 403/404", async () => {
  for (const status of [403, 404, 429, 500]) {
    const s = await connected(() =>
      response({ error: { message: "private-name-token-body" } }, status, {
        "Retry-After": "0",
      }),
    );
    await expect(
      s.value.metadata("file", new AbortController().signal),
    ).rejects.toBeInstanceOf(DiagnosticError);
    expect(s.fetcher.mock.calls.length).toBe(
      status === 403 || status === 404 ? 2 : 4,
    );
    expect(JSON.stringify(s.events)).not.toContain("private-name-token-body");
  }
});
it("clears rejected/expired grants and never resolves stale account identity", async () => {
  const s = await connected(() => response({}, 401));
  await expect(
    s.value.metadata("file", new AbortController().signal),
  ).rejects.toMatchObject({ status: 401 });
  expect(s.value.connected).toBe(false);
  expect(s.expired).toHaveBeenCalledWith(401, "File metadata GET");
  let now = 1000;
  const expiry = await connected(
    () => response({}),
    () => now,
  );
  now += 3600001;
  expect(() => expiry.value.tokenForPicker()).toThrow();
  expect(expiry.value.identity).toBeNull();
  let finish!: (r: Response) => void;
  const stale = session(
    () =>
      new Promise<Response>((r) => {
        finish = r;
      }),
  );
  stale.value.adopt(grant);
  const pending = stale.value.identify(new AbortController().signal);
  stale.value.clear();
  finish(response({ user: { permissionId: "old-account" } }));
  await expect(pending).rejects.toThrow();
  expect(stale.value.identity).toBeNull();
});
it("downloads only explicitly requested supported synthetic binaries with byte limits and GET alt=media", async () => {
  const s = await connected((u) =>
    u.searchParams.get("alt") === "media"
      ? new Response(new Uint8Array([1, 2, 3]))
      : response({
          id: "file",
          name: "private.csv",
          mimeType: "text/csv",
          size: "3",
        }),
  );
  const result = await s.value.download("file", new AbortController().signal);
  expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]));
  expect(
    s.fetcher.mock.calls.filter(([u]) => String(u).includes("alt=media")),
  ).toHaveLength(1);
  expect(JSON.stringify(s.events)).not.toContain("private");
  const huge = await connected(() =>
    response({
      id: "file",
      name: "synthetic.fit",
      mimeType: "application/octet-stream",
      size: String(LIMITS.bytes + 1),
    }),
  );
  await expect(
    huge.value.download("file", new AbortController().signal),
  ).rejects.toThrow("limit");
});

it("never retries sooner than a long server Retry-After", async () => {
  const s = await connected(() => response({}, 429, { "Retry-After": "999" }));
  await expect(
    s.value.metadata("file", new AbortController().signal),
  ).rejects.toMatchObject({ status: 429 });
  expect(s.fetcher).toHaveBeenCalledTimes(2);
});
it("fails closed when Drive identity changes under an existing grant", async () => {
  let who = "a";
  const s = session(() => response({ user: { permissionId: who } }));
  s.value.adopt(grant);
  await s.value.identify(new AbortController().signal);
  who = "b";
  await expect(s.value.identify(new AbortController().signal)).rejects.toThrow(
    "identity changed",
  );
  expect(s.value.connected).toBe(false);
  expect(s.expired).toHaveBeenCalledWith(200, "Drive identity GET");
});

it("does not label a metadata denial as an attempted body download", async () => {
  const s = await connected(() => response({}, 403));
  await expect(
    s.value.download("file", new AbortController().signal),
  ).rejects.toThrow("body GET was not attempted");
  expect(
    s.events.find((r) => r.test === "Synthetic file body GET alt=media")
      ?.outcome,
  ).toBe("NOT RUN");
  expect(
    s.fetcher.mock.calls.some(([u]) => String(u).includes("alt=media")),
  ).toBe(false);
});
it("rejects nonstandard metadata and partial body successes with their real HTTP status", async () => {
  const s = await connected(() => response({}, 206));
  await expect(
    s.value.metadata("file", new AbortController().signal),
  ).rejects.toMatchObject({ status: 206 });
  const partial = await connected((u) =>
    u.searchParams.get("alt") === "media"
      ? new Response("partial", { status: 206 })
      : response({ id: "file", name: "synthetic.csv", mimeType: "text/csv" }),
  );
  await expect(
    partial.value.download("file", new AbortController().signal),
  ).rejects.toMatchObject({ status: 206 });
});
