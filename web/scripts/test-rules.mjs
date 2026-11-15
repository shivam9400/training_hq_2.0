import { spawn } from "node:child_process";
// Demo emulator only. Capture bounded startup diagnostics, never test records or credentials.
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
let startup = "",
  started = false;
function relay(stream, bytes) {
  const text = bytes.toString();
  stream.write(bytes);
  if (!started) {
    const marker = text.indexOf("Running script");
    startup = (startup + (marker < 0 ? text : text.slice(0, marker))).slice(
      -12000,
    );
    if (marker >= 0) started = true;
  }
}
child.stdout.on("data", (bytes) => relay(process.stdout, bytes));
child.stderr.on("data", (bytes) => relay(process.stderr, bytes));
child.on("error", () => {
  console.error("Unable to start demo emulator test command.");
  process.exitCode = 1;
});
child.on("close", (code) => {
  if (code !== 0 && !started && process.env.CI) {
    const message = startup
      .replaceAll("%", "%25")
      .replaceAll("\r", "%0D")
      .replaceAll("\n", "%0A");
    console.error(`::error title=Demo emulator startup::${message}`);
  }
  process.exitCode = code ?? 1;
});
