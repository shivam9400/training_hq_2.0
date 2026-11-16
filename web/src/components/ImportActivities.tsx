import { useEffect, useRef, useState } from "react";
import type { Training } from "../hooks/useTraining";
import { Card } from "./Card";
import {
  LIMITS,
  type ParsedFiles,
  type InputFile,
} from "../services/activities/model";
import {
  activityPreview,
  type ActivityPreview,
  type Decisions,
} from "../services/activities/preview";
import { ImportCancelled, ImportStale } from "../services/importExecution";
import {
  effectiveMeters,
  durationMinutes,
  pace,
} from "../services/calculations";
import type { Workout } from "../types/data";
export function WorkoutFields({ workout: w }: { workout: Workout }) {
  return (
    <>
      <p>
        {w.type} · {new Date(w.start).toLocaleString()} ·{" "}
        {Math.round(durationMinutes(w) ?? 0)} min elapsed
        {w.details?.movingSeconds !== null &&
        w.details?.movingSeconds !== undefined
          ? ` · ${(w.details.movingSeconds / 60).toFixed(1)} min moving`
          : " · moving time missing"}
      </p>
      <p>
        Effective:{" "}
        {effectiveMeters(w) === null
          ? "missing"
          : `${((effectiveMeters(w) ?? 0) / 1000).toFixed(2)} km`}{" "}
        ·{" "}
        {pace(w.type, durationMinutes(w), effectiveMeters(w)) ?? "Pace missing"}{" "}
        (elapsed)
      </p>
      <p>
        Reported:{" "}
        {w.reportedMeters === null
          ? "missing"
          : `${(w.reportedMeters / 1000).toFixed(2)} km`}{" "}
        · GPS:{" "}
        {w.gpsMeters === null
          ? "missing"
          : `${(w.gpsMeters / 1000).toFixed(2)} km`}{" "}
        · {w.distanceSource}
      </p>
      <p>
        Avg HR:{" "}
        {w.averageHr === null ? "missing" : `${w.averageHr.toFixed(0)} bpm`} ·
        Max HR: {w.details?.maxHr ?? "missing"} · Calories (kcal):{" "}
        {w.details?.calories ?? "missing"} · Steps:{" "}
        {w.details?.steps ?? "missing"}
      </p>
      {w.qualityFlags.length > 0 && (
        <p className="banner">Quality: {w.qualityFlags.join(" · ")}</p>
      )}
      <details>
        <summary>Metric provenance and available samples</summary>
        <p>
          Formats: {w.provenance?.formats.join(", ") ?? w.source}. No raw route
          or HR series is stored.
        </p>
        <p>
          HR samples: {w.details?.hrSampleCount ?? "missing"} · GPS fixes:{" "}
          {w.details?.gpsSampleCount ?? "missing"} · Invalid GPS:{" "}
          {w.details?.invalidGpsCount ?? "missing"}
        </p>
        <p>
          Cadence: {w.details?.cadence ?? "missing"}{" "}
          {w.details?.cadenceUnit ?? ""} · Elevation gain:{" "}
          {w.details?.elevationGainMeters ?? "missing"} m · Elevation range:{" "}
          {w.details?.minElevationMeters ?? "missing"} to{" "}
          {w.details?.maxElevationMeters ?? "missing"} m
        </p>
        {w.details && (
          <>
            <p>
              Type source: {w.details.typeSource}; GPS source:{" "}
              {w.details.gpsSource ?? "missing"}.
            </p>
            <p>
              Summary sources:{" "}
              {Object.entries(w.details.metricSources)
                .map(([key, value]) => `${key}: ${value}`)
                .join(" · ")}
            </p>
            <p>
              Reported distances (m):{" "}
              {Object.entries(w.details.reportedByFormat)
                .filter(([, value]) => value !== null)
                .map(([key, value]) => `${key}: ${value}`)
                .join(" · ") || "missing"}
            </p>
          </>
        )}
      </details>
    </>
  );
}
export function ImportActivities({ app }: { app: Training }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [writing, setWriting] = useState(false),
    [message, setMessage] = useState("");
  const [parsed, setParsed] = useState<ParsedFiles | null>(null),
    [preview, setPreview] = useState<ActivityPreview | null>(null),
    [decisions, setDecisions] = useState<Decisions>({});
  const [confirmation, setConfirmation] = useState(false),
    [ack, setAck] = useState(false),
    [progress, setProgress] = useState({ done: 0, total: 0 });
  const form = useRef<HTMLFormElement>(null),
    worker = useRef<Worker | null>(null),
    controller = useRef<AbortController | null>(null),
    generation = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const current = generation;
    return () => {
      mounted.current = false;
      ++current.current;
      worker.current?.terminate();
      controller.current?.abort();
    };
  }, []);
  const clear = () => {
    ++generation.current;
    worker.current?.terminate();
    controller.current?.abort();
    setParsed(null);
    setPreview(null);
    setDecisions({});
    setConfirmation(false);
    setAck(false);
    form.current?.reset();
  };
  const review = async (result: ParsedFiles, next: Decisions) => {
    const current = ++generation.current;
    setConfirmation(false);
    setAck(false);
    const value = await activityPreview(
      app.user?.uid ?? "local-preview",
      result.activities,
      app.records.workouts,
      next,
    );
    if (mounted.current && current === generation.current) setPreview(value);
  };
  return (
    <Card title="Private Health Sync importer">
      <button
        className="secondary"
        onClick={() => {
          if (open && !busy) {
            clear();
            setOpen(false);
          } else setOpen(true);
        }}
        disabled={busy || app.busy}
      >
        Import Activities
      </button>
      {open && (
        <>
          <p>
            Choose your own Health Sync ZIP or FIT, TCX, workout CSV, GPX or
            timestamped KML. Files are processed locally. Only confirmed
            summaries go to your private account; raw files stay where you keep
            them in Drive.
          </p>
          {!app.user && (
            <p className="banner">
              Local preview only. Sign in from Settings to save activities; demo
              uploads cannot be persisted.
            </p>
          )}
          <p className="muted">
            Limits: 20 MiB selection/ZIP, 8 MiB individual/extracted file (FIT 4
            MiB), 40 MiB expanded, 250 ZIP entries, 200 workouts, 45 seconds.
            Encrypted/nested ZIPs and unsafe XML are rejected.
          </p>
          <form
            ref={form}
            onSubmit={async (event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget),
                files = data
                  .getAll("files")
                  .filter((f): f is File => f instanceof File && f.size > 0);
              clear();
              setBusy(true);
              setWriting(false);
              setMessage("");
              setProgress({ done: 0, total: files.length });
              const abort = new AbortController();
              controller.current = abort;
              const current = generation.current;
              let timer: ReturnType<typeof setTimeout> | undefined;
              try {
                if (
                  !files.length ||
                  files.length > 50 ||
                  files.reduce((sum, f) => sum + f.size, 0) > LIMITS.zip ||
                  files.some(
                    (f) =>
                      f.size >
                      (f.name.toLowerCase().endsWith(".zip")
                        ? LIMITS.zip
                        : LIMITS.file),
                  )
                )
                  throw new Error("File limit");
                const inputs: InputFile[] = [];
                for (const file of files) {
                  if (abort.signal.aborted) throw new ImportCancelled();
                  inputs.push({
                    name: file.name,
                    bytes: new Uint8Array(await file.arrayBuffer()),
                  });
                }
                if (abort.signal.aborted) throw new ImportCancelled();
                const result = await new Promise<ParsedFiles>(
                  (resolve, reject) => {
                    const parser = new Worker(
                      new URL(
                        "../services/activities/worker.ts",
                        import.meta.url,
                      ),
                      { type: "module" },
                    );
                    worker.current = parser;
                    const finish = () => {
                      parser.terminate();
                      if (timer) clearTimeout(timer);
                    };
                    abort.signal.addEventListener(
                      "abort",
                      () => {
                        finish();
                        reject(new ImportCancelled());
                      },
                      { once: true },
                    );
                    parser.onerror = (event) => {
                      event.preventDefault();
                      finish();
                      reject(new Error("Parser worker stopped safely."));
                    };
                    parser.onmessage = (event) => {
                      const value = event.data;
                      if (value.kind === "progress") {
                        if (mounted.current)
                          setProgress({ done: value.done, total: value.total });
                      } else if (value.kind === "result") {
                        finish();
                        resolve(value.result);
                      } else if (value.kind === "error") {
                        finish();
                        reject(
                          new Error(
                            "Archive or file safety validation failed.",
                          ),
                        );
                      }
                    };
                    timer = setTimeout(() => {
                      finish();
                      reject(new Error("Parser time budget exceeded."));
                    }, LIMITS.timeoutMs);
                    parser.postMessage(
                      {
                        inputs,
                        offset: String(data.get("offset") ?? "").trim(),
                        fallbackType: String(data.get("fallback") ?? "Other"),
                      },
                      inputs.map((f) => f.bytes.buffer),
                    );
                  },
                );
                if (mounted.current && current === generation.current) {
                  setParsed(result);
                  await review(result, {});
                  if (!result.activities.length)
                    setMessage(
                      "No supported complete workouts found. Review file notices; no data was written.",
                    );
                }
              } catch (error) {
                if (mounted.current)
                  setMessage(
                    error instanceof ImportCancelled
                      ? "Processing cancelled; no summaries were written."
                      : "Selection rejected or parsing limit reached. Check format, timestamps/timezone, integrity and limits. No raw data was logged or written.",
                  );
              } finally {
                if (timer) clearTimeout(timer);
                if (mounted.current) setBusy(false);
              }
            }}
          >
            <fieldset disabled={busy || app.busy}>
              <legend>Choose private source files</legend>
              <label>
                Health Sync files
                <input
                  name="files"
                  type="file"
                  accept=".zip,.fit,.tcx,.csv,.gpx,.kml"
                  multiple
                  required
                />
              </label>
              <label>
                UTC offset for zone-less CSV timestamps (optional)
                <input
                  name="offset"
                  placeholder="e.g. +05:30; leave blank if timestamps include a zone"
                  pattern="[+-](0[0-9]|1[0-4]):[0-5][0-9]"
                />
              </label>
              <label>
                Known type for GPX/KML with no activity type
                <select name="fallback" defaultValue="Other">
                  <option value="Other">Unknown — do not infer</option>
                  <option value="Walk">
                    I confirm these tracks are walking
                  </option>
                  <option value="Run">
                    I confirm these tracks are running
                  </option>
                </select>
              </label>
              <button>Preview local activities</button>
            </fieldset>
          </form>
          {busy && (
            <p role="status">
              {writing ? "Saving summary chunks" : "Processing local files"}:{" "}
              {progress.done} / {progress.total}
            </p>
          )}
          {message && (
            <p className="banner" role="status">
              {message}
            </p>
          )}
          {parsed && (
            <>
              <p>
                {parsed.inspected} supported files inspected · {parsed.rejected}{" "}
                rejected · {parsed.activities.length} parsed workout summaries
                before companion merging.
              </p>
              {parsed.notices.length > 0 && (
                <div className="banner">
                  <h3>File notices</h3>
                  <ul>
                    {parsed.notices.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {preview && (
            <>
              <h3>
                {confirmation
                  ? "Confirm private activity import"
                  : "Activity import preview"}
              </h3>
              <p>
                {[
                  "addition",
                  "enrichment",
                  "unchanged",
                  "review",
                  "conflict",
                  "skip",
                ]
                  .map(
                    (action) =>
                      `${preview.rows.filter((r) => r.action === action).length} ${action}`,
                  )
                  .join(" · ")}
              </p>
              {preview.errors.length > 0 && (
                <p role="alert">{preview.errors.join(" ")}</p>
              )}
              {preview.rows.map((row, index) => (
                <article className="session" key={row.key}>
                  <h3>
                    {index + 1}. {row.incoming.title}
                  </h3>
                  <strong>{row.action.toUpperCase()}</strong>
                  <WorkoutFields workout={row.incoming} />
                  <ul>
                    {row.notes.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                  {!row.key.startsWith("merge-") && (
                    <label>
                      Review decision for activity {index + 1}
                      <select
                        disabled={busy}
                        value={decisions[row.key] ?? ""}
                        onChange={async (event) => {
                          const next = {
                            ...decisions,
                            [row.key]: event.target.value,
                          };
                          setDecisions(next);
                          setBusy(true);
                          try {
                            if (parsed) await review(parsed, next);
                          } catch {
                            setMessage(
                              "Review could not be resolved. Keep separate or skip.",
                            );
                          } finally {
                            if (mounted.current) setBusy(false);
                          }
                        }}
                      >
                        <option value="">
                          Use safe default / unresolved review
                        </option>
                        <option value="skip">Skip this summary</option>
                        <option value="keep">
                          Keep as a distinct activity (intentional)
                        </option>
                        {row.targets.map((id) => {
                          const w =
                            app.records.workouts.find((w) => w.id === id) ??
                            preview.rows.find((r) => r.incoming.id === id)
                              ?.incoming;
                          return (
                            <option value={`merge:${id}`} key={id}>
                              Merge into {w?.title ?? "preview activity"} ·{" "}
                              {w?.type} · {w?.start}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  )}
                </article>
              ))}
              {!confirmation ? (
                <button
                  disabled={
                    busy ||
                    !preview.rows.length ||
                    preview.errors.length > 0 ||
                    preview.rows.some((r) => r.action === "review")
                  }
                  onClick={() => setConfirmation(true)}
                >
                  Continue to activity confirmation
                </button>
              ) : (
                <>
                  <p>
                    Save only reviewed summaries to{" "}
                    {app.user?.email ?? "your authenticated account"}. Protected
                    conflicts stay unchanged. An in-flight chunk may finish
                    after cancellation; committed chunks are retained. No
                    session or status is changed by import.
                  </p>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={ack}
                      onChange={(e) => setAck(e.target.checked)}
                    />
                    I reviewed duplicates, missing fields, rejected files and
                    quality/source-distance warnings.
                  </label>
                  <button
                    disabled={
                      !ack ||
                      busy ||
                      !app.user ||
                      app.user.uid !== preview.ownerUid ||
                      !app.online ||
                      !app.loaded ||
                      preview.errors.length > 0 ||
                      preview.rows.some((r) => r.action === "review")
                    }
                    onClick={async () => {
                      const abort = new AbortController();
                      controller.current = abort;
                      setBusy(true);
                      setWriting(true);
                      setMessage("");
                      try {
                        const result = await app.importActivities(preview, {
                          signal: abort.signal,
                          onProgress: (done, total) => {
                            if (mounted.current) setProgress({ done, total });
                          },
                        });
                        if (mounted.current) {
                          setMessage(
                            `Import complete: ${result.written} summary writes. Raw files, routes and HR series were not uploaded.`,
                          );
                          setParsed(null);
                          setPreview(null);
                          setDecisions({});
                          setConfirmation(false);
                          setAck(false);
                        }
                      } catch (error) {
                        if (mounted.current)
                          setMessage(
                            error instanceof ImportCancelled ||
                              error instanceof ImportStale
                              ? error.message
                              : "Import stopped. Some chunks may be saved; reload private data and reselect the same files to safely preview/resume.",
                          );
                      } finally {
                        if (mounted.current) {
                          setBusy(false);
                          setWriting(false);
                        }
                      }
                    }}
                  >
                    Confirm activities to my account
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => setConfirmation(false)}
                  >
                    Back to activity review
                  </button>
                </>
              )}
            </>
          )}
          <button
            className="secondary"
            onClick={() => {
              if (busy) {
                controller.current?.abort();
                worker.current?.terminate();
                ++generation.current;
                setParsed(null);
                setPreview(null);
                setDecisions({});
                form.current?.reset();
                setMessage(
                  "Cancellation requested; the current summary chunk may commit. Reload and preview again to recover.",
                );
              } else {
                clear();
                setOpen(false);
              }
            }}
          >
            {busy
              ? "Cancel remaining processing/import"
              : "Cancel and clear activities"}
          </button>
          {app.user && (
            <button className="secondary" disabled={busy} onClick={app.refresh}>
              Reload private activities for recovery
            </button>
          )}
        </>
      )}
    </Card>
  );
}
