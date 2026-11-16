import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
const web = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig(({ command, mode }) => {
  const env =
    command === "serve" ? loadEnv(mode, web, "VITE_GOOGLE_DRIVE_TEST_") : {};
  return {
    root: fileURLToPath(new URL("drive-diagnostic/", import.meta.url)),
    envDir: web,
    envPrefix: [],
    publicDir: false,
    cacheDir: fileURLToPath(
      new URL("node_modules/.vite-drive-diagnostic", import.meta.url),
    ),
    optimizeDeps: {
      include: [
        "fit-file-parser",
        "fit-file-parser/raw",
        "fit-file-parser/encoder",
        "fit-file-parser/profile",
        "@zip.js/zip.js",
        "fast-xml-parser",
        "papaparse",
        "zod",
      ],
    },
    base: "/",
    define: {
      __DRIVE_TEST_CONFIG__: JSON.stringify({
        clientId: env.VITE_GOOGLE_DRIVE_TEST_CLIENT_ID ?? "",
        pickerKey: env.VITE_GOOGLE_DRIVE_TEST_PICKER_API_KEY ?? "",
        appId: env.VITE_GOOGLE_DRIVE_TEST_APP_ID ?? "",
      }),
    },
    server: {
      host: "localhost",
      port: 5173,
      strictPort: true,
      allowedHosts: ["localhost"],
      cors: { origin: "http://localhost:5173" },
      fs: { strict: true, allow: [web] },
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "strict-origin",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client https://apis.google.com https://www.gstatic.com; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:5173 https://www.googleapis.com https://accounts.google.com https://oauth2.googleapis.com; frame-src https://accounts.google.com https://docs.google.com https://drive.google.com; img-src 'self' data: https://*.googleusercontent.com https://www.gstatic.com; object-src 'none'; base-uri 'none'; form-action https://accounts.google.com; frame-ancestors 'none'",
      },
    },
    build: {
      outDir: "../drive-diagnostic-dist",
      emptyOutDir: true,
      sourcemap: false,
    },
    plugins: [
      {
        name: "local-test-boundary",
        configureServer(server) {
          if (
            server.config.server.host !== "localhost" ||
            server.config.server.port !== 5173
          )
            throw new Error(
              "Diagnostic bind address/port cannot be overridden.",
            );
          server.middlewares.use((req, res, next) => {
            if (
              req.headers.host !== "localhost:5173" ||
              (req.headers.origin &&
                req.headers.origin !== "http://localhost:5173")
            ) {
              res.statusCode = 403;
              res.end("Local diagnostic origin required.");
              return;
            }
            next();
          });
        },
        load(id) {
          if (
            /node_modules\/(?:@firebase|firebase)\//.test(id) ||
            /src\/services\/(?:firebase|store)\.ts/.test(id)
          )
            throw new Error("Firebase is forbidden in the Drive diagnostic.");
        },
      },
    ],
  };
});
