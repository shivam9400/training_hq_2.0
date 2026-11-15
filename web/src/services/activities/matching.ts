import { doc, runTransaction, type Firestore } from "firebase/firestore";
import type { Session, Workout } from "../../types/data";
import { schemas } from "../../types/data";
import { localDate, durationMinutes } from "../calculations";
import { sameRecord } from "../planImport";
import { ImportStale } from "../importExecution";
export function suggestedSessions(
  workout: Workout,
  sessions: Session[],
): Session[] {
  const duration = durationMinutes(workout);
  return sessions.filter(
    (s) =>
      !s.actualWorkoutId &&
      s.type !== "Rest" &&
      s.date === localDate(new Date(workout.start)) &&
      (s.type === workout.type ||
        (s.type === "Race" && workout.type === "Run")) &&
      (s.minutes === 0 ||
        (duration !== null &&
          duration >= s.minutes * 0.5 &&
          duration <= s.minutes * 1.5)),
  );
}
export function confirmedActual(
  session: Session,
  workouts: Workout[],
): Workout | undefined {
  return workouts.find(
    (w) => w.id === session.actualWorkoutId && w.matchSessionId === session.id,
  );
}
export async function confirmMatch(
  database: Firestore,
  uid: string,
  input: {
    workout: Workout;
    session: Session | null;
    previous: Session | null;
    markDone: boolean;
  },
  assertOwner: () => void,
) {
  const guard = () => assertOwner();
  guard();
  const wref = doc(database, "users", uid, "workouts", input.workout.id);
  await runTransaction(
    database,
    async (tx) => {
      guard();
      const wsnap = await tx.get(wref);
      guard();
      if (!wsnap.exists() || !sameRecord(wsnap.data(), input.workout))
        throw new ImportStale();
      const previousId = input.workout.matchSessionId;
      let previousRef, previous;
      if (previousId && previousId !== input.session?.id) {
        previousRef = doc(database, "users", uid, "sessions", previousId);
        const snapshot = await tx.get(previousRef);
        guard();
        if (
          !snapshot.exists() ||
          !input.previous ||
          !sameRecord(snapshot.data(), input.previous) ||
          input.previous.actualWorkoutId !== input.workout.id
        )
          throw new ImportStale();
        previous = schemas.sessions.parse(snapshot.data());
      }
      let nextRef, next;
      if (input.session) {
        nextRef = doc(database, "users", uid, "sessions", input.session.id);
        const snapshot = await tx.get(nextRef);
        guard();
        if (!snapshot.exists() || !sameRecord(snapshot.data(), input.session))
          throw new ImportStale();
        next = schemas.sessions.parse(snapshot.data());
        if (next.actualWorkoutId && next.actualWorkoutId !== input.workout.id)
          throw new Error(
            "Session already matched; unmatch it explicitly first.",
          );
      }
      guard();
      if (previousRef && previous)
        tx.set(previousRef, { ...previous, actualWorkoutId: null });
      if (nextRef && next)
        tx.set(
          nextRef,
          schemas.sessions.parse({
            ...next,
            actualWorkoutId: input.workout.id,
            ...(input.markDone ? { status: "Done" } : {}),
          }),
        );
      tx.set(
        wref,
        schemas.workouts.parse({
          ...input.workout,
          matchSessionId: input.session?.id ?? null,
        }),
      );
    },
    { maxAttempts: 3 },
  );
}
