// Transport validation, not authentication. Only GitHub's PRIVATE forwarding
// service authenticates the user. Never trust these headers on a public listener.
type Headers = Record<string, string | string[] | undefined>;
export type CodespaceRequest = {
  headers: Headers;
  rawHeaders?: readonly string[];
  remoteAddress?: string;
  method?: string;
  url?: string;
};
export type BoundaryFailure =
  | "peer"
  | "duplicate-header"
  | "host"
  | "forwarded-host"
  | "forwarded-protocol"
  | "forwarded-port"
  | "forwarded"
  | "origin";
const checked = new Set([
  "host",
  "origin",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-dest",
]);
export function codespaceRequestFailure(
  request: CodespaceRequest,
  origin: string,
  upgrade = false,
): BoundaryFailure | null {
  const { headers, rawHeaders = [], remoteAddress } = request;
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress ?? ""))
    return "peer";
  const seen = new Set<string>();
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const key = rawHeaders[i].toLowerCase();
    if (checked.has(key) && seen.has(key)) return "duplicate-header";
    seen.add(key);
  }
  for (const key of checked)
    if (Array.isArray(headers[key])) return "duplicate-header";
  const hostname = new URL(origin).hostname;
  const external = (value: unknown) =>
    typeof value === "string" &&
    [hostname, `${hostname}:443`].includes(value.trim().toLowerCase());
  const host = headers.host;
  if (
    !external(host) &&
    !["localhost:5173", "127.0.0.1:5173", "[::1]:5173"].includes(
      typeof host === "string" ? host.trim().toLowerCase() : "",
    )
  )
    return "host";
  // Validate Host independently: X-Forwarded-Host cannot rescue an unrelated Host.
  if (
    headers["x-forwarded-host"] !== undefined &&
    !external(headers["x-forwarded-host"])
  )
    return "forwarded-host";
  if (
    headers["x-forwarded-proto"] !== undefined &&
    headers["x-forwarded-proto"] !== "https"
  )
    return "forwarded-protocol";
  if (
    headers["x-forwarded-port"] !== undefined &&
    headers["x-forwarded-port"] !== "443"
  )
    return "forwarded-port";
  const forwarded = headers.forwarded;
  if (forwarded !== undefined) {
    // One unambiguous hop only; never choose a convenient member of a proxy chain.
    if (
      typeof forwarded !== "string" ||
      forwarded.length > 2048 ||
      /[,\\\r\n]/.test(forwarded)
    )
      return "forwarded";
    const parts = new Map<string, string>();
    for (const pair of forwarded.split(";")) {
      const match = /^\s*([a-z]+)=(?:"([^"\s]+)"|([^"\s]+))\s*$/i.exec(pair);
      if (!match || parts.has(match[1].toLowerCase())) return "forwarded";
      parts.set(match[1].toLowerCase(), match[2] ?? match[3]);
    }
    if (!external(parts.get("host")) || parts.get("proto") !== "https")
      return "forwarded";
  }
  return codespaceOriginReason(request, origin, upgrade) ? "origin" : null;
}

// Fixed enums only: never return the received origin, hostname, path or tokens.
export type OriginReason =
  | "origin-null"
  | "origin-backend"
  | "origin-other-https"
  | "origin-other-scheme"
  | "origin-malformed"
  | "websocket-origin-missing"
  | "fetch-cross-site"
  | "fetch-same-site"
  | "fetch-site-not-same-origin"
  | "fetch-metadata-incomplete"
  | "fetch-metadata-invalid"
  | "fetch-metadata-missing"
  | "unsafe-method";
export function codespaceOriginReason(
  request: CodespaceRequest,
  origin: string,
  upgrade = false,
): OriginReason | null {
  const { headers } = request;
  if (!["GET", "HEAD"].includes(request.method ?? "GET"))
    return "unsafe-method";
  const value = headers.origin;
  if (value !== undefined) {
    if (value === "null") return "origin-null";
    if (typeof value !== "string" || !/^https?:\/\/[^/?#\s]+$/i.test(value))
      return "origin-malformed";
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return "origin-malformed";
    }
    if (parsed.username || parsed.password) return "origin-malformed";
    if (parsed.origin !== origin) {
      if (
        ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) &&
        parsed.port === "5173"
      )
        return "origin-backend";
      return parsed.protocol === "https:"
        ? "origin-other-https"
        : "origin-other-scheme";
    }
  } else if (upgrade) return "websocket-origin-missing";

  const site = headers["sec-fetch-site"],
    mode = headers["sec-fetch-mode"],
    dest = headers["sec-fetch-dest"];
  const metadata = [site, mode, dest];
  if (metadata.every((part) => part === undefined)) {
    if (value !== undefined) return null; // Exact Origin from a non-browser client.
    // Only a loopback root readiness probe may lack both Origin and Fetch Metadata.
    const root = ["/", "/index.html"].includes(request.url ?? "/");
    return root &&
      ["localhost:5173", "127.0.0.1:5173", "[::1]:5173"].includes(
        String(headers.host),
      )
      ? null
      : "fetch-metadata-missing";
  }
  if (metadata.some((part) => part === undefined))
    return "fetch-metadata-incomplete";
  if (metadata.some((part) => typeof part !== "string"))
    return "fetch-metadata-invalid";
  if (
    !["same-origin", "same-site", "cross-site", "none"].includes(String(site))
  )
    return "fetch-metadata-invalid";
  // A user may arrive from github.com, a bookmark or the address bar. This
  // exception serves only the root document, never cross-origin module bodies.
  if (
    !upgrade &&
    mode === "navigate" &&
    dest === "document" &&
    ["/", "/index.html"].includes(request.url ?? "/")
  )
    return null;
  if (site === "cross-site") return "fetch-cross-site";
  if (site === "same-site") return "fetch-same-site";
  if (site !== "same-origin") return "fetch-site-not-same-origin";
  if (upgrade)
    return mode === "websocket" && dest === "empty"
      ? null
      : "fetch-metadata-invalid";
  if (
    !["cors", "same-origin", "no-cors"].includes(String(mode)) ||
    ![
      "script",
      "style",
      "worker",
      "sharedworker",
      "empty",
      "image",
      "font",
    ].includes(String(dest))
  )
    return "fetch-metadata-invalid";
  return null;
}
