# Codespaces diagnostic proxy fix

**Latest live finding:** the response says `X-Training-HQ-Boundary: origin`.
That is a different gate from the earlier host reproduction below. See
[the origin investigation and safe reason-code table](#confirmed-live-origin-rejection-second-investigation).
The precise live Origin/Fetch Metadata remains unavailable; no value is guessed.

The original middleware used:

```ts
const host = req.headers["x-forwarded-host"] ?? req.headers.host;
if (![hostname, "localhost:5173"].includes(String(host)) ||
    (req.headers.origin && req.headers.origin !== origin)) {
  // 403
}
```

## Reproduced cause

Against the original Vite server, a synthetic request for `/main.ts` with
`Host: localhost:5173`, `X-Forwarded-Host: <expected-host>:443` and the correct HTTPS
Origin returned **403, Codespace origin required**. The **first condition** rejected
the authority's default port. With `Host: 127.0.0.1:5173` and no forwarded host,
that same condition also returned 403. The bare expected forwarded hostname returned
200. An unrelated Origin was correctly rejected by the second condition and remains
rejected. These results reproduce code paths; the actual user's Codespaces headers
and authentication session were not captured, so their precise variant is unconfirmed.

CSS requests commonly omit Origin, while module requests include it. CSS success
alone cannot prove that the module requests have the same proxy headers. HTTP 403
can also come from Vite's built-in Host validation or GitHub's authentication proxy;
CSP failures alone do not explain an HTTP 403 response from the server.

## Fix and boundaries

- Validate Host independently from forwarded headers. Accept only the exact
  computed Codespaces hostname (optionally `:443`) or the fixed loopback backend
  authority on port 5173. Normalize hostname case/default HTTPS port, not arbitrary
  ports, suffixes, credentials, paths or proxy chains.
- Validate any supplied X-Forwarded-Host, proto, port and single-hop Forwarded
  header against the same HTTPS target. Conflicting, repeated, array-valued or
  ambiguous authority headers fail closed. A forwarded hostname never overrides
  an unrelated Host. A local Origin never substitutes for the approved HTTPS Origin.
- Bind **127.0.0.1:5173**, refuse a non-loopback socket peer and reject CLI attempts
  to override the listener/port. Header validation is transport checking, not
  authentication: an arbitrary local process can manufacture headers. GitHub's
  authenticated **Private** port forward remains the external security boundary.
  The app cannot verify or change the platform's port visibility. Keep it Private.
- Pin Vite server.origin and WebSocket host/protocol/clientPort to the computed
  HTTPS host and WSS port 443. Keep explicit allowedHosts, same-origin CORS, strict
  CSP (including exact WSS origin, worker-src self and frame-ancestors none), fs
  restrictions, the browser runtime allowlist and Vite's WebSocket token check.
  An explicit client port prevents Vite's direct-backend HMR fallback.
- Apply validation to WebSocket upgrades too: they bypass Connect middleware.
  Require the exact browser Origin for upgrades. Disable dev console forwarding,
  so diagnostic browser errors are not forwarded into terminal logs.
- A rejected HTTP request handled by our guard returns a fixed reason code in
  `X-Training-HQ-Boundary` and the response body, never header values, URLs, tokens
  or private metadata. Vite may reject an unrelated Host first with its own message.

No authentication bypass, public port, wildcard host, CSP removal, Firebase change,
OAuth scope change, Cloud setting, production deployment or Drive access is involved.
The hosted static build and the original localhost diagnostic remain separate.

## Browser recovery, no local clone

In the existing Codespace terminal, stop the old server with Ctrl+C, update the
existing feature branch using a normal fast-forward pull (preserve any local work),
and restart `cd web && npm run dev:drive-codespace`. Keep Ports > 5173 **Private**.
Use **Open in Browser** in a top-level tab at the exact HTTPS forwarded origin.
Do not paste localhost URLs into the browser or use an embedded preview.

If GitHub redirects a module request to `github.dev/pf-signin`, complete GitHub's
private-port sign-in by opening the forwarded **root page as a top-level navigation**
in the same browser/profile. Then reload. A module's background fetch cannot
reliably complete an interactive cross-origin sign-in redirect. Do not add
`github.dev/pf-signin` to CORS/CSP, bypass cookies, proxy credentials or change the
port to Public. If the problem persists, inspect only the failing request's HTTP
status and fixed boundary reason in DevTools; do not publish cookies, bearer tokens,
private headers or a HAR. A missing boundary marker may mean Vite or GitHub rejected
it before this guard. Actual GitHub authentication behavior requires a live session.

## Confirmed live `origin` rejection: second investigation

A live `X-Training-HQ-Boundary: origin` confirms that the previous **host** fix
was not sufficient. It does **not** reveal the received Origin value: the original
code used the same result for an explicit Origin mismatch, missing-Origin cross-site
subresources and a missing-Origin WebSocket upgrade. In particular, the old code
already accepted missing-Origin requests labelled same-origin. We have not captured
the live request headers and do not claim the live value is localhost, null or any
other guessed value.

The decision now uses the HTTP method, target, Origin and Fetch Metadata together:

- GET/HEAD modules, stylesheet, imports and worker requests can omit Origin when
  Sec-Fetch-Site is **same-origin**, mode is cors/same-origin/no-cors and destination
  is an allowed static resource. Regression tests exercise `/main.ts`, `/@vite/client`,
  `/core.ts`, `/style.css`, `/` and the actual parser worker.
- Explicit Origin must still be the exact approved HTTPS origin. `null`, backend
  localhost, another HTTPS host, credentials, paths and malformed values fail even
  if Sec-Fetch-Site says same-origin. X-Forwarded-Origin has no authority.
- Same-site is not same-origin. Cross-site/same-site subresources are refused;
  top-level read-only root document navigation is allowed so GitHub sign-in can
  start. Navigation metadata cannot expose module paths across origins.
- Without Origin or any Fetch Metadata, only a loopback root readiness probe is
  allowed. Incomplete/invalid Fetch Metadata is rejected, not interpreted as proof
  of a same-origin browser. Unsafe methods are rejected.
- WebSocket upgrades always require an approved explicit Origin, including when
  Fetch Metadata says same-origin. No missing-Origin HTTP exception applies to HMR.

### Safe next diagnostic, without sharing headers

Only this development server adds a second **fixed enum**, on denied HTTP requests:
`X-Training-HQ-Origin-Reason`. No header values, URLs, cookies, tokens or identifiers
are logged or returned. Inspect this enum on the failing `/main.ts` response:

| Reason | Meaning / next step |
| --- | --- |
| origin-null | Explicit opaque `null` Origin; use a top-level tab, not a sandboxed preview. |
| origin-backend | Origin identifies a loopback backend on port 5173; it is deliberately not accepted as the browser's HTTPS identity. |
| origin-other-https | Explicit HTTPS Origin differs from the computed Codespaces origin; check that the running server and opened Codespace correspond. No actual hostname is exposed. |
| origin-other-scheme / origin-malformed | Unsupported scheme or a non-origin value; no bypass is applied. |
| fetch-cross-site / fetch-same-site | Subresource is not classified as same-origin; complete private-port sign-in by navigating to the root, then reload the exact site. |
| fetch-site-not-same-origin | Subresource site classification is neither same-origin nor a permitted root navigation. |
| fetch-metadata-missing / fetch-metadata-incomplete / fetch-metadata-invalid | Missing/partial/contradictory browser evidence; no raw metadata is exposed. |
| unsafe-method | Only GET/HEAD static reads are supported. |

The WebSocket-specific internal classification `websocket-origin-missing` is covered
by regression tests; rejected upgrades close with 403. These classes identify the
remaining gate, not a successful authorization or permission grant. If the live
page still fails, report **only the enum**, not a HAR or raw headers. Private-port
visibility, host/forwarded-header checks, CSP, Firebase isolation and drive.file-only
OAuth remain unchanged. No production setting or deployment was touched.
