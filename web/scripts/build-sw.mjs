import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = "/training_hq_2.0/";
const assets = [
  "index.html",
  "activity-parser-licenses.txt",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "manifest.webmanifest",
];
for (const file of await readdir("dist/assets")) {
  if (/\.(js|css|png|svg|woff2)$/.test(file)) assets.push(`assets/${file}`);
}
const hash = createHash("sha256");
for (const path of assets) hash.update(await readFile(`dist/${path}`));
const name = `training-hq-shell-${hash.digest("hex").slice(0, 16)}`;
// The allowlist is generated ONLY from public build outputs, never API responses.
await writeFile(
  "dist/sw.js",
  `
const NAME = ${JSON.stringify(name)};
const BASE = ${JSON.stringify(base)};
const FILES = ${JSON.stringify(assets.map((file) => base + file))};
self.addEventListener('install', event => event.waitUntil(caches.open(NAME).then(cache => cache.addAll(FILES))));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('training-hq-shell-') && key !== NAME) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search) return;
  const path = url.pathname === BASE ? BASE + 'index.html' : url.pathname;
  if (!FILES.includes(path)) return;
  event.respondWith(caches.open(NAME).then(async cache => (await cache.match(path)) || fetch(event.request)));
});
`,
);
