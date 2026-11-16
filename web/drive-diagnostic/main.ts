import {
  DriveSession,
  DiagnosticError,
  MARKER,
  discovery,
  folderFromUrl,
  id,
  safeFailure,
  type Result,
  type Scan,
} from "./core";
import { assertRuntime, publicSettings, type RuntimeMode } from "./runtime";
import {
  authorize,
  PickerBridge,
  prepareIdentity,
  identityReady,
} from "./google";
import {
  syntheticCsv,
  syntheticFit,
  syntheticTcx,
  syntheticGpx,
  START,
} from "../src/services/activities/fixtures";
import { consolidate } from "../src/services/activities/preview";
import type { InputFile, ParsedFiles } from "../src/services/activities/model";
declare const __DRIVE_TEST_CONFIG__: {
  mode: RuntimeMode;
  siteUrl: string;
  clientId: string;
  pickerKey: string;
  appId: string;
};
const app = document.querySelector<HTMLDivElement>("#app")!;
try {
  assertRuntime(
    __DRIVE_TEST_CONFIG__.mode,
    __DRIVE_TEST_CONFIG__.siteUrl,
    location.href,
    import.meta.env.DEV,
    window.top !== window.self,
  );
  if (navigator.serviceWorker?.controller)
    throw new Error("Existing service worker");
} catch {
  app.textContent =
    "Diagnostic blocked: wrong origin/path, framing or an existing service worker. Open the exact approved test URL in a clean browser profile.";
  throw new Error("Diagnostic runtime boundary refused.");
}
const field = (key: string, label: string, type = "text") =>
  `<label>${label}<input id="${key}" type="${type}" autocomplete="off" spellcheck="false" maxlength="${type === "url" ? 2048 : 128}"></label>`;
const button = (key: string, label: string, source = true) =>
  `<button id="${key}" ${source ? "data-source" : ""}>${label}</button>`;
