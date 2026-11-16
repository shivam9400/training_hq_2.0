# Browser-only hosted Drive permission experiment

This is an isolated, synthetic-data diagnostic, **not production sync**. Nothing
has been deployed or authorized by this change. Real Google permissions, including
future-child discovery, remain unverified until consenting test users run the
matrix in [the diagnostic guide](drive-oauth-test-guide.md). The localhost entry
point remains available unchanged.

## Why a separate owner is required

A second repository under `shivam9400` would share the live application's origin,
`https://shivam9400.github.io`. Paths do not isolate browser storage, OAuth origins
or service workers. The deployment guard therefore refuses **every repository
owned by shivam9400**, not just training_hq_2.0. Use a dedicated test GitHub owner
or organization with no other Pages applications or untrusted repositories. Do
not use a custom domain. The fixed test repository name is `training-hq-drive-test`.

The resulting URL is `https://TEST_OWNER.github.io/training-hq-drive-test/`.
Replace TEST_OWNER with the actual lowercase owner throughout these instructions.
The allowlist is generated from the actual deployment repository; arbitrary domains,
paths, query strings, framing and an existing controlling service worker are refused.
GitHub Pages assets are public. They contain no credentials, results or private data.
The owner must confirm free public-repository Pages availability for that account;
no visibility, billing or production setting is changed automatically.

