import { defineConfig, mergeConfig, type UserConfig } from "vite";
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
      host: "0.0.0.0",
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
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const host = req.headers["x-forwarded-host"] ?? req.headers.host;
            if (
              ![hostname, "localhost:5173"].includes(String(host)) ||
              (req.headers.origin && req.headers.origin !== origin)
            ) {
              res.statusCode = 403;
              res.end("Codespace origin required.");
              return;
            }
            next();
          });
        },
      },
    ],
  };
  return mergeConfig({ ...base, plugins: [] }, overlay);
});