const hosted = __DRIVE_TEST_CONFIG__.mode !== "local";
let credentials = {
  clientId: __DRIVE_TEST_CONFIG__.clientId,
  pickerKey: __DRIVE_TEST_CONFIG__.pickerKey,
  appId: __DRIVE_TEST_CONFIG__.appId,
};
app.innerHTML = `<h1>Training HQ Drive OAuth diagnostic</h1><p class="banner">Synthetic test data only. No Firebase, uploads or production sync. Scope: drive.file. Drive requests are GET only. Folder metadata success is not child-file permission proof.</p><p>${hosted ? "HOSTED_DRIVE_DIAGNOSTIC" : MARKER} · ${location.origin} · no service worker</p>
${hosted ? `<section><h2>Temporary browser-only test settings</h2><p>Public test identifiers stay in this tab's memory. Use the replacement test client. Never enter a Client Secret, refresh token or service-account credential. Nothing is saved or included in this site's build.</p>${field("test-client", "Replacement test OAuth Web Client ID")}${field("test-key", "Public Picker browser API key (not a Client Secret)", "password")}${field("test-app", "Numeric test project number")}${button("apply-settings", "Apply test settings in memory", false)}<p id="settings-state">Test settings missing; Google controls remain disabled.</p></section>` : ""}
<section><h2>1. Explicit account authorization</h2>${button("prepare", "Load Google Identity test SDK (no authorization)", false)}${button("connect", "Connect Test Google Account", false)}${button("disconnect", "Disconnect locally / clear all", false)}<button id="probe" data-connected>Probe current Drive identity</button><button id="expire" data-connected>Simulate local expiry (not revocation)</button><p id="identity">Drive identity not verified.</p><p id="expiry"></p><label>Manual Firebase matrix context — not verified authentication<select id="case"><option value="none">Choose case</option><option value="same">Firebase A in separate app window + expected Drive A</option><option value="different">Firebase A in separate app window + expected Drive B</option></select></label><p>This diagnostic never reads/signs into Firebase. Verify Firebase A separately in the normal app. Only the Drive account is verified here using authenticated about.get; the case label is not identity evidence.</p></section>
<section><h2>2. Folder and existing-file experiment</h2><label><input id="synthetic" type="checkbox"> I confirm this folder and all selected/downloaded files are owner-created synthetic samples, not private Health Sync records.</label>${field("folder", "Private synthetic folder URL", "url")}${button("choose-folder", "Select synthetic folder through Picker")}${button("metadata", "Test folder metadata only")}<p>Picker uses the same grant. A folder selection only fills the URL; no metadata/listing/download runs automatically.</p>${field("existing-direct", "Known existing direct file ID")}${field("existing-nested", "Known existing nested file ID")}${button("baseline", "Scan existing nested files — establish baseline")}<p id="scan-summary">No listing performed.</p></section>
<section><h2>3. Future-file experiment with the same issued grant</h2><p>After baseline, use another account or external app to upload a NEW synthetic file, then a NEW subfolder with a NEW file. Do not select those files individually in Picker before this experiment. Reconnection does not erase prior Google grants; use fresh, never-selected samples.</p>${field("new-direct", "Known NEW direct file ID")}${field("new-folder", "Known NEW subfolder ID")}${field("new-nested", "Known NEW nested file ID")}${button("future", "Rescan with the previously issued grant")}<p id="contamination"></p></section>
<section><h2>4. Per-file Picker fallback and explicit downloads</h2>${button("choose-files", "Select individual synthetic files through Picker")}<p>Run individual selection last: it can change per-file authorization and contaminate the folder-inheritance experiment. Selection is not a download.</p>${field("known-download", "Known synthetic file ID for an independent download workflow")}${button("known-body", "Test known synthetic ID download workflow")}<div id="files"></div>${button("parse", "Parse and deduplicate downloaded synthetic bytes locally")}<p id="parsed">No bytes parsed. No save-to-Firebase control exists.</p></section>
<section><h2>Generate synthetic fixtures locally</h2><p>These buttons create local downloads only. Upload them manually using another approved app/account. All routes/HR samples are invented; never use real exports.</p><div id="fixtures"></div></section><p id="notice" role="status"></p>
<section><h2>Permission outcomes — memory only</h2><p>PASS applies only to the named operation. Empty successful listing is not evidence of full visibility. Discovery of known IDs and body downloads have separate results. No names, IDs, emails, bodies or tokens appear in this table or logs.</p><div class="scroll"><table><thead><tr><th>Test</th><th>Result</th><th>HTTP</th><th>Explanation</th></tr></thead><tbody id="results"></tbody></table></div></section>`;
const el = <T extends HTMLElement>(name: string) =>
  document.getElementById(name) as T;
const input = (name: string) => el<HTMLInputElement>(name);
let unsafeWorker = false;
let rows: Result[] = [],
  epoch = 0,
  busy = false,
  controller: AbortController | null = null,
  worker: Worker | null = null;
let root: string | null = null,
  metadataRoot: string | null = null,
  attemptedRoot: string | null = null,
  wrongRootType = false,
  baseline: Scan | null = null,
  latest: Scan | null = null,
  baselineGrant = -1,
  pickerUsed = false;
