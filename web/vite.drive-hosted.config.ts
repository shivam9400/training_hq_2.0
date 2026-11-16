import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { hostedSite, csp } from "./drive-diagnostic/runtime.ts";
export default defineConfig(() => {
  const site = hostedSite(process.env.DRIVE_DIAGNOSTIC_SITE_URL ?? "");
  return {
    root: fileURLToPath(new URL("drive-diagnostic/", import.meta.url)),
    base: site.base,
    envDir: false,
    envPrefix: [],
    publicDir: false,
    define: {
      __DRIVE_TEST_CONFIG__: JSON.stringify({
        mode: "hosted",
        siteUrl: site.url,
        clientId: "",
        pickerKey: "",
        appId: "",
      }),
    },
    build: {
      outDir: "../drive-hosted-dist",
      emptyOutDir: true,
      sourcemap: false,
    },
    plugins: [
      {
        name: "isolated-hosted-diagnostic",
        configureServer() {
          throw new Error(
            "Use the hosted build or the preserved localhost diagnostic.",
          );
        },
        load(id) {
          if (
            /node_modules\/(?:@firebase|firebase)\//.test(id) ||
            /src\/services\/(?:firebase|store)\.ts/.test(id)
          )
            throw new Error(
              "Firebase is forbidden in hosted diagnostic assets.",
            );
        },
        transformIndexHtml: {
          order: "post",
          handler: () => [
            {
              tag: "meta",
              attrs: {
                "http-equiv": "Content-Security-Policy",
                content: csp("hosted", site.origin),
              },
              injectTo: "head-prepend",
            },
          ],
        },
        generateBundle() {
          this.emitFile({ type: "asset", fileName: ".nojekyll", source: "" });
          this.emitFile({
            type: "asset",
            fileName: "404.html",
            source:
              "<!doctype html><meta charset=utf-8><title>Diagnostic route unavailable</title><p>Open the exact temporary diagnostic site root. No OAuth redirect route is used.</p>",
          });
        },
      },
    ],
  };
});
