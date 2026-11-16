import { useEffect, useRef, useState } from "react";
import type { Training } from "../hooks/useTraining";
import { userStore } from "../services/store";
import {
  folderUrl,
  parseFolderUrl,
  type HealthSyncConfig,
} from "../services/healthSyncConfig";
import { Card } from "./Card";
export function HealthSyncIntegration({ app }: { app: Training }) {
  const uid = app.user?.uid;
  const [saved, setSaved] = useState<HealthSyncConfig | null>(null);
  const [draft, setDraft] = useState<HealthSyncConfig | null>(null);
  const [value, setValue] = useState("");
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const epoch = generation;
    const current = ++epoch.current;
    setSaved(null);
    setDraft(null);
    setValue("");
    setReady(false);
    setMessage("");
    if (uid && app.loaded && app.online) {
      setBusy(true);
      void Promise.resolve()
        .then(() => userStore(uid).healthSync().read())
        .then((config) => {
          if (current !== generation.current) return;
          setSaved(config);
          setValue(config ? folderUrl(config.folderId) : "");
          setReady(true);
        })
        .catch(() => {
          if (current === generation.current)
            setMessage(
              "Folder settings unavailable. Check connectivity and owner publication of the reviewed integration rules. Training records remain available separately.",
            );
        })
        .finally(() => {
          if (current === generation.current) setBusy(false);
        });
    } else setBusy(false);
    return () => {
      ++epoch.current;
    };
  }, [uid, app.loaded, app.online]);
  const canSave = Boolean(uid && ready && app.online && !busy && !app.busy);
  return (
    <Card title="Health Sync Integration">
      <p>
        Save a private folder reference for later authorization. This does not
        connect Google Drive or verify access.
      </p>
      <p>
        Firebase destination: {app.user?.email ?? "sign in first"}. Drive
        account: not connected; it may be different from your Firebase Google
        account.
      </p>
      <p id="drive-authorization-gate" className="banner">
        Folder-wide sync is unavailable until Google scope, consent and
        two-account access tests are verified. Choosing a folder does not
        authorize future Health Sync files. No Drive permissions are requested
        here.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setMessage("");
          setDraft(null);
          try {
            setDraft(parseFolderUrl(value));
          } catch {
            setMessage(
              "Invalid folder URL. Use an HTTPS drive.google.com/drive/folders/… link. File links, credentials, resource keys and unknown query parameters are not accepted.",
            );
          }
        }}
      >
        <label>
          Health Sync Google Drive folder URL
          <input
            type="url"
            value={value}
            required
            maxLength={2048}
            onChange={(e) => {
              setValue(e.target.value);
              setDraft(null);
              setMessage("");
            }}
            disabled={busy || app.busy}
          />
        </label>
        <button disabled={busy || app.busy}>Validate folder URL locally</button>
      </form>
      {busy && <p role="status">Loading or saving private folder settings…</p>}
      {saved && (
        <p>
          Saved reference: {folderUrl(saved.folderId)} · Access not checked.
        </p>
      )}
      {draft && (
        <>
          <p>
            URL syntax accepted: {folderUrl(draft.folderId)}. Folder existence
            and access are unverified.
          </p>
          <button
            disabled={!canSave}
            onClick={async () => {
              if (!uid || !canSave) return;
              const current = ++generation.current;
              setBusy(true);
              setMessage("");
              try {
                const config = await userStore(uid).healthSync().save(draft);
                if (current === generation.current) {
                  setSaved(config);
                  setDraft(null);
                  setMessage(
                    "Folder reference saved privately. Access is still unverified; no Drive request was made.",
                  );
                }
              } catch {
                if (current === generation.current)
                  setMessage(
                    "Folder setting was not confirmed saved. Reload Settings before retrying.",
                  );
              } finally {
                if (current === generation.current) setBusy(false);
              }
            }}
          >
            Save folder reference to my account
          </button>
        </>
      )}
      <button disabled aria-describedby="drive-authorization-gate">
        Connect Google Drive — verification pending
      </button>
      {saved && (
        <button
          className="secondary"
          disabled={!canSave}
          onClick={async () => {
            if (!uid || !canSave) return;
            const current = generation.current;
            setBusy(true);
            try {
              const config = await userStore(uid).healthSync().read();
              if (current !== generation.current || !config) return;
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(config, null, 2)], {
                  type: "application/json",
                }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "training-hq-folder-settings.json";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch {
              if (current === generation.current)
                setMessage(
                  "Could not export folder settings. Check connectivity and access.",
                );
            } finally {
              if (current === generation.current) setBusy(false);
            }
          }}
        >
          Export private folder settings
        </button>
      )}
      {!uid && (
        <p>
          Local URL validation only. Sign in to save; no demo folder is copied
          into an account.
        </p>
      )}
      {message && (
        <p role="status" className="banner">
          {message}
        </p>
      )}
      <p>
        Fallback available now: download your own exports privately and use
        Activities → Import Activities. Google Picker per-file selection remains
        a design pending OAuth verification, not a working connection.
      </p>
      <p className="muted">
        Only the folder ID and an unverified status are saved. No tokens, file
        bodies or Google account claims. Folder settings have a separate private
        export here; training-record exports do not include them. Nothing runs
        while the browser is closed.
      </p>
    </Card>
  );
}
export function DriveSyncGate() {
  return (
    <Card title="Google Drive Health Sync">
      <p id="drive-sync-unavailable">
        Folder sync is not authorized in this release. Save a reference in
        Settings → Health Sync Integration. OAuth feasibility and access tests
        are still required, including access to future nested files.
      </p>
      <button disabled aria-describedby="drive-sync-unavailable">
        Sync Activities — unavailable
      </button>
      <p>
        Use Import Activities below with privately downloaded exports. The
        existing preview, GPS checks, deduplication and confirmation apply.
        Drive files are never modified or deleted.
      </p>
    </Card>
  );
}