const picked = new Set<string>();
let downloads: InputFile[] = [];
const picker = new PickerBridge();
function results() {
  const body = el("results");
  body.replaceChildren();
  for (const r of rows) {
    const tr = document.createElement("tr");
    for (const value of [
      r.test,
      r.outcome,
      r.http === null ? "—" : String(r.http),
      r.explanation,
    ]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    body.append(tr);
  }
}
function add(r: Result) {
  rows.push(r);
  if (rows.length > 150) rows.shift();
  results();
}
function notice(text: string) {
  el("notice").textContent = text;
}
const session = new DriveSession(add, (status) =>
  disconnect(
    "Token expired/rejected; local state cleared. Google consent was not revoked.",
    status ?? null,
  ),
);
function update() {
  el<HTMLButtonElement>("connect").disabled =
    busy || !credentials.clientId || !identityReady() || unsafeWorker;
  el<HTMLButtonElement>("prepare").disabled =
    busy || unsafeWorker || (hosted && !credentials.clientId);
  if (hosted) {
    el<HTMLButtonElement>("apply-settings").disabled = busy;
    el("settings-state").textContent = credentials.clientId
      ? "Test settings loaded in memory only; values are not shown or persisted."
      : "Test settings missing; Google controls remain disabled.";
  }
  document
    .querySelectorAll<HTMLButtonElement>("[data-connected]")
    .forEach((b) => (b.disabled = busy || !session.connected));
  document
    .querySelectorAll<HTMLButtonElement>("[data-source]")
    .forEach(
      (b) =>
        (b.disabled =
          busy || !session.connected || !input("synthetic").checked),
    );
  document
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select")
    .forEach((i) => (i.disabled = busy));
  const who = session.identity;
  el("identity").textContent = who
    ? `Verified requesting Drive account: ${who.email ?? who.displayName ?? "email/name unavailable"}. Permission identifier retained in memory only, not shown.`
    : "Drive identity not verified.";
  el("expiry").textContent = session.connected
    ? `In-memory token: at most ${session.expiresIn} seconds remaining. No refresh token.`
    : "No usable in-memory access token.";
  el("contamination").textContent = pickerUsed
    ? "Individual Picker was used in this session: folder-inheritance conclusions disabled. Reconnecting does not remove prior Google grants."
    : "No individual Picker selection in this session. Prior Google grants are unknown; use fresh samples.";
}
function clearSource() {
  root = null;
  metadataRoot = null;
  attemptedRoot = null;
  wrongRootType = false;
  baseline = null;
  latest = null;
  baselineGrant = -1;
  downloads.forEach((f) => f.bytes.fill(0));
  downloads = [];
  el("files").replaceChildren();
  el("scan-summary").textContent = "No listing performed.";
  el("parsed").textContent =
    "No bytes parsed. No save-to-Firebase control exists.";
}
function resetFields() {
  document.querySelectorAll<HTMLInputElement>("input").forEach((i) => {
    if (i.type === "checkbox") i.checked = false;
    else i.value = "";
  });
  el<HTMLSelectElement>("case").value = "none";
}
function disconnect(
  message = "Disconnected locally. Google login/consent was not revoked.",
  status: number | null = null,
  operation = "Token/identity request rejected",
) {
  ++epoch;
  controller?.abort();
  controller = null;
  worker?.terminate();
  worker = null;
  picker.close();
  session.clear();
  busy = false;
  clearSource();
  picked.clear();
  pickerUsed = false;
  resetFields();
  rows = [];
  results();
  if (status !== null)
    add({
      test: operation,
      outcome: "FAIL",
      http: status,
      explanation:
        "Local state cleared. The status alone does not identify expiry versus revoked consent or configuration denial.",
    });
  notice(message);
  update();
}
async function run(
  test: string,
  action: (signal: AbortSignal, current: number) => Promise<void>,
) {
  if (busy) return;
  const current = ++epoch;
  controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(90000),
  ]);
  busy = true;
  notice("Running explicitly triggered test…");
  update();
  try {
    await action(signal, current);
    if (current === epoch)
      notice(
        "Test completed. Interpret each operation separately; no universal folder-grant conclusion is implied.",
      );
  } catch (error) {
    if (current === epoch) {
      const failure = safeFailure(error);
      add({
        test,
        outcome: "FAIL",
        http: failure.status,
        explanation: failure.message,
      });
      notice(failure.message);
    }
  } finally {
    if (current === epoch) {
      busy = false;
      controller = null;
      update();
    }
  }
}
function source() {
  if (!input("synthetic").checked || !session.connected)
    throw new DiagnosticError(
      null,
      "Confirm synthetic samples and connect first.",
    );
}
function folder() {
  source();
  const value = folderFromUrl(input("folder").value);
  if (value !== root) {
    clearSource();
    root = value;
  }
  return value;
}
function showFiles() {
  const host = el("files");
  host.replaceChildren();
  const ids = [
    ...new Set([
      ...(latest?.entries.filter((e) => e.kind === "file").map((e) => e.id) ??
        []),
      ...picked,
    ]),
  ].slice(0, 200);
  ids.forEach((fileId, index) => {
    const div = document.createElement("div");
    div.className = "file";
    const p = document.createElement("p"),
      b = document.createElement("button");
    const entry = latest?.entries.find((e) => e.id === fileId);
    p.textContent = `Synthetic candidate ${index + 1}: ${entry?.format ?? "individual Picker selection; metadata not yet tested"} · ${entry ? (entry.depth === 0 ? "direct child" : "nested child") : "explicit selection"}. No filename/ID displayed.`;
    b.textContent = `Test synthetic download ${index + 1}`;
    b.dataset.source = "";
    b.onclick = () =>
      void run("Synthetic download workflow", async (signal, current) => {
        source();
        if (downloads.length >= 20)
          throw new DiagnosticError(null, "At most 20 samples per session.");
        const value = await session.download(fileId, signal);
        if (current !== epoch) return;
        downloads.push({
          name: `synthetic-${downloads.length + 1}.${value.format.toLowerCase()}`,
          bytes: value.bytes,
        });
      });
    div.append(p, b);
    host.append(div);
  });
  update();
}
el("prepare").onclick = () =>
  void run("Load GIS SDK (not OAuth)", async () => {
    await prepareIdentity();
    add({
      test: "GIS script availability",
      outcome: "PASS",
      http: null,
      explanation:
        "SDK loaded only. Click Connect Test Google Account to request the narrow grant; this is not authentication success.",
    });
  });
