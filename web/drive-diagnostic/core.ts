export const SCOPE = "https://www.googleapis.com/auth/drive.file";
export const ORIGIN = "http://localhost:5173";
export const MARKER = "LOCAL_DRIVE_DIAGNOSTIC";
export const LIMITS = {
  pages: 25,
  items: 200,
  folders: 30,
  depth: 8,
  bytes: 8 * 1024 * 1024,
  totalBytes: 20 * 1024 * 1024,
};
export type Result = {
  test: string;
  outcome: "PASS" | "FAIL" | "NOT RUN";
  http: number | null;
  explanation: string;
};
export type Identity = {
  permissionId: string;
  email: string | null;
  displayName: string | null;
};
export type Entry = {
  id: string;
  kind: "folder" | "file" | "unsupported";
  format: string | null;
  size: number | null;
  depth: number;
};
export type Scan = { entries: Entry[]; complete: boolean; pages: number };
export class DiagnosticError extends Error {
  constructor(
    public readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}
export const id = (v: unknown): string => {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(v))
    throw new DiagnosticError(null, "Invalid bounded Drive ID.");
  return v;
};
export const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
export function localhostOnly(origin: string, development: boolean): void {
  if (!development || origin !== ORIGIN)
    throw new DiagnosticError(
      null,
      "This diagnostic runs only in development at http://localhost:5173.",
    );
}
export function folderFromUrl(value: string): string {
  if (value.length > 2048)
    throw new DiagnosticError(null, "Folder URL too long.");
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    throw new DiagnosticError(null, "Invalid folder URL.");
  }
  if (
    u.origin !== "https://drive.google.com" ||
    u.username ||
    u.password ||
    u.hash
  )
    throw new DiagnosticError(
      null,
      "Use a canonical private Drive folder URL.",
    );
  for (const key of u.searchParams.keys())
    if (!["usp", "hl"].includes(key) || u.searchParams.getAll(key).length !== 1)
      throw new DiagnosticError(
        null,
        "Remove unsupported query parameters; resource-key links are not supported.",
      );
  return id(
    u.pathname.match(
      /^\/drive\/(?:u\/\d{1,2}\/)?folders\/([A-Za-z0-9_-]{1,128})\/?$/,
    )?.[1],
  );
}
export function safeFailure(error: unknown): {
  status: number | null;
  message: string;
} {
  return error instanceof DiagnosticError
    ? { status: error.status, message: error.message }
    : {
        status: null,
        message:
          "Operation cancelled, timed out or failed. No raw error payload was recorded.",
      };
}
export function discovery(
  scan: Scan,
  expected: string,
  baseline?: Scan,
  selected = new Set<string>(),
  kind: "direct" | "nested" | "folder" = "direct",
): Result {
  const test = `Expected ${baseline ? "new" : "existing"} ${kind} discovery`;
  if (!expected.trim())
    return {
      test,
      outcome: "NOT RUN",
      http: null,
      explanation:
        "Supply the independently known synthetic ID. A successful listing alone cannot prove coverage.",
    };
  const target = id(expected.trim());
  if (!scan.complete || (baseline && !baseline.complete))
    return {
      test,
      outcome: "FAIL",
      http: null,
      explanation: "Listing incomplete; no coverage conclusion is valid.",
    };
  if (baseline?.entries.some((e) => e.id === target))
    return {
      test,
      outcome: "FAIL",
      http: null,
      explanation: "Expected new item already existed in the baseline.",
    };
  if (selected.has(target))
    return {
      test,
      outcome: "NOT RUN",
      http: null,
      explanation:
        "Individual Picker authorization contaminated this item. Use a fresh, never-selected synthetic file.",
    };
  const found = scan.entries.find(
    (e) =>
      e.id === target &&
      (kind === "folder"
        ? e.kind === "folder" && e.depth > 0
        : e.kind === "file" &&
          (kind === "direct" ? e.depth === 0 : e.depth > 0)),
  );
  return {
    test,
    outcome: found ? "PASS" : "FAIL",
    http: 200,
    explanation: found
      ? "Known synthetic item was visible in the completed listing. Download permission is a separate test."
      : "Known synthetic item was not visible. HTTP 200 does not prove this folder is empty or grant inherited.",
  };
}
const abort = (signal: AbortSignal) => {
  if (signal.aborted)
    throw new DiagnosticError(null, "Operation cancelled or timed out.");
};
async function delay(ms: number, signal: AbortSignal) {
  abort(signal);
  await new Promise<void>((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      reject(new DiagnosticError(null, "Operation cancelled."));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal.addEventListener("abort", stop, { once: true });
  });
}
export class DriveSession {
  #token: string | null = null;
  #expires = 0;
  #generation = 0;
  #active = new AbortController();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #downloaded = 0;
  identity: Identity | null = null;
  constructor(
    private readonly emit: (r: Result) => void,
    private readonly invalidated: (status?: number, operation?: string) => void,
    private readonly fetcher: typeof fetch = fetch.bind(globalThis),
    private readonly now = () => Date.now(),
    private readonly pause = delay,
  ) {}
  get generation() {
    return this.#generation;
  }
  get connected() {
    return Boolean(this.#token && this.now() < this.#expires && this.identity);
  }
  get expiresIn() {
    return Math.max(0, Math.ceil((this.#expires - this.now()) / 1000));
  }
  clear() {
    ++this.#generation;
    this.#active.abort();
    this.#active = new AbortController();
    if (this.#timer) clearTimeout(this.#timer);
    this.#token = null;
    this.#expires = 0;
    this.identity = null;
    this.#downloaded = 0;
  }
  adopt(response: unknown) {
    this.clear();
    const r = object(response),
      scopes =
        typeof r.scope === "string"
          ? new Set(r.scope.trim().split(/\s+/))
          : new Set();
    if (
      typeof r.access_token !== "string" ||
      r.access_token.length < 1 ||
      r.access_token.length > 8192 ||
      scopes.size !== 1 ||
      !scopes.has(SCOPE) ||
      typeof r.expires_in !== "number" ||
      !Number.isFinite(r.expires_in) ||
      r.expires_in <= 0
    )
      throw new DiagnosticError(
        null,
        "Token response missing, expired or not restricted to drive.file. No additional scope is accepted.",
      );
    this.#token = r.access_token;
    this.#expires = this.now() + Math.min(r.expires_in, 3600) * 1000;
    this.#timer = setTimeout(
      () => {
        this.clear();
        this.invalidated();
      },
      Math.min(r.expires_in, 3600) * 1000,
    );
  }
  tokenForPicker() {
    return this.token();
  }
  private token() {
    if (!this.#token || this.now() >= this.#expires) {
      this.clear();
      this.invalidated();
      throw new DiagnosticError(
        null,
        "No valid in-memory grant. Connect explicitly.",
      );
    }
    return this.#token;
  }
  private async response(
    path: string,
    query: Record<string, string>,
    external: AbortSignal,
  ): Promise<Response> {
    const generation = this.#generation,
      token = this.token();
    if (!/^(about|files|files\/[A-Za-z0-9_-]{1,128})$/.test(path))
      throw new DiagnosticError(null, "Unsupported read endpoint.");
    const signal = AbortSignal.any([external, this.#active.signal]);
    const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
    url.search = new URLSearchParams(query).toString();
    for (let attempt = 0; attempt < 3; attempt++) {
      abort(signal);
      const timeout = AbortSignal.timeout(10000);
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: AbortSignal.any([signal, timeout]),
        });
      } catch {
        throw new DiagnosticError(
          null,
          "Network request failed or timed out; no payload was logged.",
        );
      }
      abort(signal);
      if (generation !== this.#generation) {
        await response.body?.cancel();
        throw new DiagnosticError(
          null,
          "Account/grant changed; result discarded.",
        );
      }
      if (response.status === 401) {
        await response.body?.cancel();
        this.clear();
        this.invalidated(
          401,
          path === "about"
            ? "Drive identity GET"
            : query.alt === "media"
              ? "Synthetic file body GET alt=media"
              : "File metadata GET",
        );
        throw new DiagnosticError(
          401,
          "Token rejected. Reconnect; no automatic broader consent.",
        );
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        const retry = response.headers.get("Retry-After"),
          numeric = retry ? Number(retry) : NaN;
        const requested = Number.isFinite(numeric)
          ? numeric * 1000
          : retry && Number.isFinite(Date.parse(retry))
            ? Math.max(0, Date.parse(retry) - this.now())
            : null;
        await response.body?.cancel();
        if (requested !== null && requested > 2000)
          throw new DiagnosticError(
            response.status,
            "Server requested a longer backoff than the interactive retry budget. Retry later manually.",
          );
        const ms =
          requested !== null
            ? Math.max(0, requested)
            : Math.min(2000, 250 * 2 ** attempt + Math.random() * 100);
        await this.pause(ms, signal);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new DiagnosticError(
          response.status,
          response.status === 403
            ? "Permission or API-configuration denied. Not proof of revocation; no scope escalation."
            : response.status === 404
              ? "Unavailable or not authorized; 404 does not prove deletion."
              : response.status === 429
                ? "Rate limit persisted after bounded retries."
                : "Drive API failed after bounded retries.",
        );
      }
      return response;
    }
    throw new DiagnosticError(null, "Retry limit.");
  }
  private async json(
    path: string,
    query: Record<string, string>,
    signal: AbortSignal,
  ) {
    const generation = this.#generation;
    const response = await this.response(path, query, signal);
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new DiagnosticError(
        response.status,
        "Unexpected metadata success status; not accepted as a complete JSON response.",
      );
    }
    const bytes = await this.read(response, 1024 * 1024, signal);
    if (generation !== this.#generation)
      throw new DiagnosticError(null, "Stale response discarded.");
    try {
      return object(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
      throw new DiagnosticError(
        response.status,
        "Malformed API JSON; body discarded.",
      );
    }
  }
  private async read(
    response: Response,
    limit: number,
    external: AbortSignal,
    onBytes?: (size: number) => void,
  ): Promise<Uint8Array> {
    const signal = AbortSignal.any([
      external,
      this.#active.signal,
      AbortSignal.timeout(10000),
    ]);
    const declared = Number(response.headers.get("Content-Length"));
    if (declared > limit) {
      await response.body?.cancel();
      throw new DiagnosticError(
        response.status,
        "Response size limit exceeded.",
      );
    }
    const reader = response.body?.getReader();
    if (!reader)
      throw new DiagnosticError(response.status, "Missing response body.");
    const stop = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", stop, { once: true });
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        abort(signal);
        const next = await reader.read();
        abort(signal);
        if (next.done) break;
        size += next.value.length;
        onBytes?.(next.value.length);
        if (size > limit)
          throw new DiagnosticError(
            response.status,
            "Actual response size limit exceeded.",
          );
        parts.push(next.value);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const part of parts) {
        bytes.set(part, at);
        at += part.length;
      }
      return bytes;
    } finally {
      signal.removeEventListener("abort", stop);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  async identify(signal: AbortSignal) {
    const generation = this.#generation;
    const data = await this.json(
        "about",
        { fields: "user(displayName,emailAddress,permissionId,me)" },
        signal,
      ),
      user = object(data.user);
    if (generation !== this.#generation)
      throw new DiagnosticError(null, "Stale identity discarded.");
    if (
      typeof user.permissionId !== "string" ||
      !user.permissionId ||
      user.me === false
    )
      throw new DiagnosticError(
        200,
        "Drive identity was not returned reliably; file tests remain disabled.",
      );
    if (this.identity && this.identity.permissionId !== user.permissionId) {
      this.clear();
      this.invalidated(200, "Drive identity GET");
      throw new DiagnosticError(
        200,
        "Drive identity changed unexpectedly; local grant cleared.",
      );
    }
    this.identity = {
      permissionId: user.permissionId,
      email:
        typeof user.emailAddress === "string"
          ? user.emailAddress.slice(0, 254)
          : null,
      displayName:
        typeof user.displayName === "string"
          ? user.displayName.slice(0, 120)
          : null,
    };
    this.emit({
      test: "Authenticated Drive identity",
      outcome: "PASS",
      http: 200,
      explanation:
        "Drive about.get returned the requesting user under the same drive.file token. No identity scope was requested.",
    });
    return this.identity;
  }
  private requireIdentity() {
    if (!this.connected)
      throw new DiagnosticError(
        null,
        "Connect and verify Drive identity before file tests.",
      );
  }
  async metadata(fileId: string, signal: AbortSignal): Promise<Entry> {
    this.requireIdentity();
    const data = await this.json(
      `files/${id(fileId)}`,
      { fields: "id,name,mimeType,size,trashed", supportsAllDrives: "true" },
      signal,
    );
    if (id(data.id) !== fileId || data.trashed === true)
      throw new DiagnosticError(200, "Unexpected or trashed metadata.");
    return this.entry(data, 0);
  }
  private entry(data: Record<string, unknown>, depth: number): Entry {
    const format =
      typeof data.name === "string"
        ? (data.name.match(/\.(fit|tcx|csv|gpx|kml)$/i)?.[1]?.toUpperCase() ??
          null)
        : null;
    const size =
      typeof data.size === "string" && /^\d+$/.test(data.size)
        ? Number(data.size)
        : null;
    const folder = data.mimeType === "application/vnd.google-apps.folder";
    const virtual =
      typeof data.mimeType === "string" &&
      data.mimeType.startsWith("application/vnd.google-apps.") &&
      !folder;
    return {
      id: id(data.id),
      kind: folder ? "folder" : format && !virtual ? "file" : "unsupported",
      format: virtual ? null : format,
      size: size !== null && Number.isSafeInteger(size) ? size : null,
      depth: folder ? depth + 1 : depth,
    };
  }
  async scan(root: string, signal: AbortSignal): Promise<Scan> {
    this.requireIdentity();
    const generation = this.#generation;
    id(root);
    const result: Scan = { entries: [], complete: false, pages: 0 };
    const queue = [{ id: root, depth: 0 }],
      visited = new Set<string>([root]),
      entries = new Set<string>();
    let folders = 0;
    try {
      while (queue.length) {
        const parent = queue.shift()!;
        if (++folders > LIMITS.folders)
          throw new DiagnosticError(
            null,
            "Folder limit exceeded; traversal incomplete.",
          );
        let page: string | undefined;
        const seenPages = new Set<string>();
        do {
          if (++result.pages > LIMITS.pages)
            throw new DiagnosticError(
              null,
              "Pagination limit exceeded; traversal incomplete.",
            );
          const data = await this.json(
            "files",
            {
              q: `'${parent.id}' in parents and trashed = false`,
              fields:
                "nextPageToken,incompleteSearch,files(id,name,mimeType,size,trashed)",
              pageSize: "100",
              spaces: "drive",
              supportsAllDrives: "true",
              includeItemsFromAllDrives: "true",
              ...(page ? { pageToken: page } : {}),
            },
            signal,
          );
          if (
            !Array.isArray(data.files) ||
            data.files.length > 100 ||
            data.incompleteSearch === true
          )
            throw new DiagnosticError(
              200,
              "Partial or malformed listing; no complete-coverage conclusion.",
            );
          for (const raw of data.files) {
            const value = object(raw);
            if (value.trashed === true) continue;
            const entry = this.entry(value, parent.depth);
            if (entries.has(entry.id)) continue;
            entries.add(entry.id);
            if (result.entries.length >= LIMITS.items)
              throw new DiagnosticError(
                200,
                "Item limit exceeded; traversal incomplete.",
              );
            result.entries.push(entry);
            if (entry.kind === "folder" && !visited.has(entry.id)) {
              if (parent.depth >= LIMITS.depth)
                throw new DiagnosticError(
                  200,
                  "Depth limit exceeded; traversal incomplete.",
                );
              visited.add(entry.id);
              queue.push({ id: entry.id, depth: parent.depth + 1 });
            }
          }
          if (generation === this.#generation && !signal.aborted)
            this.emit({
              test: `Listing page ${result.pages} (depth ${parent.depth})`,
              outcome: "PASS",
              http: 200,
              explanation: `${data.files.length} visible entries. Zero entries never proves an empty folder or inherited access.`,
            });
          if (
            data.nextPageToken !== undefined &&
            (typeof data.nextPageToken !== "string" ||
              data.nextPageToken.length > 2048)
          )
            throw new DiagnosticError(200, "Invalid pagination token.");
          page =
            typeof data.nextPageToken === "string" && data.nextPageToken
              ? data.nextPageToken
              : undefined;
          if (page && seenPages.has(page))
            throw new DiagnosticError(
              200,
              "Repeated pagination token; traversal incomplete.",
            );
          if (page) seenPages.add(page);
        } while (page);
      }
      result.complete = true;
    } catch (error) {
      if (generation !== this.#generation || signal.aborted)
        throw new DiagnosticError(
          null,
          "Traversal cancelled or account changed; partial data discarded.",
        );
      const failure = safeFailure(error);
      if (generation === this.#generation && !signal.aborted)
        this.emit({
          test: "Traversal completion",
          outcome: "FAIL",
          http: failure.status,
          explanation: failure.message,
        });
    }
    return result;
  }
  async download(fileId: string, signal: AbortSignal) {
    const generation = this.#generation;
    let entry: Entry;
    try {
      entry = await this.metadata(fileId, signal);
    } catch (error) {
      if (generation === this.#generation && !signal.aborted) {
        const failure = safeFailure(error);
        this.emit({
          test: "Selected file metadata GET",
          outcome: "FAIL",
          http: failure.status,
          explanation: failure.message,
        });
        this.emit({
          test: "Synthetic file body GET alt=media",
          outcome: "NOT RUN",
          http: null,
          explanation:
            "Metadata checks failed; no body request was sent. No download permission conclusion.",
        });
      }
      throw new DiagnosticError(
        null,
        "Download workflow stopped at metadata; body GET was not attempted.",
      );
    }
    if (generation !== this.#generation)
      throw new DiagnosticError(null, "Download account changed.");
    this.emit({
      test: "Selected synthetic file metadata",
      outcome: "PASS",
      http: 200,
      explanation:
        "Metadata readable; body access still requires a separate GET.",
    });
    if (entry.kind !== "file" || !entry.format)
      throw new DiagnosticError(
        200,
        "Only explicit synthetic FIT/TCX/CSV/GPX/KML binaries are supported; no Google document export or shortcuts.",
      );
    if (entry.size !== null && entry.size > LIMITS.bytes)
      throw new DiagnosticError(200, "File exceeds diagnostic download limit.");
    const remaining = Math.min(
      LIMITS.bytes,
      LIMITS.totalBytes - this.#downloaded,
    );
    if (remaining <= 0)
      throw new DiagnosticError(
        null,
        "Session download budget exhausted; disconnect to clear memory.",
      );
    const response = await this.response(
      `files/${id(fileId)}`,
      { alt: "media", supportsAllDrives: "true" },
      signal,
    );
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new DiagnosticError(
        response.status,
        "Partial/nonstandard body response rejected; complete download not proven.",
      );
    }
    const bytes = await this.read(response, remaining, signal, (count) => {
      this.#downloaded += count;
    });
    if (generation !== this.#generation)
      throw new DiagnosticError(null, "Stale downloaded bytes discarded.");
    if (entry.size !== null && entry.size !== bytes.length)
      throw new DiagnosticError(
        200,
        "Downloaded size differs from metadata; bytes discarded.",
      );
    this.emit({
      test: "Synthetic file body GET alt=media",
      outcome: "PASS",
      http: response.status,
      explanation: `${bytes.length} bytes received in memory. No body, filename or ID is included in results.`,
    });
    return { bytes, format: entry.format };
  }
}
