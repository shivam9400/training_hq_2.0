import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "/training_hq_2.0/",
  plugins: [
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
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