el("connect").onclick = () =>
  void run("Google authorization / identity", async (signal, current) => {
    picker.close();
    session.clear();
    clearSource();
    picked.clear();
    pickerUsed = false;
    resetFields();
    rows = [];
    results();
    const response = await authorize(credentials.clientId);
    if (current !== epoch || signal.aborted) return;
    session.adopt(response);
    add({
      test: "OAuth token callback",
      outcome: "PASS",
      http: null,
      explanation:
        "GIS returned a non-expired token with only drive.file. Not folder/file permission proof.",
    });
    try {
      await session.identify(signal);
    } catch (error) {
      session.clear();
      throw error;
    }
  });
el("disconnect").onclick = () => {
  disconnect();
  if (hosted) {
    credentials = { clientId: "", pickerKey: "", appId: "" };
    update();
  }
};
el("expire").onclick = () => {
  disconnect(
    "Local expiry simulated, not an actual Google revocation/expiry outcome.",
  );
  add({
    test: "Local expiry simulation",
    outcome: "PASS",
    http: null,
    explanation: "Local memory/UI cleared. Simulation only; no Google request.",
  });
};
el("probe").onclick = () =>
  void run("Current identity probe", async (signal) => {
    try {
      await session.identify(signal);
    } catch (error) {
      const failure = safeFailure(error);
      disconnect(
        "Identity probe failed; local state cleared without revoking consent.",
        failure.status,
      );
      if (failure.status === null)
        add({
          test: "Identity probe",
          outcome: "FAIL",
          http: null,
          explanation: failure.message,
        });
    }
  });
input("synthetic").onchange = update;
input("folder").oninput = () => {
  clearSource();
  update();
};
el("choose-folder").onclick = () =>
  void run("Folder Picker", async (_signal, current) => {
    source();
    const grant = session.generation;
    await picker.open(
      "folder",
      session.tokenForPicker(),
      credentials.pickerKey,
      credentials.appId,
      () =>
        current === epoch && session.generation === grant && session.connected,
      (ids) => {
        if (!ids.length) {
          notice("Picker selection invalid.");
          return;
        }
        clearSource();
        root = ids[0];
        input("folder").value =
          `https://drive.google.com/drive/folders/${root}`;
        add({
          test: "Explicit folder Picker selection",
          outcome: "PASS",
          http: null,
          explanation:
            "Selected under the same grant. No metadata/child access is implied.",
        });
        update();
      },
    );
  });
el("metadata").onclick = () =>
  void run("Folder metadata", async (signal, current) => {
    const target = folder();
    attemptedRoot = target;
    const value = await session.metadata(target, signal);
    if (current !== epoch) return;
    if (value.kind !== "folder") {
      wrongRootType = true;
      throw new DiagnosticError(
        200,
        "Item is not a folder; traversal disabled.",
      );
    }
    metadataRoot = target;
    add({
      test: "Folder metadata GET",
      outcome: "PASS",
      http: 200,
      explanation:
        "Folder metadata readable. Child discovery and body access remain separate tests.",
    });
  });
