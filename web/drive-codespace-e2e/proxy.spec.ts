import { test, expect } from "@playwright/test";
import { request as httpRequest } from "node:http";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { syntheticCsv } from "../src/services/activities/fixtures";
const host = "synthetic-proxy-test-5173.app.github.dev";
const origin = `https://${host}`;
const backend = "http://127.0.0.1:5173";
const proxyHeaders = {
  Host: "127.0.0.1:5173",
  "X-Forwarded-Host": `${host}:443`,
  "X-Forwarded-Proto": "https",
  "X-Forwarded-Port": "443",
};
function handshake(
  token: string,
  allowed: boolean | "missing" | "backend",
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${backend}/?token=${encodeURIComponent(token)}`, {
      headers: {
        ...proxyHeaders,
        ...(allowed === "missing"
          ? {}
          : {
              Origin:
                allowed === "backend"
                  ? "http://127.0.0.1:5173"
                  : allowed
                    ? origin
                    : "https://evil.example",
            }),
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
        "Sec-WebSocket-Protocol": "vite-hmr",
      },
    });
    req.on("upgrade", (response, socket) => {
      socket.destroy();
      resolve(response.statusCode ?? 0);
    });
    req.on("response", (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    req.on("error", reject);
    req.setTimeout(5000, () =>
      req.destroy(new Error("HMR handshake timed out")),
    );
    req.end();
  });
}
test("actual Vite serves the full module graph through valid proxy headers and rejects spoofed requests/upgrades", async ({
  request,
}) => {
  for (const path of [
    "/",
    "/@vite/client",
    "/main.ts",
    "/core.ts",
    "/style.css",
  ]) {
    const response = await request.get(backend + path, {
      headers: { ...proxyHeaders, Origin: origin },
    });
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
  }
  const client = await (
    await request.get(`${backend}/@vite/client`, {
      headers: { ...proxyHeaders, Origin: origin },
    })
  ).text();
  expect(client).toContain('const socketProtocol = "wss"');
  expect(client).toContain("const hmrPort = 443");
  expect(client).toContain(host);
  const token = /const wsToken = "([^"]+)"/.exec(client)?.[1];
  expect(Boolean(token)).toBe(true);
  expect(await handshake(token!, true)).toBe(101);
  expect(await handshake(token!, false)).toBe(403);
  expect(await handshake(token!, "missing")).toBe(403);
  expect(await handshake(token!, "backend")).toBe(403);
  for (const headers of [
    { ...proxyHeaders, Host: "evil.example", Origin: origin },
    {
      ...proxyHeaders,
      "X-Forwarded-Host": `${host},evil.example`,
      Origin: origin,
    },
    { ...proxyHeaders, Origin: "https://evil.example" },
    { ...proxyHeaders, Origin: "http://localhost:5173" },
  ]) {
    const response = await request.get(`${backend}/main.ts`, { headers });
    expect(response.status()).toBe(403);
    expect(
      Boolean(response.headers()["x-training-hq-boundary"]) ||
        (await response.text()).startsWith("Blocked request."),
    ).toBe(true);
  }
});
for (const originMode of ["public", "omitted", "backend"] as const)
  test(`HTTPS proxy browser loads scripts/imports/worker without Firebase or Google; Origin mode=${originMode}`, async ({
    page,
    context,
  }) => {
    const statuses: { path: string; status: number }[] = [];
    const unexpected: string[] = [];
    const errors: string[] = [];
    const workerMockSocketErrors: string[] = [];
    let workerPhase = false;
    let hmrReady = false;
    page.on("console", (message) => {
      if (message.text() === "[vite] connected.") hmrReady = true;
    });
    page.on("pageerror", (error) => {
      // The mocked worker dev-HMR socket can close before opening. Classify only
      // this EXACT fixture event during the manual worker phase. Real upgrade
      // authorization is independently tested above; no parser/module error is
      // ignored, and no application runtime error handling is changed.
      if (workerPhase && error.message === "WebSocket closed without opened.")
        workerMockSocketErrors.push(error.message);
      else errors.push(error.message);
    });
    await page.route("**/*", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (url.origin !== origin) {
        unexpected.push(url.origin);
        await route.abort();
        return;
      }
      // Models an authenticated forwarding service. No real GitHub cookie, token,
      // private Codespace or Google request is involved in this regression test.
      const headers: Record<string, string> = {
        ...(await req.allHeaders()),
        ...proxyHeaders,
      };
      // Playwright's interception does not include Chromium's on-wire Fetch
      // Metadata. Supply an explicit SAME-ORIGIN fixture, not a claim that we
      // captured live Codespaces/browser headers. Raw negative tests below send
      // cross-site/malformed values directly to the actual Vite guard.
      const resource = req.resourceType();
      const workerEntry = url.searchParams.has("worker_file");
      Object.assign(headers, {
        "sec-fetch-site": resource === "document" ? "none" : "same-origin",
        "sec-fetch-mode":
          resource === "document"
            ? "navigate"
            : workerEntry
              ? "same-origin"
              : resource === "stylesheet"
                ? "no-cors"
                : "cors",
        "sec-fetch-dest":
          resource === "document"
            ? "document"
            : workerEntry
              ? "worker"
              : resource === "stylesheet"
                ? "style"
                : "script",
      });
      delete headers.host;
      if (originMode === "omitted") delete headers.origin;
      if (originMode === "backend" && resource !== "document")
        headers.origin = "http://127.0.0.1:5173";
      const response = await route.fetch({
        url: `${backend}${url.pathname}${url.search}`,
        headers,
      });
      expect(
        response.status(),
        `${url.pathname}: ${response.headers()["x-training-hq-origin-reason"] ?? "no boundary reason"}`,
      ).toBe(200);
      if (originMode === "backend" && resource !== "document")
        expect(response.headers()["x-training-hq-origin-mode"]).toBe(
          "proxy-backend-static",
        );
      statuses.push({ path: url.pathname, status: response.status() });
      await route.fulfill({ response });
    });
    // The HTTP/HMR integration test above exercises the real upgrade/token guard.
    // Keep the browser from contacting GitHub's actual private authentication proxy.
    await context.routeWebSocket(
      (url) => url.protocol === "wss:" && url.hostname === host && !url.port,
      (socket) => {
        socket.send(JSON.stringify({ type: "connected" }));
      },
    );
    await page.goto(origin + "/");
    await expect.poll(() => hmrReady).toBe(true);
    await expect(
      page.getByRole("heading", { name: "Training HQ Drive OAuth diagnostic" }),
    ).toBeVisible();
    await expect(page.locator("#settings-state")).toContainText("missing");
    await expect(page.locator("#connect")).toBeDisabled();
    const workerPath = `/@fs${process.cwd()}/src/services/activities/worker.ts?worker_file&type=module`;
    workerPhase = true;
    const result = await page.evaluate(
      async ({ workerPath, csv }) => {
        const worker = new Worker(workerPath, { type: "module" });
        try {
          return await new Promise<{ activities: number; rejected: number }>(
            (resolve, reject) => {
              const timer = setTimeout(() => {
                worker.terminate();
                reject(new Error("Worker timeout"));
              }, 30000);
              worker.onerror = () => {
                clearTimeout(timer);
                reject(new Error("Worker module load failed"));
              };
              worker.onmessage = (event) => {
                if (event.data.kind === "result") {
                  clearTimeout(timer);
                  resolve({
                    activities: event.data.result.activities.length,
                    rejected: event.data.result.rejected,
                  });
                }
                if (event.data.kind === "error") {
                  clearTimeout(timer);
                  reject(new Error("Synthetic worker parse failed"));
                }
              };
              const bytes = new TextEncoder().encode(csv);
              worker.postMessage(
                {
                  inputs: [{ name: "synthetic.csv", bytes }],
                  offset: "",
                  fallbackType: "Other",
                },
                [bytes.buffer],
              );
            },
          );
        } finally {
          worker.terminate();
        }
      },
      { workerPath, csv: syntheticCsv() },
    );
    expect(result).toEqual({ activities: 1, rejected: 0 });
    for (const path of ["/", "/@vite/client", "/main.ts", "/core.ts"])
      expect(
        statuses.some((r) => r.path === path && r.status === 200),
        path,
      ).toBe(true);
    expect(statuses.every((r) => r.status === 200 || r.status === 304)).toBe(
      true,
    );
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
    expect(workerMockSocketErrors.length).toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(() => ({
        storage: localStorage.length + sessionStorage.length,
        worker: !!navigator.serviceWorker.controller,
      })),
    ).toEqual({ storage: 0, worker: false });
  });

test("CLI cannot expose the listener or change the fixed port", async () => {
  for (const args of [
    ["--host", "0.0.0.0"],
    ["--port", "5174"],
  ]) {
    let failed = false;
    try {
      await promisify(execFile)(
        process.execPath,
        [
          "node_modules/vite/bin/vite.js",
          "--config",
          "vite.drive-codespace.config.ts",
          ...args,
        ],
        {
          env: {
            ...process.env,
            CODESPACES: "true",
            CODESPACE_NAME: "synthetic-proxy-test",
            GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
          },
          timeout: 10000,
        },
      );
    } catch (error) {
      failed = true;
      expect(String(error)).toContain(
        "Codespace diagnostic requires loopback port 5173",
      );
    }
    expect(failed).toBe(true);
  }
});

test("module GETs without Origin use same-origin Fetch Metadata and failures expose only fixed reason codes", async ({
  request,
}) => {
  for (const path of [
    "/main.ts",
    "/@vite/client",
    "/core.ts",
    "/style.css",
    "/",
  ]) {
    const headers = {
      ...proxyHeaders,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode":
        path === "/" ? "navigate" : path === "/style.css" ? "no-cors" : "cors",
      "Sec-Fetch-Dest":
        path === "/" ? "document" : path === "/style.css" ? "style" : "script",
    };
    expect(
      (await request.get(backend + path, { headers })).status(),
      path,
    ).toBe(200);
    if (path !== "/") {
      const response = await request.get(backend + path, {
        headers: { ...headers, "Sec-Fetch-Site": "cross-site" },
      });
      expect(response.status()).toBe(403);
      expect(response.headers()["x-training-hq-boundary"]).toBe("origin");
      expect(response.headers()["x-training-hq-origin-reason"]).toBe(
        "fetch-cross-site",
      );
    }
  }
  for (const [value, reason] of [
    ["null", "origin-null"],
    ["http://localhost:5173", "origin-backend"],
    ["https://synthetic-private.example", "origin-other-https"],
    [`${origin}/path`, "origin-malformed"],
  ]) {
    const response = await request.get(`${backend}/main.ts`, {
      headers: {
        ...proxyHeaders,
        Origin: value,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "script",
        "X-Forwarded-Origin": origin,
      },
    });
    expect(response.status()).toBe(403);
    expect(response.headers()["x-training-hq-origin-reason"]).toBe(reason);
    expect(await response.text()).not.toContain(value);
  }
});

test("rewritten backend Origin requires exact authority, HTTPS forwarding and same-origin read-only resources", async ({
  request,
}) => {
  const headers = {
    ...proxyHeaders,
    Origin: "http://127.0.0.1:5173",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "script",
  };
  for (const path of ["/main.ts", "/@vite/client", "/core.ts"]) {
    const accepted = await request.get(backend + path, { headers });
    expect(accepted.status()).toBe(200);
    expect(accepted.headers()["x-training-hq-origin-mode"]).toBe(
      "proxy-backend-static",
    );
    expect(accepted.headers()["access-control-allow-origin"]).toBe(origin);
    for (const overrides of [
      { "Sec-Fetch-Site": "cross-site" },
      { "Sec-Fetch-Site": "same-site" },
      { "X-Forwarded-Host": `${host},evil.example` },
      { "X-Forwarded-Proto": "http" },
      { Origin: "http://evil.example:5173" },
    ]) {
      expect(
        (
          await request.get(backend + path, {
            headers: { ...headers, ...overrides },
          })
        ).status(),
      ).toBe(403);
    }
  }
  const unproven = await request.get(`${backend}/main.ts`, {
    headers: { Host: "127.0.0.1:5173", Origin: "http://127.0.0.1:5173" },
  });
  expect(unproven.status()).toBe(403);
  expect(unproven.headers()["x-training-hq-origin-reason"]).toBe(
    "origin-backend",
  );
  expect(unproven.headers()["x-training-hq-proxy-check"]).toBe("forwarding");
  expect((await request.post(`${backend}/main.ts`, { headers })).status()).toBe(
    403,
  );
  expect((await request.get(`${backend}/`, { headers })).status()).toBe(403);
});
