import { describe, expect, it } from "vitest";
import {
  codespaceRequestFailure,
  codespaceOriginReason,
  type CodespaceRequest,
} from "./codespace-request";
const host = "synthetic-proxy-test-5173.app.github.dev";
const origin = `https://${host}`;
const request = (
  headers: CodespaceRequest["headers"] = {},
): CodespaceRequest => ({
  headers: { host: "127.0.0.1:5173", ...headers },
  remoteAddress: "127.0.0.1",
});
describe("Codespaces private reverse-proxy boundary", () => {
  it.each([
    { host, origin },
    { host: `${host}:443`, origin },
    { host: "localhost:5173", "x-forwarded-host": host, origin },
    { "x-forwarded-host": `${host}:443`, origin },
    { "x-forwarded-host": host.toUpperCase(), origin: `${origin}:443` },
    {
      "x-forwarded-host": host,
      "x-forwarded-proto": "https",
      "x-forwarded-port": "443",
      origin,
    },
    { forwarded: `for=192.0.2.1;proto=https;host="${host}:443"`, origin },
    { host: "[::1]:5173", origin },
    { origin },
    {}, // Loopback-only readiness probe; browser runtime still requires HTTPS.
    {
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    },
  ])("accepts an exact-origin single proxy hop %#", (headers) => {
    expect(codespaceRequestFailure(request(headers), origin)).toBeNull();
  });
  it.each([
    [{ host: "evil.example", "x-forwarded-host": host }, "host"],
    [{ host: `${host}.evil.example` }, "host"],
    [{ host: `${host}:5173` }, "host"],
    [{ host: undefined }, "host"],
    [{ "x-forwarded-host": "evil.example" }, "forwarded-host"],
    [{ "x-forwarded-host": `${host}, evil.example` }, "forwarded-host"],
    [{ "x-forwarded-host": `${host}:443@evil.example` }, "forwarded-host"],
    [{ "x-forwarded-host": `${host}/path` }, "forwarded-host"],
    [{ "x-forwarded-host": `${host}:5173` }, "forwarded-host"],
    [{ "x-forwarded-host": [host, host] }, "duplicate-header"],
    [{ "x-forwarded-proto": "http" }, "forwarded-protocol"],
    [{ "x-forwarded-proto": "https,http" }, "forwarded-protocol"],
    [{ "x-forwarded-port": "5173" }, "forwarded-port"],
    [{ forwarded: `proto=https;host=${host}, host=evil.example` }, "forwarded"],
    [{ forwarded: `proto=https;host=${host};host=evil.example` }, "forwarded"],
    [{ forwarded: "proto=http;host=evil.example" }, "forwarded"],
    [{ forwarded: "proto=https" }, "forwarded"],
    [
      { origin: "https://evil.example", "x-forwarded-origin": origin },
      "origin",
    ],
    [{ origin: "http://localhost:5173" }, "origin"],
    [{ origin: "null" }, "origin"],
    [{ origin: `${origin}:5173` }, "origin"],
    [{ origin: `${origin}/path` }, "origin"],
    [{ origin: `${origin}#fragment` }, "origin"],
    [{ origin: `https://user@${host}` }, "origin"],
    [{ "sec-fetch-site": "cross-site", "sec-fetch-dest": "script" }, "origin"],
  ] as const)(
    "rejects spoofed, ambiguous or unrelated headers %#",
    (headers, reason) => {
      // Readonly table arrays become regular HTTP header arrays for this fixture.
      expect(
        codespaceRequestFailure(
          request({ ...headers } as CodespaceRequest["headers"]),
          origin,
        ),
      ).toBe(reason);
    },
  );
  it("never trusts forwarded headers from a non-loopback peer or duplicate Host", () => {
    expect(
      codespaceRequestFailure(
        {
          ...request({ "x-forwarded-host": host, origin }),
          remoteAddress: "192.0.2.1",
        },
        origin,
      ),
    ).toBe("peer");
    expect(
      codespaceRequestFailure(
        {
          ...request({ origin }),
          rawHeaders: ["Host", "evil.example", "host", "127.0.0.1:5173"],
        },
        origin,
      ),
    ).toBe("duplicate-header");
  });
  it("requires the approved browser Origin on WebSocket upgrades too", () => {
    expect(codespaceRequestFailure(request(), origin, true)).toBe("origin");
    expect(
      codespaceRequestFailure(request({ origin }), origin, true),
    ).toBeNull();
  });
});

