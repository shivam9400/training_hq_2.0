# Codespaces diagnostic proxy fix

**Latest live finding:** `X-Training-HQ-Origin-Reason: origin-backend` confirms
that module requests reach Vite with a loopback Origin. See the
[constrained backend-Origin compatibility fix](#confirmed-backend-origin-compatibility-fix)
and exact restart commands below. The fix has **not been verified in a real Codespace**.
Earlier investigations below are retained as migration/debugging history.

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

## Confirmed backend-Origin compatibility fix

The owner subsequently observed `origin-backend` on the live forwarded module
requests. This confirms that the middleware sees a loopback Origin on port 5173;
it does not identify which proxy hop rewrote it, the exact loopback spelling or
the remaining forwarding/Fetch Metadata headers. Previous statements that the live
Origin class was entirely unknown are historical; it is now known to be backend.

Vite already has `server.origin` set to the computed public HTTPS origin and its
WebSocket client pinned to public WSS/443. The installed Vite API describes
server.origin as **the origin for generated asset URLs**, not an incoming-header
rewrite setting. The boundary runs before module transforms; neither our code nor
the inspected Vite request handling assigns the incoming Origin to localhost.
A browser document at the public HTTPS URL would normally send its public Origin
for CORS module fetches. The backend value is therefore consistent with an upstream
tunnel/proxy compatibility rewrite; the precise component is **not traced or proven**.
Changing generated URLs again cannot repair a header already rewritten upstream.
No undocumented proxy switch, CORS wildcard or incoming-Origin rewrite is used.

References: [Vite server.origin](https://vite.dev/config/server-options#server-origin),
[GitHub Codespaces forwarding](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace).
GitHub documents HTTP/HTTPS forwarding protocol selection; it does not establish
the complete on-wire Origin behavior for this particular private session. Public
HTTPS terminates before our plain-HTTP loopback Vite listener. Keep the backend
forwarding protocol HTTP for that listener; this does not change the public HTTPS URL.

### Narrow compatibility branch

An internal Origin is accepted **only when all checks pass**:

1. The Codespaces-only server is bound to 127.0.0.1:5173, and the socket peer is
   loopback. Existing raw-header duplication, Host and forwarding validation runs.
2. Origin is exactly HTTP localhost:5173, 127.0.0.1:5173 or [::1]:5173. Host must
   match that backend authority, or be the exact retained public Codespaces authority
   (optionally :443). Unknown hosts and a mismatched loopback Host fail.
3. X-Forwarded-Host must independently equal the computed public Codespaces host
   (optionally :443), and X-Forwarded-Proto must be https. A supplied forwarded port
   must be 443. Supplied RFC Forwarded information must agree. No header chain,
   duplicate authority or X-Forwarded-Origin hint can substitute for these checks.
4. Method is explicitly GET/HEAD. Fetch Metadata must say same-origin, with a
   compatible script/worker/style/image/font destination and read mode. Missing
   metadata, same-site, cross-site, navigation and general fetch destinations fail.
5. Only static code/asset extensions and /@vite/client or /@vite/env qualify. Root
   documents, APIs, raw CSV/FIT files, unsafe paths and unsupported methods do not.
   Vite's strict filesystem allow/deny checks remain in force afterward.
6. This exception **never applies to WebSocket upgrades**. HMR still needs the
   approved public HTTPS Origin and Vite's token. If a live proxy also rewrites HMR
   Origin, that connection remains refused; this change does not claim to solve it.

No request Origin is overwritten or promoted to a trusted public Origin; CORS still
returns only the configured public origin. Private forwarding authentication is
provided by GitHub, **not by these headers**. The server checks loopback transport
and request consistency; it cannot cryptographically identify a GitHub proxy,
authenticate a local process or infer the platform's Private/Public setting.
Local processes inside the Codespace remain trusted. Keep the forward PRIVATE;
no visibility setting is changed automatically. Do not expose this server through
another tunnel or public listener. No Cloud, Firebase, Drive or production change.

### Safe response classifications

Accepted rewritten static requests carry
`X-Training-HQ-Origin-Mode: proxy-backend-static`. A public-Origin or missing-Origin
request does not falsely receive that marker. Rejected backend-Origin HTTP requests
retain `origin-backend` and add `X-Training-HQ-Proxy-Check`, a fixed enum:
`backend-authority`, `forwarding`, `fetch-site`, `fetch-mode-dest`, `resource`,
`transport`, `method` or `websocket`. Earlier guards may reject first with their
existing reason. These classifications contain no header values, tokens, names,
file IDs or private data and are not logged or exported.

### Update and restart the existing Codespace

In its existing browser terminal, press **Ctrl+C** to stop the old server. These
commands use the existing checkout; they do not clone, reset, force-push or deploy:

```sh
cd "$(git rev-parse --show-toplevel)"
git status --short
git switch feat/hosted-drive-oauth-diagnostic
git pull --ff-only origin feat/hosted-drive-oauth-diagnostic
cd web
npm ci
npm run dev:drive-codespace
```

If status shows local edits or fast-forward fails, preserve those edits and resolve
the checkout state before continuing; do not reset it to make the commands succeed.
In **Ports**, verify 5173 visibility is **Private**, backend protocol HTTP, and choose
**Open in Browser** in a top-level tab. Keep the URL's public HTTPS scheme. Complete
GitHub's private-port sign-in there and reload the exact root with no query/hash.
Optional read-only visibility inspection from another Codespace terminal:

```sh
gh codespace ports -c "$CODESPACE_NAME"
```

Check /main.ts and /@vite/client return 200. If the compatibility branch is used,
confirm the acceptance marker above. If either still fails, report only the fixed
boundary/origin/proxy-check codes, not headers, cookies, a HAR or private metadata.
No OAuth test is performed merely by loading the page.

**Verification boundary:** automated tests use synthetic proxy headers and an actual
local Vite server/module worker. The implementation has **not** been verified in a
real authenticated Codespace browser. The owner's earlier live origin-backend result
is evidence for the old rejection, not evidence that this new fix works live.
