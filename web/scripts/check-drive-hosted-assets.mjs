import { readdir, readFile } from "node:fs/promises";
const root = "drive-hosted-dist";
let html = "";
async function visit(path) {
  for (const item of await readdir(path, { withFileTypes: true })) {
    const name = `${path}/${item.name}`;
    if (item.isDirectory()) {
      await visit(name);
      continue;
    }
    if (/\.map$|\/(?:sw\.js|service-worker\.js|\.env[^/]*)$/.test(name))
      throw new Error("Forbidden map/worker/environment in hosted output.");
    if (/\.(html|js)$/.test(name)) {
      const text = await readFile(name, "utf8");
      if (name === `${root}/index.html`) html = text;
      if (
        /sourceMappingURL|VITE_FIREBASE_|firebaseapp\.com|firestore\.googleapis\.com|SYNTHETIC_HOSTED_CREDENTIAL_SENTINEL/.test(
          text,
        )
      )
        throw new Error(
          "Hosted output contains forbidden source map/Firebase/build credential marker.",
        );
    }
  }
}
await visit(root);
if (
  !html.includes("Content-Security-Policy") ||
  !html.replaceAll("&#39;", "'").includes("worker-src 'self'")
)
  throw new Error("Hosted CSP missing.");
console.log(
  "Hosted asset isolation check passed (no maps, service worker, Firebase or build credential markers).",
);