describe("Origin versus browser Fetch Metadata", () => {
  const metadata = {
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "script",
  };
  it.each(["/main.ts", "/@vite/client", "/core.ts", "/style.css", "/"])(
    "accepts same-origin GET %s without Origin",
    (url) => {
      const headers = {
        ...metadata,
        "x-forwarded-host": `${host}:443`,
        "x-forwarded-proto": "https",
        "x-forwarded-port": "443",
        ...(url === "/style.css"
          ? { "sec-fetch-mode": "no-cors", "sec-fetch-dest": "style" }
          : {}),
        ...(url === "/"
          ? { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }
          : {}),
      };
      expect(
        codespaceRequestFailure(
          { ...request(headers), method: "GET", url },
          origin,
        ),
      ).toBeNull();
    },
  );
  it.each([
    [{ ...metadata, origin: "null" }, "origin-null"],
    [{ ...metadata, origin: "http://localhost:5173" }, "origin-backend"],
    [{ ...metadata, origin: "https://other.example" }, "origin-other-https"],
    [{ ...metadata, origin: "http://other.example" }, "origin-other-scheme"],
    [{ ...metadata, origin: `${origin}/path` }, "origin-malformed"],
    [{ ...metadata, origin: `https://user@${host}` }, "origin-malformed"],
    [{ ...metadata, "sec-fetch-site": "cross-site" }, "fetch-cross-site"],
    [{ ...metadata, "sec-fetch-site": "same-site" }, "fetch-same-site"],
    [{ ...metadata, "sec-fetch-site": "none" }, "fetch-site-not-same-origin"],
    [{ ...metadata, "sec-fetch-mode": undefined }, "fetch-metadata-incomplete"],
    [{ ...metadata, "sec-fetch-mode": "websocket" }, "fetch-metadata-invalid"],
    [{ ...metadata, "sec-fetch-site": "made-up" }, "fetch-metadata-invalid"],
    [{ ...metadata, "sec-fetch-dest": "iframe" }, "fetch-metadata-invalid"],
    [{}, "fetch-metadata-missing"],
    [
      {
        ...metadata,
        origin: "https://evil.example",
        "x-forwarded-origin": origin,
      },
      "origin-other-https",
    ],
    [
      { ...metadata, origin, "sec-fetch-site": "cross-site" },
      "fetch-cross-site",
    ],
  ] as const)("rejects and safely classifies request %#", (headers, reason) => {
    const req = { ...request(headers), method: "GET", url: "/main.ts" };
    expect(codespaceRequestFailure(req, origin)).toBe("origin");
    expect(codespaceOriginReason(req, origin)).toBe(reason);
  });
  it("does not let navigation metadata expose module paths or unsafe methods", () => {
    const headers = {
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    };
    expect(
      codespaceRequestFailure({ ...request(headers), url: "/main.ts" }, origin),
    ).toBe("origin");
    expect(
      codespaceOriginReason(
        { ...request({ ...metadata, origin }), method: "POST" },
        origin,
      ),
    ).toBe("unsafe-method");
  });
  it("keeps WebSocket Origin mandatory even with same-origin metadata", () => {
    const req = request({
      ...metadata,
      "sec-fetch-mode": "websocket",
      "sec-fetch-dest": "empty",
    });
    expect(codespaceOriginReason(req, origin, true)).toBe(
      "websocket-origin-missing",
    );
    expect(codespaceRequestFailure(req, origin, true)).toBe("origin");
    expect(
      codespaceRequestFailure(
        request({ ...req.headers, origin }),
        origin,
        true,
      ),
    ).toBeNull();
    expect(
      codespaceRequestFailure(
        request({ ...req.headers, origin: "https://evil.example" }),
        origin,
        true,
      ),
    ).toBe("origin");
  });
});
