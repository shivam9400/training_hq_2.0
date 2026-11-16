export const TEST_REPOSITORY = "training-hq-drive-test";
export const LIVE_ORIGIN = "https://shivam9400.github.io";
export type RuntimeMode = "local" | "hosted" | "codespace";
export type PublicSettings = {
  clientId: string;
  pickerKey: string;
  appId: string;
};
export function hostedSite(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Set the exact temporary diagnostic site URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.origin === LIVE_ORIGIN ||
    !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\.github\.io$/.test(
      url.origin,
    ) ||
    url.pathname !== `/${TEST_REPOSITORY}/`
  )
    throw new Error(
      "Hosted tests require a different GitHub owner and the dedicated training-hq-drive-test repository; the live origin is forbidden.",
    );
  return { origin: url.origin, base: url.pathname, url: url.href };
}
export function codespaceSite(name: string, domain: string) {
  if (!/^[a-z0-9-]{1,100}$/.test(name) || domain !== "app.github.dev")
    throw new Error(
      "Use an actual private GitHub Codespace with the standard app.github.dev forwarding domain.",
    );
  return `https://${name}-5173.${domain}/`;
}
export function assertRuntime(
  mode: RuntimeMode,
  siteUrl: string,
  href: string,
  development: boolean,
  framed = false,
) {
  const location = new URL(href);
  if (framed) throw new Error("Do not run the diagnostic inside another page.");
  if (mode === "local") {
    if (!development || location.origin !== "http://localhost:5173")
      throw new Error("Local diagnostic origin required.");
    return;
  }
  const target = new URL(siteUrl);
  if (mode === "hosted") hostedSite(siteUrl);
  else if (
    !development ||
    !/^https:\/\/[a-z0-9-]+-5173\.app\.github\.dev\/$/.test(siteUrl)
  )
    throw new Error("Private Codespace development URL required.");
  if (
    location.origin === LIVE_ORIGIN ||
    location.origin !== target.origin ||
    ![target.pathname, `${target.pathname}index.html`].includes(
      location.pathname,
    ) ||
    location.search ||
    location.hash
  )
    throw new Error(
      "Diagnostic origin/path does not match its build allowlist.",
    );
}
export function publicSettings(value: PublicSettings): PublicSettings {
  const settings = {
    clientId: value.clientId.trim(),
    pickerKey: value.pickerKey.trim(),
    appId: value.appId.trim(),
  };
  if (
    !/^[A-Za-z0-9_-]{1,200}\.apps\.googleusercontent\.com$/.test(
      settings.clientId,
    ) ||
    settings.pickerKey.length < 1 ||
    settings.pickerKey.length > 256 ||
    !/^\d{1,30}$/.test(settings.appId) ||
    Object.values(settings).some((v) => v.startsWith("GOCSPX-"))
  )
    throw new Error(
      "Use the replacement public Web Client ID, public browser API key and numeric test project number. Never enter a Client Secret.",
    );
  return settings;
}
export function csp(mode: RuntimeMode, origin: string) {
  const socket =
    mode === "local"
      ? " ws://localhost:5173"
      : mode === "codespace"
        ? ` ${origin.replace("https:", "wss:")}`
        : "";
  return `default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client https://apis.google.com https://www.gstatic.com; style-src 'self' 'unsafe-inline'; connect-src 'self'${socket} https://www.googleapis.com https://accounts.google.com https://oauth2.googleapis.com; frame-src https://accounts.google.com https://docs.google.com https://drive.google.com; worker-src 'self'; img-src 'self' data: https://*.googleusercontent.com https://www.gstatic.com; object-src 'none'; base-uri 'none'; form-action https://accounts.google.com`;
}
