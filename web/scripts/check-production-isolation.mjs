// Firebase Auth legitimately includes the gapi loader; distinguish diagnostic-specific code.
import { readdir, readFile } from "node:fs/promises";
const forbidden = [
  "LOCAL_DRIVE_DIAGNOSTIC",
  "HOSTED_DRIVE_DIAGNOSTIC",
  "drive-hosted-dist",
  "DRIVE_DIAGNOSTIC_SITE_URL",
  "VITE_GOOGLE_DRIVE_TEST_",
  "drive-diagnostic",
  "accounts.google.com/gsi/client",
  "SYNTHETIC_DIAGNOSTIC_EXCLUSION_",
];
async function check(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = `${path}/${entry.name}`;
    if (entry.isDirectory()) {
      await check(name);
      continue;
    }
    if (forbidden.some((value) => name.includes(value)))
      throw new Error("Diagnostic output path found in production.");
    if (/\.(js|html|json|webmanifest|txt)$/.test(name)) {
      const text = await readFile(name, "utf8");
      if (forbidden.some((value) => text.includes(value)))
        throw new Error(
          "Diagnostic code/config found in production assets or service worker.",
        );
    }
  }
}
await check("dist");
console.log(
  "Production isolation check passed: local diagnostic and SDK entry points absent.",
);
