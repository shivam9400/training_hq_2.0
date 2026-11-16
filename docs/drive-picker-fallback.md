# Per-file Picker fallback contract (design, no live implementation)

The feasibility gate in drive-feasibility-decision.md is not complete. There is no
GIS script, OAuth client, token request, Drive request, folder traversal or Picker
button that can authorize access in this release. Disabled controls explain the
boundary. No environment switch can silently enable broad scope access. drive.file itself
includes edit/delete consent for selected files; a future read adapter must restrict
its operations to reads and explain that scope granularity during review.

## Proposed approved flow

1. A signed-in Firebase owner chooses Connect Drive in Settings. A separate GIS
   user-gesture consent requests only reviewed scopes (candidate drive.file plus
   reviewed identity scopes needed to display the actual consented subject).
2. Derive the Drive identity from Google's documented authenticated response, not a
   typed email, Firebase token or folder URL. Google account may differ from Firebase.
   Bind each in-memory authorization to the Firebase UID and the selected subject.
3. Keep short-lived access token/expiry/granted scopes only in memory. No refresh
   token, client secret, URL parameter token, localStorage, Firestore or log. Verify
   expiry/scopes before each request. Revocation/401 disconnects and prompts explicit
   reauthorization; 403 never triggers automatic broader consent. Clearing local
   memory is not a claim that Google's grant was revoked; actual revoke is a separate
   explicit user action once supported.
4. Activities > Select Drive files opens a multi-file Picker using that same grant.
   Folder reference is only a navigation hint; each selected file needs a supported
   per-file grant. Display Drive account and Firebase destination before fetching.
5. Validate selected IDs, MIME/type, size and capabilities with files.get metadata.
   Fetch only explicitly selected binary files using Bearer headers over HTTPS,
   no shared public links. Folder choice never means all descendants. Handle each
   returned page/token if the approved Picker/API flow provides pagination.
6. Download to bounded memory and pass InputFile bytes to the existing disposable
   activities worker. Apply the same aggregate/expanded limits, timeout, timezone
   review, parsers, GPS validation, activityPreview and confirmed private writes.
   Do not build a parallel importer or change source-identification rules to filenames.
7. Stable workout aliases handle repeat selections/companion formats. A manifest,
   if later needed, requires a separately reviewed owner-only schema. Do not save
   raw bodies, URLs, routes or tokens in the folder reference or a fake cursor.

## Errors and lifecycle

Abort downloads and terminate parser workers on Firebase change, Drive switch,
logout/disconnect or navigation. Guard every completion against the UID + Drive
subject + operation generation that started it. In-flight confirmed summary writes
may commit only to their original authenticated owner; future chunks stop.

401/expired token: discard token and require a user gesture to reconnect. 403/revoked
or download restriction: show denial; no scope escalation. 404: unavailable/no access,
not proof of deletion. 429/5xx: bounded exponential backoff with jitter, Retry-After
and cancellation; cap attempts and elapsed time. Do not retry permission errors.
Errors must not include request headers, tokens, source bodies or private names in
logging. Show partial selection errors before summary confirmation. Never delete
or modify Drive exports; use GET/list only in an approved future read adapter.

If folder-wide readonly is eventually approved, implement a separate bounded BFS
with visited IDs, maximum depth/files/bytes/pages, trashed=false, page tokens and
shortcut/shared-drive policy. Follow no shortcuts outside the chosen root, reject
cycles and resource-key/public-link workarounds, and fail visibly on an incomplete
listing. Persist no 'complete sync' cursor until every selected change is processed.
This algorithm and its mock transport tests remain future work behind the gate.

No automatic synchronization while the browser is closed. Firebase Spark can store
summaries and non-secret settings; it cannot waive Google's OAuth review or fund a
required external assessment. No backend, billing or new paid service is introduced.
