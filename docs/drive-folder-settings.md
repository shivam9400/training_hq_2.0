# Folder reference implementation

Settings > Health Sync Integration validates an HTTPS drive.google.com folder URL
and allows an authenticated user to explicitly save its ID. Accounts without
Firebase configuration can test URL syntax locally but cannot save. No Drive call
checks existence/access; both the UI and stored access field always say unverified.

Canonical /drive/folders/ID, /drive/u/N/folders/ID and legacy /folderview?id=ID are
accepted. Only usp/hl query metadata (and id in the legacy form) is allowed and is
not stored. Reject file links, lookalike hosts, credentials, nonstandard ports,
fragments, encoded paths, duplicate/unknown query parameters and resource-key URLs.
Resource-key links are deliberately unsupported; do not change sharing permissions.
A canonical reference is not a credential or grant. ID syntax validation cannot
prove a folder exists, is a folder or belongs to a particular Google account.

The strict document at users/{authenticatedUid}/integrations/health-sync is:

```
{id: "health-sync", version: 1, folderId: "<opaque bounded ID>", access: "unverified"}
```

No Google identity is stored before it can be verified. No token, file list, route,
raw file, URI query or caller UID field is accepted by Zod or Firestore rules.
Only owner get/create/update/delete on this fixed path is allowed; collection list,
other IDs/subcollections, anonymous and cross-user requests are denied. Client
requests capture the Firebase observer UID and check it before and after each call.
UI generations reject stale completions and clear form state on identity/tab changes.

Configuration loads separately from training records: old live rules can reject
this new path without preventing Today/Plan/Activities from loading. Saving remains
disabled until settings load succeeds. Owner publication of reviewed rules is a
manual prerequisite for saving/reading/exporting configuration; this PR publishes
nothing. A network-uncertain write prompts reload rather than claiming success. Navigation
or sign-out cannot undo an already sent write; it can finish only under the
original Firebase owner, never the next account.

Folder settings have a separate private JSON export in this panel; existing training
record exports stay compatible. Account deletion removes the fixed configuration
before other owner data and Firebase Auth. If rules/network prevent that cleanup,
deletion fails closed and Auth remains; publish reviewed rules/reconnect and retry.
The app never removes Drive files, folders or Google OAuth grants. Saving a different
folder explicitly replaces only this Firebase user's reference.

Activities displays a disabled Sync Activities control with the unresolved gate
and existing local Import Activities fallback. Connect Drive is also disabled. See
[decision/evidence](drive-feasibility-decision.md) and [Picker design](drive-picker-fallback.md).
