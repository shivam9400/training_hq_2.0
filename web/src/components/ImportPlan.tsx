import { useEffect, useRef, useState } from "react";
import { Card } from "./Card";
import type { Training } from "../hooks/useTraining";
import {
  MAX_CSV_BYTES,
  parsePlanCsv,
  previewImport,
  type ImportPreview,
} from "../services/planImport";
import { ImportCancelled, ImportStale } from "../services/importExecution";
import type { Session } from "../types/data";
function SourceFields({ session }: { session: Session }) {
  return (
    <dl className="import-fields">
      <dt>Date / Day / Slot</dt>
      <dd>
        {session.date} / {session.day} / {session.slot}
      </dd>
      <dt>Week / Phase / Type</dt>
      <dd>
        {session.week} / {session.phase} / {session.type}
      </dd>
      <dt>Session</dt>
      <dd>{session.title}</dd>
      <dt>Planned min</dt>
      <dd>{session.minutes}</dd>
      <dt>Target</dt>
      <dd>{session.target || "—"}</dd>
      <dt>What to do</dt>
      <dd className="instructions">{session.instructions || "—"}</dd>
    </dl>
  );
}
export function ImportPlan({
  app,
  onImported,
}: {
  app: Training;
  onImported: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "update">("create");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [stage, setStage] = useState<"review" | "confirm">("review");
  const [working, setWorking] = useState(false);
  const [writing, setWriting] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const currentGeneration = generation;
    return () => {
      mounted.current = false;
      ++currentGeneration.current;
      controller.current?.abort();
    };
  }, []);
  const invalidate = () => {
    ++generation.current;
    setPreview(null);
    setStage("review");
    setAcknowledged(false);
    setMessage("");
  };
  const reset = () => {
    controller.current?.abort();
    invalidate();
    formRef.current?.reset();
    setOpen(false);
  };
  const importedPlans = app.records.plans.filter((plan) => plan.importSource);
  const count = (kind: string) =>
    preview?.rows.filter((row) => row.kind === kind).length ?? 0;
  return (
    <Card title="Private plan importer">
      <button
        className="secondary"
        disabled={app.busy}
        onClick={() => {
          if (open && !working) reset();
          else setOpen(true);
        }}
      >
        Import Plan
      </button>
      {open && (
        <>
          <p>
            Download CSV from the private Plan worksheet yourself, then choose
            it here. Parsing and preview stay in this browser. No spreadsheet is
            fetched, published or logged.
          </p>
          {!app.user && (
            <p className="banner">
              Local preview only. Sign in in Settings before importing to your
              private account. CSV imports cannot be saved in demo mode.
            </p>
          )}
          <form
            ref={formRef}
            onChange={invalidate}
            onSubmit={async (event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget),
                file = values.get("csv");
              if (!(file instanceof File) || !file.size) {
                setMessage("Choose a non-empty CSV file.");
                return;
              }
              if (file.size > MAX_CSV_BYTES) {
                setMessage("CSV exceeds the 1 MiB limit.");
                return;
              }
              const current = ++generation.current;
              setWorking(true);
              setMessage("");
              setPreview(null);
              setStage("review");
              try {
                const parsed = parsePlanCsv(await file.text());
                const result = await previewImport({
                  ownerUid: app.user?.uid ?? "local-preview",
                  parsed,
                  sourceLabel: String(values.get("source")),
                  title: String(values.get("title")).trim(),
                  mode,
                  selectedPlan: app.records.plans.find(
                    (plan) => plan.id === values.get("plan"),
                  ),
                  plans: app.records.plans,
                  sessions: app.records.sessions,
                });
                if (mounted.current && current === generation.current)
                  setPreview(result);
              } catch {
                if (mounted.current && current === generation.current)
                  setMessage(
                    "Could not preview. Check file encoding, plan name and source selection; no records were written.",
                  );
              } finally {
                if (mounted.current) setWorking(false);
              }
            }}
          >
            <fieldset disabled={working || app.busy}>
              <legend>Choose source and destination</legend>
              <label>
                Import mode
                <select
                  value={mode}
                  onChange={(event) =>
                    setMode(event.target.value as "create" | "update")
                  }
                >
                  <option value="create">Create New Plan</option>
                  <option value="update">Update Existing Imported Plan</option>
                </select>
              </label>
              {mode === "create" ? (
                <>
                  <label>
                    Stable source reference
                    <input
                      name="source"
                      maxLength={200}
                      required
                      placeholder="A memorable label for this source plan"
                    />
                  </label>
                  <p className="muted">
                    Reuse the same reference for reimports. It is hashed, not a
                    file index or filename. Use a new reference only for an
                    intentionally different plan. Do not paste credentials or a
                    spreadsheet URL.
                  </p>
                  <label>
                    Imported plan name
                    <input name="title" maxLength={120} required />
                  </label>
                </>
              ) : (
                <label>
                  Imported source plan
                  <select name="plan" required defaultValue="">
                    <option value="" disabled>
                      Select an imported plan
                    </option>
                    {importedPlans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Private Plan CSV
                <input type="file" name="csv" accept=".csv,text/csv" required />
              </label>
              <button type="submit">Preview CSV</button>
            </fieldset>
          </form>
          {working && (
            <p role="status">
              {writing
                ? `Importing: ${progress.processed} of ${progress.total} source-row checks completed.`
                : "Validating local CSV…"}
            </p>
          )}
          {message && (
            <p role="status" className="banner">
              {message}
            </p>
          )}
          {preview && (
            <>
              <h3>
                {stage === "confirm"
                  ? "Confirm private import"
                  : "Import preview"}
              </h3>
              <p>
                {preview.parsed.totalRows} source rows ·{" "}
                {preview.parsed.rows.length} validated rows ·{" "}
                {preview.parsed.startDate || "—"} to{" "}
                {preview.parsed.endDate || "—"}
              </p>
              <p>
                Types:{" "}
                {Object.entries(preview.parsed.types)
                  .map(([type, total]) => `${type}: ${total}`)
                  .join(" · ") || "—"}
              </p>
              <p>
                Sessions per week:{" "}
                {Object.entries(preview.parsed.weeks)
                  .map(([week, total]) => `Wk ${week}: ${total}`)
                  .join(" · ") || "—"}
              </p>
              <p>
                {count("addition")} additions · {count("change")} changes ·{" "}
                {count("conflict")} conflicts · {count("unchanged")} unchanged ·{" "}
                {preview.retained} absent rows retained
              </p>
              <p>
                Plan details: {preview.planKind}
                {preview.planKind === "conflict"
                  ? " (manual plan details retained)"
                  : ""}
                .
              </p>
              {preview.errors.length > 0 && (
                <div role="alert">
                  <h4>Errors — import blocked</h4>
                  <ul>
                    {preview.errors.map((error, i) => (
                      <li key={i}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
              {preview.warnings.length > 0 && (
                <div className="banner">
                  <h4>Warnings — review before writing</h4>
                  <ul>
                    {preview.warnings.map((warning, i) => (
                      <li key={i}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
              <details>
                <summary>Review all source rows and changes</summary>
                {preview.rows.map((row) => (
                  <article className="session" key={row.incoming.id}>
                    <strong>
                      {row.kind.toUpperCase()} · {row.reason}
                    </strong>
                    <SourceFields session={row.incoming} />
                    {row.expected && row.kind !== "unchanged" && (
                      <details>
                        <summary>
                          Existing saved fields (status: {row.expected.status})
                        </summary>
                        <SourceFields session={row.expected} />
                      </details>
                    )}
                  </article>
                ))}
              </details>
              {stage === "review" ? (
                <button
                  disabled={preview.errors.length > 0 || working}
                  onClick={() => {
                    setStage("confirm");
                    setAcknowledged(false);
                  }}
                >
                  Continue to confirmation
                </button>
              ) : (
                <>
                  <p>
                    Only safe additions and changes will be written to{" "}
                    {app.user?.email ?? "the currently authenticated account"}.
                    Conflicts, completed/status-changed sessions, manual edits
                    and missing source rows are retained. No deletions. An
                    import is not all-or-nothing across chunks.
                  </p>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      disabled={working}
                      onChange={(event) =>
                        setAcknowledged(event.target.checked)
                      }
                    />
                    I reviewed errors, warnings and conflicts. Keep protected
                    records and import only safe rows.
                  </label>
                  <button
                    disabled={
                      !acknowledged ||
                      !app.user ||
                      app.user.uid !== preview.ownerUid ||
                      !app.online ||
                      !app.loaded ||
                      working ||
                      preview.errors.length > 0
                    }
                    onClick={async () => {
                      const abort = new AbortController();
                      controller.current = abort;
                      setWorking(true);
                      setWriting(true);
                      setMessage("");
                      try {
                        const result = await app.importPlan(preview, {
                          signal: abort.signal,
                          onProgress: (processed, total) => {
                            if (mounted.current)
                              setProgress({ processed, total });
                          },
                        });
                        if (mounted.current) {
                          setMessage(
                            `Import complete: ${result.written} session writes; unchanged/protected records retained. Refresh preview before another import.`,
                          );
                          onImported(preview.plan.id);
                          setPreview(null);
                          formRef.current?.reset();
                        }
                      } catch (error) {
                        if (mounted.current) {
                          setMessage(
                            error instanceof ImportCancelled ||
                              error instanceof ImportStale
                              ? error.message
                              : "Import stopped. Some chunks may already be saved. Refresh your private data, reselect this CSV and Update Existing Imported Plan to safely resume. No rollback or deletion was attempted.",
                          );
                          setPreview(null);
                        }
                      } finally {
                        if (mounted.current) {
                          setWorking(false);
                          setWriting(false);
                          setAcknowledged(false);
                        }
                      }
                    }}
                  >
                    Confirm import to my account
                  </button>
                  <button
                    className="secondary"
                    disabled={working}
                    onClick={() => setStage("review")}
                  >
                    Back to preview
                  </button>
                </>
              )}
            </>
          )}
          <button
            className="secondary"
            onClick={() => {
              if (working) {
                controller.current?.abort();
                ++generation.current;
                setPreview(null);
                formRef.current?.reset();
                setMessage(
                  "Cancellation requested. The in-flight chunk may finish; no future chunks will start. Committed chunks remain saved.",
                );
              } else reset();
            }}
          >
            {working ? "Cancel remaining import" : "Cancel and clear CSV"}
          </button>
          {app.user && (
            <button
              className="secondary"
              disabled={working}
              onClick={app.refresh}
            >
              Reload private data for recovery
            </button>
          )}
          <p className="muted">
            Cancellation cannot undo committed chunks. After interruption,
            refresh private data and use Update with the same source. Reimports
            use stable IDs and do not duplicate saved rows. Raw CSV is never
            uploaded; confirmed mapped records go only to your Firestore
            account.
          </p>
        </>
      )}
    </Card>
  );
}