async function scan(future: boolean, signal: AbortSignal, current: number) {
  const target = folder();
  if (attemptedRoot !== target)
    throw new DiagnosticError(null, "Test folder metadata first.");
  if (wrongRootType)
    throw new DiagnosticError(
      null,
      "Known non-folder target; correct the URL.",
    );
  if (metadataRoot !== target)
    add({
      test: "Root metadata access",
      outcome: "NOT RUN",
      http: null,
      explanation:
        "Root access not verified. This explicit listing attempt tests a separate operation and must not imply full visibility.",
    });
  if (future && (!baseline || baselineGrant !== session.generation))
    throw new DiagnosticError(
      null,
      "Establish a complete baseline with this same issued grant first.",
    );
  if (future && pickerUsed)
    throw new DiagnosticError(
      null,
      "Individual Picker contaminated this experiment. Use fresh synthetic samples before individual selection.",
    );
  const value = await session.scan(
    target,
    AbortSignal.any([signal, AbortSignal.timeout(45000)]),
  );
  if (current !== epoch) return;
  latest = value;
  el("scan-summary").textContent =
    `${value.entries.length} visible metadata entries across ${value.pages} pages. ${value.complete ? "Traversal complete within bounds, not proof of full visibility." : "Traversal incomplete; no coverage conclusion."}`;
  if (!future) {
    baseline = value.complete ? value : null;
    baselineGrant = session.generation;
    add(
      discovery(
        value,
        input("existing-direct").value,
        undefined,
        picked,
        "direct",
      ),
    );
    add(
      discovery(
        value,
        input("existing-nested").value,
        undefined,
        picked,
        "nested",
      ),
    );
  } else
    for (const [key, kind] of [
      ["new-direct", "direct"],
      ["new-folder", "folder"],
      ["new-nested", "nested"],
    ] as const)
      add(discovery(value, input(key).value, baseline!, picked, kind));
  showFiles();
}
el("baseline").onclick = () =>
  void run("Baseline traversal", (signal, current) =>
    scan(false, signal, current),
  );
el("future").onclick = () =>
  void run("Future-file traversal", (signal, current) =>
    scan(true, signal, current),
  );
el("choose-files").onclick = () =>
  void run("Individual Picker", async (_signal, current) => {
    source();
    const grant = session.generation;
    await picker.open(
      "files",
      session.tokenForPicker(),
      credentials.pickerKey,
      credentials.appId,
      () =>
        current === epoch && session.generation === grant && session.connected,
      (ids) => {
        if (!ids.length) {
          notice("Invalid Picker selection.");
          return;
        }
        pickerUsed = true;
        ids.forEach((value) => picked.add(id(value)));
        add({
          test: "Explicit individual Picker selection",
          outcome: "PASS",
          http: null,
          explanation:
            "IDs retained in memory only. Test body access separately. No inherited-access conclusion.",
        });
        showFiles();
      },
    );
  });
el("known-body").onclick = () =>
  void run("Known synthetic download workflow", async (signal, current) => {
    source();
    if (downloads.length >= 20)
      throw new DiagnosticError(null, "At most 20 samples per session.");
    const value = await session.download(
      id(input("known-download").value.trim()),
      signal,
    );
    if (current === epoch)
      downloads.push({
        name: `synthetic-${downloads.length + 1}.${value.format.toLowerCase()}`,
        bytes: value.bytes,
      });
  });
