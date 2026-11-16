// Transport validation, not authentication. Only GitHub's PRIVATE forwarding
// service authenticates the user. Never trust these headers on a public listener.
type Headers = Record<string, string | string[] | undefined>;
export type CodespaceRequest = {
  headers: Headers;
  rawHeaders?: readonly string[];
  remoteAddress?: string;
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
  const value = headers.origin;
  if (value !== undefined) {
    if (
      typeof value !== "string" ||
      !value.startsWith("https://") ||
      !external(value.slice(8))
    )
      return "origin";
  } else if (
    upgrade ||
    (headers["sec-fetch-site"] === "cross-site" &&
      !(
        headers["sec-fetch-mode"] === "navigate" &&
        headers["sec-fetch-dest"] === "document"
      ))
  )
    return "origin";
  return null;
}
