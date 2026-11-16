import { useState } from "react";
import type { Training } from "../hooks/useTraining";
import type { Workout } from "../types/data";
import { suggestedSessions } from "../services/activities/matching";
import { localDate, durationMinutes } from "../services/calculations";
import { sortSessions } from "../services/planImport";
export function ActivityMatch({
  app,
  workout,
}: {
  app: Training;
  workout: Workout;
}) {
  const [selected, setSelected] = useState(workout.matchSessionId ?? ""),
    [ack, setAck] = useState(false),
    [done, setDone] = useState(false);
  const suggestions = suggestedSessions(workout, app.records.sessions),
    session = app.records.sessions.find((s) => s.id === selected),
    current = app.records.sessions.find((s) => s.id === workout.matchSessionId);
  const mismatch =
    session &&
    (session.date !== localDate(new Date(workout.start)) ||
      !(
        session.type === workout.type ||
        (session.type === "Race" && workout.type === "Run")
      ));
  const disabled = app.busy || (app.user && (!app.online || !app.loaded));
  return (
    <details>
      <summary>
        Match planned session {current ? `· ${current.title}` : "· not matched"}
      </summary>
      <p>
        Suggestions use this device's local date, compatible activity type and
        elapsed duration ({(durationMinutes(workout) ?? 0).toFixed(1)} min).{" "}
        {suggestions.length === 1
          ? "One plausible candidate; confirmation still required."
          : `${suggestions.length} possible candidates; none is chosen automatically.`}
      </p>
      <label>
        Planned session for {workout.title}
        <select
          disabled={Boolean(disabled)}
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setAck(false);
            setDone(false);
          }}
        >
          <option value="">Choose a session</option>
          {[...app.records.sessions]
            .filter((s) => s.type !== "Rest")
            .sort(sortSessions)
            .map((s) => (
              <option
                disabled={Boolean(
                  s.actualWorkoutId && s.actualWorkoutId !== workout.id,
                )}
                value={s.id}
                key={s.id}
              >
                {s.date} · {s.slot ? `Slot ${s.slot} · ` : ""}
                {s.type} · {s.title} · {s.minutes} min{" "}
                {suggestions.some((c) => c.id === s.id) ? "· candidate" : ""}
                {s.actualWorkoutId && s.actualWorkoutId !== workout.id
                  ? "· already matched"
                  : ""}
              </option>
            ))}
        </select>
      </label>
      {mismatch && (
        <p className="banner">
          Date/type differs. Confirm only with independent evidence; linking
          generic TRAINING does not reclassify it as strength/yoga.
        </p>
      )}
      <label className="check-label">
        <input
          type="checkbox"
          checked={ack}
          disabled={Boolean(disabled)}
          onChange={(e) => setAck(e.target.checked)}
        />
        I confirm this workout belongs to the selected planned session.
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={done}
          disabled={Boolean(disabled)}
          onChange={(e) => setDone(e.target.checked)}
        />
        Also mark this session Done (explicit status change).
      </label>
      <button
        disabled={Boolean(disabled) || !session || !ack}
        onClick={() =>
          void app.action(() => app.matchActivity(workout, session!, done))
        }
      >
        Confirm workout match
      </button>
      {workout.matchSessionId && (
        <button
          className="secondary"
          disabled={Boolean(disabled)}
          onClick={() =>
            void app.action(() => app.matchActivity(workout, null, false))
          }
        >
          Confirm unmatch
        </button>
      )}
      <p className="muted">
        Matching changes only reciprocal links unless you explicitly request
        Done. Unmatching never resets a completion status. A session already
        linked to another workout must be unmatched first.
      </p>
    </details>
  );
}
