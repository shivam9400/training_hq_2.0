import { useState } from "react";
import type { Training } from "../hooks/useTraining";
import { Card } from "../components/Card";
import {
  kinds,
  statuses,
  type Metric,
  type Session,
  type Workout,
} from "../types/data";
import {
  completion,
  durationMinutes,
  effectiveMeters,
  localDate,
  pace,
  dailyReadiness,
  dueSessions,
} from "../services/calculations";
import {
  confirmIdentity,
  configError,
  configured,
  removeAuthAccount,
} from "../services/firebase";
import { userStore } from "../services/store";

export const tabs = [
  "Today",
  "Plan",
  "Progress",
  "Activities",
  "Health",
  "Settings",
] as const;
export type Tab = (typeof tabs)[number];
const freshId = () => crypto.randomUUID();
const disabled = (app: Training) =>
  app.busy || (app.mode === "cloud" && (!app.online || !app.loaded));

function SessionCard({ session, app }: { session: Session; app: Training }) {
  return (
    <article className="session">
      <div className="split">
        <span className={`chip kind-${session.type.toLowerCase()}`}>
          {session.type}
        </span>
        <span>
          {session.date} · {session.status}
        </span>
      </div>
      <h3>{session.title}</h3>
      <p>
        {session.minutes} min · {session.target || "No target set"}
      </p>
      <p className="instructions">
        {session.instructions || "No instructions yet."}
      </p>
      <fieldset disabled={disabled(app)}>
        <legend>Session status</legend>
        <div className="actions">
          {statuses.map((status) => (
            <button
              className={session.status === status ? "selected" : "secondary"}
              aria-pressed={session.status === status}
              key={status}
              onClick={() =>
                void app.action(() =>
                  app.save("sessions", { ...session, status }),
                )
              }
            >
              {status}
            </button>
          ))}
        </div>
      </fieldset>
    </article>
  );
}
function Today({ app }: { app: Training }) {
  const today = localDate();
  const sessions = app.records.sessions.filter((s) => s.date === today);
  const recovery = dailyReadiness(app.records.metrics, today);
  const sorted = [...app.records.sessions]
    .filter((s) => s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const weekStart = new Date(`${today}T12:00:00`);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const week = app.records.sessions.filter(
    (s) => s.date >= localDate(weekStart) && s.date <= localDate(weekEnd),
  );
  const progress = completion(week);
  return (
    <>
      <section className="hero">
        <span className="eyebrow">YOUR DAILY FOCUS · {today}</span>
        <h2>Keep showing up.</h2>
        <p>Build consistency, one session at a time.</p>
        <div className="chip">
          {sessions.length} session{sessions.length === 1 ? "" : "s"} today
        </div>
      </section>
      <Card title="Today's training">
        {sessions.length ? (
          sessions.map((s) => <SessionCard key={s.id} session={s} app={app} />)
        ) : (
          <p>No sessions today. Add one in Plan, or enjoy a rest day.</p>
        )}
      </Card>
      <div className="grid">
        <Card title="Recovery check-in">
          <h3>{recovery.level}</h3>
          <p>{recovery.text}</p>
          <p className="muted">Training guidance only. Not medical advice.</p>
        </Card>
        <Card title="This week">
          <strong className="stat">{Math.round(progress * 100)}%</strong>
          <progress
            aria-label="Weekly session completion"
            max={1}
            value={progress}
          />
          <p>
            {week.filter((s) => s.type !== "Rest").length} planned sessions ·
            Partial counts as half.
          </p>
        </Card>
      </div>
      <Card title="Next up">
        {sorted.slice(0, 3).map((s) => (
          <p key={s.id}>
            {s.date} · {s.type} · {s.title}
          </p>
        ))}
        {!sorted.length && <p>Your next training chapter starts in Plan.</p>}
      </Card>
    </>
  );
}
function SessionEditor({
  app,
  existing,
  planId,
  close,
}: {
  app: Training;
  existing?: Session;
  planId: string;
  close: () => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const row: Session = {
          id: existing?.id ?? freshId(),
          planId,
          date: String(values.get("date")),
          type: values.get("type") as Session["type"],
          title: String(values.get("title")).trim(),
          minutes: Number(values.get("minutes")),
          target: String(values.get("target")),
          instructions: String(values.get("instructions")),
          status: existing?.status ?? "Planned",
        };
        void app.action(async () => {
          await app.save("sessions", row);
          close();
        });
      }}
    >
      <fieldset disabled={disabled(app)}>
        <legend>{existing ? "Edit session" : "Add session"}</legend>
        <div className="form-grid">
          <label>
            Date
            <input
              name="date"
              type="date"
              required
              defaultValue={existing?.date ?? localDate()}
            />
          </label>
          <label>
            Type
            <select name="type" defaultValue={existing?.type ?? "Run"}>
              {kinds.map((kind) => (
                <option key={kind}>{kind}</option>
              ))}
            </select>
          </label>
          <label className="full">
            Session name
            <input
              name="title"
              maxLength={120}
              required
              defaultValue={existing?.title}
            />
          </label>
          <label>
            Planned minutes
            <input
              name="minutes"
              type="number"
              min="0"
              max="900"
              step="1"
              required
              defaultValue={existing?.minutes ?? 30}
            />
          </label>
          <label>
            Target pace / HR
            <input
              name="target"
              maxLength={200}
              defaultValue={existing?.target}
              placeholder="Easy conversation / HR target"
            />
          </label>
          <label className="full">
            Workout instructions
            <textarea
              name="instructions"
              maxLength={4000}
              defaultValue={existing?.instructions}
            />
          </label>
          <div className="actions full">
            <button type="submit">Save session</button>
            <button type="button" className="secondary" onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
function Plan({ app }: { app: Training }) {
  const [editing, setEditing] = useState<Session | "new" | null>(null);
  const [selected, setSelected] = useState(app.records.plans[0]?.id ?? "");
  const planId = selected || app.records.plans[0]?.id || "";
  const currentPlan = app.records.plans.find((p) => p.id === planId);
  const sessions = app.records.sessions
    .filter((s) => s.planId === planId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return (
    <>
      <Card title="Training plans">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const values = new FormData(form);
            const id = freshId();
            void app.action(async () => {
              await app.save("plans", {
                id,
                title: String(values.get("title")).trim(),
                startDate: String(values.get("start")),
                endDate: String(values.get("end")),
              });
              setSelected(id);
              form.reset();
            });
          }}
        >
          <fieldset disabled={disabled(app)}>
            <legend>Create a plan</legend>
            <div className="form-grid">
              <label className="full">
                Plan name
                <input name="title" maxLength={120} required />
              </label>
              <label>
                Start date
                <input
                  type="date"
                  name="start"
                  defaultValue={localDate()}
                  required
                />
              </label>
              <label>
                End date
                <input
                  type="date"
                  name="end"
                  defaultValue={localDate()}
                  required
                />
              </label>
              <button>Create plan</button>
            </div>
          </fieldset>
        </form>
        {app.records.plans.length > 0 && (
          <label>
            Active plan
            <select
              value={planId}
              onChange={(e) => {
                setSelected(e.target.value);
                setEditing(null);
              }}
            >
              {app.records.plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} · {p.startDate} to {p.endDate}
                </option>
              ))}
            </select>
          </label>
        )}
        {!app.records.plans.length && (
          <p>No private plans yet. Create your first plan above.</p>
        )}
        {currentPlan && (
          <details>
            <summary>Edit plan name and dates</summary>
            <form
              key={currentPlan.id}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void app.action(() =>
                  app.save("plans", {
                    ...currentPlan,
                    title: String(f.get("title")).trim(),
                    startDate: String(f.get("start")),
                    endDate: String(f.get("end")),
                  }),
                );
              }}
            >
              <fieldset disabled={disabled(app)}>
                <legend>Plan details</legend>
                <div className="form-grid">
                  <label className="full">
                    Updated plan name
                    <input
                      name="title"
                      maxLength={120}
                      required
                      defaultValue={currentPlan.title}
                    />
                  </label>
                  <label>
                    Updated start date
                    <input
                      name="start"
                      type="date"
                      required
                      defaultValue={currentPlan.startDate}
                    />
                  </label>
                  <label>
                    Updated end date
                    <input
                      name="end"
                      type="date"
                      required
                      defaultValue={currentPlan.endDate}
                    />
                  </label>
                  <button>Save plan details</button>
                </div>
              </fieldset>
            </form>
          </details>
        )}
        {planId && (
          <button disabled={disabled(app)} onClick={() => setEditing("new")}>
            Add session
          </button>
        )}
        {editing && (
          <SessionEditor
            key={editing === "new" ? "new" : editing.id}
            existing={editing === "new" ? undefined : editing}
            app={app}
            planId={planId}
            close={() => setEditing(null)}
          />
        )}
      </Card>
      <Card title="Sessions by day">
        <p className="muted">
          Multiple sessions on the same date stay separate. Status changes never
          overwrite the plan text.
        </p>
        {sessions.map((s) => (
          <div key={s.id}>
            <SessionCard session={s} app={app} />
            <button
              className="secondary edit"
              disabled={disabled(app)}
              onClick={() => setEditing(s)}
            >
              Edit {s.title}
            </button>
          </div>
        ))}
        {!sessions.length && <p>No sessions in this plan.</p>}
      </Card>
      <Card title="Race goals">
        {app.records.races.map((r) => (
          <p key={r.id}>
            {r.date} · {r.title} · {r.distanceKm} km · {r.goal}
          </p>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            void app.action(async () => {
              await app.save("races", {
                id: freshId(),
                date: String(f.get("date")),
                title: String(f.get("title")).trim(),
                distanceKm: Number(f.get("km")),
                goal: String(f.get("goal")),
              });
              form.reset();
            });
          }}
        >
          <fieldset disabled={disabled(app)}>
            <legend>Add race goal</legend>
            <div className="form-grid">
              <label>
                Race name
                <input name="title" maxLength={120} required />
              </label>
              <label>
                Race date
                <input name="date" type="date" required />
              </label>
              <label>
                Race distance (km)
                <input
                  name="km"
                  type="number"
                  step="0.001"
                  min="0.001"
                  max="500"
                  required
                />
              </label>
              <label>
                Goal
                <input name="goal" maxLength={300} />
              </label>
              <button>Add race</button>
            </div>
          </fieldset>
        </form>
      </Card>
    </>
  );
}
function Progress({ app }: { app: Training }) {
  const due = dueSessions(app.records.sessions, localDate());
  const workouts = app.records.workouts.filter((w) =>
    ["Run", "Race"].includes(w.type),
  );
  const minutes = workouts.reduce(
    (sum, w) => sum + (durationMinutes(w) ?? 0),
    0,
  );
  const meters = workouts.reduce(
    (sum, w) => sum + (effectiveMeters(w) ?? 0),
    0,
  );
  return (
    <>
      <Card title="Training consistency">
        <strong className="stat">{Math.round(completion(due) * 100)}%</strong>
        <progress
          aria-label="Plan completion"
          max={1}
          value={completion(due)}
        />
        <p>
          {due.filter((s) => s.status === "Done").length} done ·{" "}
          {due.filter((s) => s.status === "Partial").length} partial ·{" "}
          {due.filter((s) => s.status === "Skipped").length} skipped
        </p>
        <p className="muted">
          Past due sessions and today’s Done/Partial sessions, excluding rest.
          Partial counts as half.
        </p>
      </Card>
      <div className="grid">
        <Card title="Running distance">
          <strong className="stat">
            {(meters / 1000).toFixed(1)} <small>km</small>
          </strong>
          <p>
            From recorded runs; reported and validated GPS provenance are
            retained.
          </p>
        </Card>
        <Card title="Time on feet">
          <strong className="stat">
            {Math.round(minutes)} <small>min</small>
          </strong>
          <p>Elapsed recorded running time; not a claim of moving time.</p>
        </Card>
      </div>
      <Card title="Load by date">
        {[...new Set(workouts.map((w) => localDate(new Date(w.start))))]
          .sort()
          .map((date) => (
            <p key={date}>
              {date} ·{" "}
              {Math.round(
                workouts
                  .filter((w) => localDate(new Date(w.start)) === date)
                  .reduce((sum, w) => sum + (durationMinutes(w) ?? 0), 0),
              )}{" "}
              minutes
            </p>
          ))}
        {!workouts.length && (
          <p>No recorded runs yet. Add one in Activities.</p>
        )}
      </Card>
    </>
  );
}
function Activities({ app }: { app: Training }) {
  return (
    <>
      <Card title="Recent workouts">
        {[...app.records.workouts]
          .sort((a, b) => b.start.localeCompare(a.start))
          .map((w) => (
            <article className="session" key={w.id}>
              <span className="chip">{w.type}</span>
              <h3>{w.title}</h3>
              <p>
                {new Date(w.start).toLocaleString()} ·{" "}
                {Math.round(durationMinutes(w) ?? 0)} min
              </p>
              <p>
                {effectiveMeters(w) === null
                  ? "No distance"
                  : `${((effectiveMeters(w) ?? 0) / 1000).toFixed(2)} km`}{" "}
                ·{" "}
                {pace(w.type, durationMinutes(w), effectiveMeters(w)) ??
                  "Pace unavailable"}
              </p>
              <p className="muted">
                Source: {w.source} · Distance: {w.distanceSource} · Raw:{" "}
                {w.reportedMeters ?? "—"} m · GPS: {w.gpsMeters ?? "—"} m
              </p>
            </article>
          ))}
        {!app.records.workouts.length && (
          <p>No workouts recorded yet. A GPS track is not required.</p>
        )}
      </Card>
      <Card title="Record a workout">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            const id = freshId();
            const distance = String(f.get("km"));
            void app.action(async () => {
              const row: Workout = {
                id,
                title: String(f.get("title")).trim(),
                type: f.get("type") as Workout["type"],
                start: new Date(String(f.get("start"))).toISOString(),
                end: new Date(String(f.get("end"))).toISOString(),
                reportedMeters:
                  distance === "" ? null : Number(distance) * 1000,
                gpsMeters: null,
                distanceSource: distance === "" ? "unavailable" : "reported",
                qualityFlags: [
                  distance === "" ? "no-distance" : "unvalidated-summary",
                ],
                source: "manual",
                sourceId: id,
                averageHr: null,
              };
              await app.save("workouts", row);
              form.reset();
            });
          }}
        >
          <fieldset disabled={disabled(app)}>
            <legend>Workout details</legend>
            <div className="form-grid">
              <label>
                Workout name
                <input name="title" maxLength={120} required />
              </label>
              <label>
                Activity type
                <select name="type">
                  {kinds
                    .filter((k) => k !== "Rest")
                    .map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                </select>
              </label>
              <label>
                Start time
                <input type="datetime-local" name="start" required />
              </label>
              <label>
                End time
                <input type="datetime-local" name="end" required />
              </label>
              <label>
                Reported distance (km, optional)
                <input type="number" min="0" max="500" step="0.001" name="km" />
              </label>
              <button>Save workout</button>
            </div>
          </fieldset>
        </form>
      </Card>
    </>
  );
}
const measurements = [
  ["restingHr", "Resting HR (bpm)", 25, 220],
  ["hrv", "HRV RMSSD (ms)", 0, 300],
  ["sleepHours", "Sleep (hours)", 0, 24],
  ["soreness", "Soreness (1–5)", 1, 5],
  ["rpe", "RPE (1–10)", 1, 10],
  ["steps", "Steps", 0, 200000],
] as const;
function Health({ app }: { app: Training }) {
  const [date, setDate] = useState(localDate());
  const metric = app.records.metrics.find((m) => m.date === date);
  return (
    <>
      <Card title="Daily recovery">
        <label>
          Check-in date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>
        <form
          key={`${date}-${metric?.id ?? "empty"}`}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const row: Metric = {
              id: date,
              date,
              restingHr: null,
              hrv: null,
              sleepHours: null,
              soreness: null,
              rpe: null,
              steps: null,
              notes: String(f.get("notes")),
            };
            for (const [key] of measurements) {
              const value = String(f.get(key));
              row[key] = value === "" ? null : Number(value);
            }
            void app.action(() => app.save("metrics", row));
          }}
        >
          <fieldset disabled={disabled(app)}>
            <legend>Recovery check-in</legend>
            <div className="form-grid">
              {measurements.map(([key, label, min, max]) => (
                <label key={key}>
                  {label}
                  <input
                    name={key}
                    type="number"
                    step={
                      key === "soreness" || key === "rpe" || key === "steps"
                        ? "1"
                        : "0.1"
                    }
                    min={min}
                    max={max}
                    defaultValue={metric?.[key] ?? ""}
                  />
                </label>
              ))}
              <label className="full">
                Recovery notes
                <textarea
                  name="notes"
                  maxLength={2000}
                  defaultValue={metric?.notes}
                />
              </label>
              <button>Save check-in</button>
            </div>
          </fieldset>
        </form>
      </Card>
      <Card title="Health data sources">
        <p>
          This PWA does not read Android Health Connect. Manual check-ins work
          now; private CSV/TCX ingestion and Google Drive authorization are
          future work.
        </p>
        <p>
          Nothing synchronizes while the browser is closed. Readiness is a
          limited training heuristic, not medical advice.
        </p>
      </Card>
    </>
  );
}
function Settings({ app }: { app: Training }) {
  const [confirmation, setConfirmation] = useState("");
  return (
    <>
      <Card title="Account and privacy">
        {configError && (
          <p role="alert">
            Firebase configuration is incomplete. Demo only until all four
            public configuration values are supplied.
          </p>
        )}
        {app.user ? (
          <>
            <p>Signed in as {app.user.email ?? "your Google account"}</p>
            <div className="actions">
              <button
                disabled={app.busy || !app.online}
                onClick={() => void app.switchAccount()}
              >
                Switch Google account
              </button>
              <button
                className="secondary"
                onClick={() => void app.signOutNow()}
              >
                Sign out
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              {configured
                ? "Sign in for your private cloud workspace. Demo records will not be copied to it."
                : "Firebase is not configured. You are using a synthetic memory-only demo."}
            </p>
            <button
              disabled={!configured || !app.online || app.busy}
              onClick={() => void app.signIn()}
            >
              Continue with Google
            </button>
          </>
        )}
        <p className="muted">
          No persistent health cache or saved login on this device. Reloading
          the page signs you out; the static app shell can work offline. Shared
          devices should use a private browser session.
        </p>
      </Card>
      <Card title="Export data">
        <p>
          Your download contains private records. Store it securely and do not
          commit it to Git.
        </p>
        <button
          disabled={disabled(app)}
          onClick={() =>
            void app.action(async () => {
              const records = app.user
                ? await userStore(app.user.uid).readAll()
                : app.records;
              const blob = new Blob(
                [
                  JSON.stringify(
                    { version: 1, mock: !app.user, records },
                    null,
                    2,
                  ),
                ],
                { type: "application/json" },
              );
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = "training-hq-export.json";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            })
          }
        >
          Export {app.user ? "my records" : "mock records"}
        </button>
      </Card>
      {app.user && (
        <Card title="Delete account">
          <p>
            This permanently removes records in this app and then your Firebase
            sign-in account. Google Drive and Sheets are never changed. Close
            other app tabs first. If interrupted, repeat before leaving;
            deletion uses multiple batches.
          </p>
          <label>
            Type DELETE to confirm
            <input
              autoComplete="off"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <button
            className="danger"
            disabled={confirmation !== "DELETE" || disabled(app)}
            onClick={() =>
              void app.action(async () => {
                const uid = app.user?.uid;
                if (!uid) return;
                await confirmIdentity();
                await userStore(uid).deleteAll();
                await removeAuthAccount();
                await app.signOutNow();
              })
            }
          >
            Delete my app data and account
          </button>
        </Card>
      )}
      <Card title="About this milestone">
        <p>
          Free-tier, browser-only architecture. No Strava integration, paid
          backend, production Drive access or background synchronization. See
          repository documentation for deployment and quotas.
        </p>
      </Card>
    </>
  );
}
export function Dashboard({ tab, app }: { tab: Tab; app: Training }) {
  switch (tab) {
    case "Today":
      return <Today app={app} />;
    case "Plan":
      return <Plan app={app} />;
    case "Progress":
      return <Progress app={app} />;
    case "Activities":
      return <Activities app={app} />;
    case "Health":
      return <Health app={app} />;
    case "Settings":
      return <Settings app={app} />;
  }
}
