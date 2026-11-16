import { defineConfig, mergeConfig, type UserConfig } from "vite";
import { codespaceRequestFailure } from "./drive-diagnostic/codespace-request.ts";
import localConfig from "./vite.drive-test.config.ts";
import { codespaceSite, csp } from "./drive-diagnostic/runtime.ts";
export default defineConfig(async (env) => {
  if (env.command !== "serve" || process.env.CODESPACES !== "true")
    throw new Error(
      "Codespaces-only development command; no hosted deployment.",
    );
  const site = codespaceSite(
      process.env.CODESPACE_NAME ?? "",
      process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? "app.github.dev",
    ),
    origin = new URL(site).origin,
    hostname = new URL(site).hostname;
  const base =
    typeof localConfig === "function"
      ? await localConfig(env)
      : await localConfig;
  const overlay: UserConfig = {
    envDir: false,
    envPrefix: [],
    define: {
      __DRIVE_TEST_CONFIG__: JSON.stringify({
        mode: "codespace",
        siteUrl: site,
        clientId: "",
        pickerKey: "",
        appId: "",
      }),
    },
    server: {
      host: "127.0.0.1",
      origin,
      ws: { protocol: "wss", host: hostname, clientPort: 443 },
      forwardConsole: false,
      port: 5173,
      strictPort: true,
      allowedHosts: [hostname],
      cors: { origin },
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "strict-origin",
        "Content-Security-Policy": `${csp("codespace", origin)}; frame-ancestors 'none'`,
      },
    },
    plugins: [
      {
        name: "private-codespace-origin",
        load(id) {
          if (
            /node_modules\/(?:@firebase|firebase)\//.test(id) ||
            /src\/services\/(?:firebase|store)\.ts/.test(id)
          )
            throw new Error("Firebase forbidden in diagnostic.");
        },
        configResolved(config) {
          if (
            config.server.host !== "127.0.0.1" ||
            config.server.port !== 5173 ||
            config.server.allowedHosts === true
          )
            throw new Error(
              "Codespace diagnostic requires loopback port 5173 and an explicit host allowlist.",
            );
        },
        configureServer(server) {
          const failure = (
            req: import("node:http").IncomingMessage,
            upgrade = false,
          ) =>
            codespaceRequestFailure(
              {
                headers: req.headers,
                rawHeaders: req.rawHeaders,
                remoteAddress: req.socket.remoteAddress,
              },
              origin,
              upgrade,
            );
          server.middlewares.use((req, res, next) => {
            const reason = failure(req);
            if (reason) {
              res.writeHead(403, {
                "Content-Type": "text/plain",
                "Cache-Control": "no-store",
                "X-Training-HQ-Boundary": reason,
              });
              res.end(`Codespace diagnostic request denied (${reason}).`);
              return;
            }
            next();
          });
          // Upgrade requests bypass Connect middleware. Validate them before
          // Vite handles the socket; its own WebSocket token check stays enabled.
          server.httpServer?.prependListener("upgrade", (req, socket) => {
            if (failure(req, true)) {
              socket.write(
                "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
              );
              socket.destroy();
            }
          });
        },
      },
    ],
  };
  return mergeConfig({ ...base, plugins: [] }, overlay);
});
