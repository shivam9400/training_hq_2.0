import { describe, expect, it } from "vitest";
import {
  codespaceRequestFailure,
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
    { host },
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
