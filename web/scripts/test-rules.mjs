import { spawn } from "node:child_process";
// Demo emulator only; all test records are synthetic. Bounded CI diagnostics never use live credentials.
const child = spawn(
  "firebase",
  [
    "emulators:exec",
    "--config",
    "../firebase.json",
    "--project",
    "demo-training-hq",
    "--only",
    "firestore",
    "vitest run --config vitest.rules.config.ts",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let first = "",
  last = "";
function relay(stream, bytes) {
  const text = bytes.toString();
  stream.write(bytes);
  first = (first + text).slice(0, 5000);
  last = (last + text).slice(-7000);
}
child.stdout.on("data", (bytes) => relay(process.stdout, bytes));
child.stderr.on("data", (bytes) => relay(process.stderr, bytes));
child.on("error", () => {
  console.error("Unable to start demo emulator test command.");
  process.exitCode = 1;
});
child.on("close", (code) => {
  if (code !== 0 && process.env.CI) {
    const message = `${first}\n[Bounded diagnostic tail]\n${last}`
      .replaceAll("%", "%25")
      .replaceAll("\r", "%0D")
      .replaceAll("\n", "%0A");
    console.error(`::error title=Demo emulator validation::${message}`);
  }
  process.exitCode = code ?? 1;
});
