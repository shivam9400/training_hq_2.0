import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "/training_hq_2.0/",
  envPrefix: "VITE_FIREBASE_",
  plugins: [
    {
      name: "exclude-local-drive-diagnostic",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          let path = req.url ?? "";
          try {
            path = decodeURIComponent(path).replaceAll("\\", "/");
          } catch {
            res.statusCode = 400;
            res.end();
            return;
          }
          if (/drive-(?:diagnostic|hosted|codespace)/i.test(path)) {
            res.statusCode = 404;
            res.end();
            return;
          }
          next();
        });
      },
    },
    {
      name: "production-diagnostic-module-boundary",
      apply: "build",
      load(id) {
        if (id.replaceAll("\\", "/").includes("/drive-diagnostic/"))
          throw new Error(
            "Diagnostic modules cannot enter the production application.",
          );
      },
    },
    react(),
    {
      name: "production-content-security-policy",
      apply: "build",
      transformIndexHtml: {
        order: "post",
        handler: () => [
          {
            tag: "meta",
            attrs: {
              "http-equiv": "Content-Security-Policy",
              content:
                "default-src 'self'; script-src 'self' https://apis.google.com; style-src 'self'; img-src 'self' data:; connect-src 'self' https://*.googleapis.com https://apis.google.com https://*.firebaseio.com; frame-src https://*.firebaseapp.com https://accounts.google.com; object-src 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com",
            },
            injectTo: "head-prepend",
          },
        ],
      },
    },
  ],
  build: {
    sourcemap: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "firebase-firestore",
              test: /node_modules\/@firebase\/firestore/,
            },
            { name: "firebase-auth", test: /node_modules\/@firebase\/auth/ },
            {
              name: "react",
              test: /node_modules\/(react|react-dom|scheduler)\//,
            },
          ],
        },
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts", "drive-diagnostic/**/*.test.ts"],
    environment: "node",
  },
});
