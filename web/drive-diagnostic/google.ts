import { DiagnosticError, SCOPE, id, object } from "./core";
type TokenClient = {
  requestAccessToken: (options: { prompt: string }) => void;
};
type Picker = { setVisible: (v: boolean) => void; dispose: () => void };
type View = {
  setIncludeFolders: (v: boolean) => View;
  setSelectFolderEnabled: (v: boolean) => View;
};
type Builder = {
  setOAuthToken: (v: string) => Builder;
  setDeveloperKey: (v: string) => Builder;
  setAppId: (v: string) => Builder;
  setOrigin: (v: string) => Builder;
  addView: (v: View) => Builder;
  setCallback: (f: (v: unknown) => void) => Builder;
  enableFeature: (v: string) => Builder;
  build: () => Picker;
};
declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            include_granted_scopes: boolean;
            callback: (response: unknown) => void;
            error_callback: () => void;
          }) => TokenClient;
        };
      };
      picker?: {
        DocsView: new (view?: string) => View;
        PickerBuilder: new () => Builder;
        ViewId: { FOLDERS: string };
        Feature: { MULTISELECT_ENABLED: string };
      };
    };
    gapi?: {
      load: (
        name: string,
        options: {
          callback: () => void;
          onerror: () => void;
          timeout: number;
          ontimeout: () => void;
        },
      ) => void;
    };
  }
}
const scripts = new Map<string, Promise<void>>();
function script(
  url:
    | "https://accounts.google.com/gsi/client"
    | "https://apis.google.com/js/api.js",
) {
  let promise = scripts.get(url);
  if (!promise) {
    promise = new Promise<void>((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = url;
      tag.async = true;
      tag.referrerPolicy = "strict-origin";
      const fail = () => {
        clearTimeout(timer);
        tag.remove();
        scripts.delete(url);
        reject(
          new DiagnosticError(
            null,
            "Google SDK failed to load. Check the test project, network and browser popup policy.",
          ),
        );
      };
      const timer = setTimeout(fail, 15000);
      tag.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      tag.onerror = fail;
      document.head.append(tag);
    });
    scripts.set(url, promise);
  }
  return promise;
}
export const identityReady = () => Boolean(window.google?.accounts?.oauth2);
export const prepareIdentity = () =>
  script("https://accounts.google.com/gsi/client");
export async function authorize(clientId: string): Promise<unknown> {
  if (!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId))
    throw new DiagnosticError(
      null,
      "Set the replacement test Web Client ID in the diagnostic test settings.",
    );
  await script("https://accounts.google.com/gsi/client");
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) throw new DiagnosticError(null, "GIS token model unavailable.");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: unknown, failed = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (failed)
        reject(
          new DiagnosticError(
            null,
            "Google authorization denied, cancelled, blocked or timed out. No token retained.",
          ),
        );
      else resolve(value);
    };
    const timer = setTimeout(() => finish(null, true), 60000);
    const client = oauth.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      include_granted_scopes: false,
      callback: (response) => {
        const value = object(response);
        finish(value, Boolean(value.error));
      },
      error_callback: () => finish(null, true),
    });
    try {
      client.requestAccessToken({ prompt: "select_account" });
    } catch {
      finish(null, true);
    }
  });
}
export class PickerBridge {
  private picker: Picker | null = null;
  close() {
    this.picker?.setVisible(false);
    this.picker?.dispose();
    this.picker = null;
  }
  async open(
    mode: "folder" | "files",
    token: string,
    key: string,
    appId: string,
    stillValid: () => boolean,
    onSelected: (ids: string[]) => void,
  ) {
    this.close();
    if (!key || !/^\d+$/.test(appId))
      throw new DiagnosticError(
        null,
        "Set a test-project Picker browser API key and numeric project number; check Picker API is enabled.",
      );
    await script("https://apis.google.com/js/api.js");
    await new Promise<void>((resolve, reject) => {
      if (!window.gapi) {
        reject(new DiagnosticError(null, "Google API loader unavailable."));
        return;
      }
      window.gapi.load("picker", {
        callback: resolve,
        onerror: () =>
          reject(
            new DiagnosticError(
              null,
              "Picker unavailable. Check Google Picker API and API-key restrictions.",
            ),
          ),
        timeout: 15000,
        ontimeout: () =>
          reject(new DiagnosticError(null, "Picker loading timed out.")),
      });
    });
    if (!stillValid()) return;
    const p = window.google?.picker;
    if (!p) throw new DiagnosticError(null, "Picker module unavailable.");
    const view =
      mode === "folder"
        ? new p.DocsView(p.ViewId.FOLDERS)
            .setIncludeFolders(true)
            .setSelectFolderEnabled(true)
        : new p.DocsView()
            .setIncludeFolders(false)
            .setSelectFolderEnabled(false);
    const builder = new p.PickerBuilder()
      .setOAuthToken(token)
      .setDeveloperKey(key)
      .setAppId(appId)
      .setOrigin(location.origin)
      .addView(view)
      .setCallback((raw) => {
        const response = object(raw);
        if (response.action === "cancel") {
          this.close();
          return;
        }
        if (response.action !== "picked") return;
        this.close();
        if (!stillValid()) return;
        try {
          if (
            !Array.isArray(response.docs) ||
            !response.docs.length ||
            response.docs.length > (mode === "folder" ? 1 : 10)
          )
            throw new Error();
          onSelected([
            ...new Set(response.docs.map((value) => id(object(value).id))),
          ]);
        } catch {
          onSelected([]);
        }
      });
    if (mode === "files") builder.enableFeature(p.Feature.MULTISELECT_ENABLED);
    this.picker = builder.build();
    this.picker.setVisible(true);
  }
}
