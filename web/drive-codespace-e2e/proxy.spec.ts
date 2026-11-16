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
function handshake(token: string, allowed: boolean): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${backend}/?token=${encodeURIComponent(token)}`, {
      headers: {
        ...proxyHeaders,
        Origin: allowed ? origin : "https://evil.example",
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
test("HTTPS proxy browser loads scripts, imports and the actual parser worker with CSP and no Firebase/Google contact", async ({
  page,
}) => {
  const statuses: { path: string; status: number }[] = [];
  const unexpected: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
      ...req.headers(),
      ...proxyHeaders,
    };
    delete headers.host;
    const response = await route.fetch({
      url: `${backend}${url.pathname}${url.search}`,
      headers,
    });
    statuses.push({ path: url.pathname, status: response.status() });
    await route.fulfill({ response });
  });
  // The HTTP/HMR integration test above exercises the real upgrade/token guard.
  // Keep the browser from contacting GitHub's actual private authentication proxy.
  await page.routeWebSocket(
    (url) => url.protocol === "wss:" && url.hostname === host && !url.port,
    (socket) => {
      socket.send(JSON.stringify({ type: "connected" }));
    },
  );
  await page.goto(origin + "/");
  await expect(
    page.getByRole("heading", { name: "Training HQ Drive OAuth diagnostic" }),
  ).toBeVisible();
  await expect(page.locator("#settings-state")).toContainText("missing");
  await expect(page.locator("#connect")).toBeDisabled();
  const workerPath = `/@fs${process.cwd()}/src/services/activities/worker.ts?worker_file&type=module`;
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
