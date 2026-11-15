import { useCallback, useEffect, useRef, useState } from "react";
import { ZodError } from "zod";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth, configured, login, logout } from "../services/firebase";
import type { ActivityPreview } from "../services/activities/preview";
import type { Session, Workout } from "../types/data";
import type { ImportPreview } from "../services/planImport";
import type { ImportOptions } from "../services/importExecution";
import { userStore } from "../services/store";
import { demoRecords } from "../services/demo";
import {
  emptyRecords,
  validateRow,
  type Collection,
  type Records,
  type Row,
} from "../types/data";
export function useTraining() {
  const [user, setUser] = useState<User | null>(null);
  const [records, setRecords] = useState<Records>(emptyRecords);
  const [mode, setMode] = useState<"loading" | "demo" | "cloud">(
    configured ? "loading" : "demo",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(!configured);
  const [online, setOnline] = useState(navigator.onLine);
  const epoch = useRef(0);
  const identity = useRef<string | null>(null);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const load = useCallback(async (account: User) => {
    const current = ++epoch.current;
    setRecords(emptyRecords());
    setMode("loading");
    setError("");
    setLoaded(false);
    try {
      const data = await userStore(account.uid).readAll();
      if (current === epoch.current) {
        setRecords(data);
        setMode("cloud");
        setLoaded(true);
      }
    } catch {
      if (current === epoch.current) {
        setRecords(emptyRecords());
        setMode("cloud");
        setError(
          "Could not load private data. Check your connection and Firebase rules, then retry.",
        );
      }
    }
  }, []);
  useEffect(() => {
    if (!auth) {
      setRecords(demoRecords());
      setLoaded(true);
      return;
    }
    const generation = epoch;
    const unsubscribe = onAuthStateChanged(auth, (account) => {
      identity.current = account?.uid ?? null;
      ++epoch.current;
      setUser(account);
      setRecords(emptyRecords());
      setBusy(false);
      setError("");
      if (account) void load(account);
      else {
        setMode("demo");
        setRecords(demoRecords());
        setLoaded(true);
      }
    });
    return () => {
      ++generation.current;
      unsubscribe();
    };
  }, [load]);
  async function action(operation: () => Promise<void>) {
    if (busy) return;
    const owner = identity.current;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (cause) {
      if (owner === identity.current)
        setError(
          cause instanceof ZodError
            ? `Check the form: ${cause.issues[0]?.message ?? "Invalid fields"}`
            : "Action failed. Nothing is assumed saved. Check connectivity, permissions or popup settings and retry.",
        );
    } finally {
      if (owner === identity.current) setBusy(false);
    }
  }
  async function save(name: Collection, row: Row) {
    const data = validateRow(name, row);
    const owner = identity.current;
    if (user) await userStore(user.uid).save(name, data);
    if (owner !== identity.current) return;
    setRecords((old) => ({
      ...old,
      [name]: [...old[name].filter((r) => r.id !== data.id), data],
    }));
  }
  async function signOutNow() {
    ++epoch.current;
    identity.current = null;
    setRecords(emptyRecords());
    setUser(null);
    setMode("loading");
    try {
      await logout();
    } catch {
      setError(
        "Sign-out did not complete. Close this page to clear the memory-only session.",
      );
    } finally {
      setRecords(demoRecords());
      setMode("demo");
      setLoaded(true);
    }
  }
  return {
    user,
    records,
    mode,
    busy,
    error,
    online,
    loaded,
    action,
    save,
    async importPlan(
      preview: ImportPreview,
      options: Omit<ImportOptions, "assertOwner">,
    ) {
      if (!user || !loaded || identity.current !== user.uid)
        throw new Error("Sign in and load your private workspace first");
      const uid = user.uid;
      const result = await userStore(uid).importPlan(preview, options);
      const updated = await userStore(uid).readAll();
      if (identity.current === uid) setRecords(updated);
      return result;
    },
    async importActivities(
      preview: ActivityPreview,
      options: Omit<ImportOptions, "assertOwner">,
    ) {
      if (!user || !loaded || identity.current !== user.uid)
        throw new Error("Sign in first");
      const uid = user.uid,
        result = await userStore(uid).importActivities(preview, options);
      const updated = await userStore(uid).readAll();
      if (identity.current === uid) setRecords(updated);
      return result;
    },
    async matchActivity(
      workout: Workout,
      session: Session | null,
      markDone = false,
    ) {
      if (!user) {
        // Explicit links can be explored with synthetic demo data only.
        setRecords((old) => ({
          ...old,
          workouts: old.workouts.map((w) =>
            w.id === workout.id
              ? { ...w, matchSessionId: session?.id ?? null }
              : w,
          ),
          sessions: old.sessions.map((s) =>
            s.id === session?.id
              ? {
                  ...s,
                  actualWorkoutId: workout.id,
                  ...(markDone ? { status: "Done" as const } : {}),
                }
              : s.id === workout.matchSessionId
                ? { ...s, actualWorkoutId: null }
                : s,
          ),
        }));
        return;
      }
      const uid = user.uid;
      await userStore(uid).matchActivity({
        workout,
        session,
        previous:
          records.sessions.find((s) => s.id === workout.matchSessionId) ?? null,
        markDone,
      });
      const updated = await userStore(uid).readAll();
      if (identity.current === uid) setRecords(updated);
    },
    refresh: () => {
      if (user) void load(user);
    },
    signIn: () => action(login),
    signOutNow,
    switchAccount: () =>
      action(async () => {
        await signOutNow();
        await login();
      }),
  };
}
export type Training = ReturnType<typeof useTraining>;