el("parse").onclick = () =>
  void run("Local parser/deduplication", async (signal, current) => {
    source();
    if (!downloads.length)
      throw new DiagnosticError(
        null,
        "Explicitly download synthetic samples first.",
      );
    const copies = downloads.map((f) => ({
      name: f.name,
      bytes: f.bytes.slice(),
    }));
    const parsed = await new Promise<ParsedFiles>((resolve, reject) => {
      const parser = new Worker(
        new URL("../src/services/activities/worker.ts", import.meta.url),
        { type: "module" },
      );
      worker = parser;
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        parser.terminate();
        worker = null;
      };
      const cancel = () => {
        finish();
        reject(new DiagnosticError(null, "Local parsing cancelled."));
      };
      const timer = setTimeout(() => {
        finish();
        reject(new DiagnosticError(null, "Local parser time limit."));
      }, 45000);
      signal.addEventListener("abort", cancel, { once: true });
      parser.onerror = (event) => {
        event.preventDefault();
        finish();
        reject(new DiagnosticError(null, "Local parser failed safely."));
      };
      parser.onmessage = (event) => {
        if (event.data.kind === "result") {
          finish();
          resolve(event.data.result);
        } else if (event.data.kind === "error") {
          finish();
          reject(new DiagnosticError(null, "Local parser rejected input."));
        }
      };
      parser.postMessage(
        { inputs: copies, offset: "", fallbackType: "Other" },
        copies.map((f) => f.bytes.buffer),
      );
    });
    const merged = await consolidate(parsed.activities);
    if (current !== epoch) return;
    el("parsed").textContent =
      `${parsed.activities.length} summaries, ${merged.length} conservative unique candidates, ${parsed.rejected} rejected files. No health values or raw series shown or stored.`;
    add({
      test: "Local synthetic parser/deduplication",
      outcome: parsed.rejected ? "FAIL" : "PASS",
      http: null,
      explanation:
        "Existing Health Sync worker and merge reused without Firebase or persistence.",
    });
  });
function saveFixture(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(
    new Blob([bytes.slice().buffer as ArrayBuffer]),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const wire = (s: string) => new TextEncoder().encode(s);
for (const [name, make] of [
  ["before.csv", () => wire(syntheticCsv())],
  ["before.tcx", () => wire(syntheticTcx())],
  ["before.fit", () => syntheticFit()],
  ["before.gpx", () => wire(syntheticGpx())],
  [
    "before.kml",
    () =>
      wire(
        '<kml xmlns:gx="urn:gx"><Document><Placemark><gx:Track><when>2028-02-07T07:00:00Z</when><when>2028-02-07T07:10:00Z</when><gx:coord>1 1 20</gx:coord><gx:coord>1.01 1 20</gx:coord></gx:Track></Placemark></Document></kml>',
      ),
  ],
  [
    "new-direct.csv",
    () =>
      wire(
        syntheticCsv(
          "TRAINING",
          new Date(START + 86400000).toISOString(),
          "synthetic-future-direct",
        ),
      ),
  ],
  [
    "new-nested.csv",
    () =>
      wire(
        syntheticCsv(
          "TRAINING",
          new Date(START + 172800000).toISOString(),
          "synthetic-future-nested",
        ),
      ),
  ],
] as const) {
  const b = document.createElement("button");
  b.textContent = `Generate synthetic ${name}`;
  b.onclick = () => saveFixture(`training-hq-test-${name}`, make());
  el("fixtures").append(b);
}
if (hosted)
  el("apply-settings").onclick = () => {
    try {
      const next = publicSettings({
        clientId: input("test-client").value,
        pickerKey: input("test-key").value,
        appId: input("test-app").value,
      });
      disconnect();
      credentials = next;
      update();
      notice(
        "Public test settings loaded only in memory. Load the Google SDK, then connect explicitly.",
      );
    } catch {
      notice(
        "Invalid public test settings. Use the replacement Web Client ID, browser API key and numeric project number; never a Client Secret.",
      );
    }
  };
window.addEventListener("pagehide", () =>
  disconnect("Page closed; local memory cleared."),
);
if (!credentials.clientId)
  notice(
    "Replacement Web Client ID missing. Hosted/Codespace users enter the public test settings above; localhost users configure ignored web/.env.local. Fixture generation requires no Google authorization.",
  );
results();
update();

navigator.serviceWorker?.addEventListener("controllerchange", () => {
  unsafeWorker = true;
  disconnect(
    "A service worker took control. Diagnostic disabled; use a clean local profile.",
  );
});