GitHub documents the shared owner origin and project paths in its
[official Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).
Google's [token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model),
[Picker authorization](https://developers.google.com/drive/picker/guides/overview),
[Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
and [OAuth web-origin rules](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow#creatingcred)
remain the governing references. This implementation does not establish Google's
acceptance of a particular github.io or app.github.dev origin or public verification
eligibility. If the test project's console rejects the origin/domain, stop and use
the private Codespaces option below; do not claim or bypass domain verification.

## GitHub setup, entirely in your browser

1. Create a **new empty public** repository named `training-hq-drive-test` under
   your dedicated different test owner. Do not fork the application or copy its
   history, data, secrets or Firebase configuration. Initialize a README on main.
2. In the reviewed source PR, open `.github/workflows/drive-diagnostic-pages.yml`,
   select Raw and copy its contents. In the new test repository use **Add file >
   Create new file**, name it `.github/workflows/drive-diagnostic-pages.yml`, paste
   the workflow and commit to main. No push event publishes anything.
3. In the **test repository only**, Settings > Secrets and variables > Actions >
   Variables: add `APPROVED_DIAGNOSTIC_REPOSITORY` = `TEST_OWNER/training-hq-drive-test`.
   This is a public target name, not an OAuth credential. Do not add OAuth values
   or Firebase secrets to Actions.
4. Settings > Pages: select **GitHub Actions** as source, no custom domain, HTTPS.
   Settings > Environments: configure **github-pages** with an owner approval
   reviewer and deployment branch restricted to main. Ensure the intended reviewer
   can approve the initiating owner's run (or use a second reviewer). Confirm your
   account supports the required protection; if not, do not proceed with this
   protected-publication procedure. These settings belong only to the new repo.
5. Copy the full **40-character reviewed source commit SHA** from the source PR's
   Commits tab. The workflow fetches that exact public source commit; it does not
   need merging. If the source repository becomes private, stop rather than adding
   a broad PAT or publishing private source/history. Use Codespaces instead.
6. In the **test repo's** Actions tab select **Temporary Drive diagnostic Pages
   (isolated repository only)** > Run workflow on main. First use the reviewed SHA
   and leave deploy unchecked for a build-only check. It verifies the actual Pages
   URL, Actions source and absence of a custom domain. No artifact is published.
7. When you explicitly approve publication, run again with the same reviewed SHA,
   check deploy and type exactly `DEPLOY TEMPORARY DRIVE DIAGNOSTIC`. Review the build
   then approve the waiting **github-pages** environment. This is the final owner
   deployment action. The workflow rechecks the target before deploying only the
   diagnostic artifact to the new repository. It cannot deploy the live app.

No workflow has been dispatched by this implementation. No separate test repository
has been created. The source repository's normal CI builds/tests the diagnostic but
continues to deploy only web/dist through its existing manual production workflow.
The test workflow refuses to run in the source repository before checkout or Pages access.

## Google Cloud setup, owner action in the browser

Use only **Training HQ Drive Test**, External / Testing, and consenting authorized
test users. Enable/check **Google Drive API** and **Google Picker API** in that test
project. Do not change production Firebase or Cloud settings.

Open APIs & Services > Credentials > the **replacement OAuth Web Client**. Add this
Authorized JavaScript origin, with your actual test owner:

```text
https://TEST_OWNER.github.io
```

**No `/training-hq-drive-test/` path belongs in an OAuth origin.** Keep the existing
`http://localhost:5173` origin if you still need localhost. GIS uses a popup token
callback in memory, not a redirect-page/code exchange; no new redirect URI, client
secret or backend is needed. Do not use the old exposed client ID. Check the consent
screen's two test accounts; this does not constitute public OAuth verification.

Obtain the test project's public browser API key for Picker and its numeric project
number. Restrict the key to the intended Picker API and HTTP referrer
`https://TEST_OWNER.github.io/*` using the console's current supported restrictions.
The browser sends only the origin as referrer, so a repository-path-only restriction
will not work. Use the dedicated owner so the referrer is not shared with the live
app. Do not paste a Client Secret, refresh token, service-account key or access token.

The only requested scope is `https://www.googleapis.com/auth/drive.file`; extra scopes
are rejected. No drive.readonly, metadata, identity or profile scopes are added.
The Drive identity comes from authenticated Drive about.get, not an editable email.
Firebase authentication is not imported or contacted by the diagnostic.

## Open and run the experiment

Open `https://TEST_OWNER.github.io/training-hq-drive-test/` in a new top-level tab
with no query/hash and popup permission. Enter the replacement public Web Client ID,
Picker browser key and project number in **Public test settings**, then Apply. Values
stay in browser memory only and are cleared on explicit disconnect/reload. Missing
configuration disables connection; typing/applying settings contacts no Google API.

Press **Load Google Identity test SDK**, then **Connect Test Google Account**. Choose
the consenting Drive account; it may differ from the production Firebase account.
No production Firebase login is required or inspected. Record the Firebase-account
matrix manually outside the tool without uploading identifiers or results.

Follow the [full synthetic-file matrix](drive-oauth-test-guide.md): select a folder,
probe metadata, establish baseline, list nested files, create new direct and nested
files using another account/external app, and probe their known IDs using the **same
grant before selecting individual files in Picker**. Only then test explicit file
Picker selection. Downloads require an additional explicit action. Results distinguish
OAuth, metadata, listing, actual body download and newly created-file discovery.
Folder access alone proves nothing about children. Missing files and HTTP 403/404
may reflect drive.file filtering; never fix this by public sharing or broader scopes.
429 and transient errors use bounded retry; pagination and downloads are bounded.
Disconnect clears memory; it does not claim to revoke consent. Test actual revocation
separately through the consenting account's Google permissions page.

The build has an exact-origin CSP, no source maps, service worker, result exports,
Firebase or credential substitution. Pages cannot set arbitrary response headers:
CSP uses a meta policy and frame refusal is enforced at bootstrap (not a fictional
frame-ancestors HTTP header). Use only the dedicated trusted origin. No raw file,
route, result, token or private metadata is persisted or uploaded by this tool.

## Private Codespaces alternative, no local clone

If separate free Pages hosting or Google's shared-domain requirements block the
above, open the reviewed source branch in GitHub, **Code > Codespaces > Create
codespace** (or New with options). Use an included free allowance and stop if billing
would be required. This creates a remote workspace, not a local clone. In the browser
terminal run:

```sh
nvm install 24
nvm use 24
cd web
npm ci
npm run dev:drive-codespace
```

In Ports keep **5173 Private**. Use **Open in Browser** in a new top-level tab, not
an embedded preview. The server only accepts its computed exact Codespaces host:
`https://CODESPACE_NAME-5173.app.github.dev`. Add that exact origin (no path) to the
replacement test Web Client and its origin referrer to the test Picker key. Enter
public settings on the page as above. Do not make the port public or tunnel the
localhost-only entry point. The server binds loopback, validates proxy headers and uses the exact HTTPS/WSS
forwarded origin. See [proxy troubleshooting and regression coverage](drive-codespace-proxy-fix.md)
for a blank page, module 403 or private-port sign-in redirect. The application cannot prove port privacy; the owner
must verify it in Ports. A Codespaces instance/proxy/real OAuth session was not
launched or tested here. If Google also rejects this origin, stop: an owner-approved
verifiable isolated domain is required; no unsafe authorization workaround is offered.

## Finish the temporary experiment

Owner-only cleanup: unpublish/remove the temporary Pages repository if desired,
remove its test OAuth origin/key referrer, revoke the test Google grant if desired,
and stop/delete the test Codespace. Do not delete Drive source files, alter sharing
or touch the live Training HQ deployment. Public multi-user verification and future
folder discovery remain release gates regardless of a successful test-user login.
