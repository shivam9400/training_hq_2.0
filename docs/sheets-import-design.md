# Optional private Google Sheets connection — design only

CSV import works without this connection. No production Google Sheets OAuth flow,
client secret, spreadsheet ID/gid, download endpoint or consent shortcut is shipped.
The app never makes the user's sheet public or reads it without authorization.

## Minimum-scope candidates and verification gate

Google Identity Services' browser token model can provide short-lived access tokens
on an explicit gesture. Authentication through Firebase Google Sign-In is separate
from permission to read a spreadsheet. First verify the Sheets values.get method's
**current accepted scopes**, Google's scope classification and consent/publishing
requirements against these official references:

- https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/identity/oauth2/web/guides/use-token-model
- https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification

Direct retrieval of those Google documentation hosts was denied by this task's
cloud network policy. Therefore current OAuth requirements were **not freshly
verified**, and implementing production access would be premature.

Preferred candidate: drive.file with explicit Google Picker authorization of a
specific spreadsheet, if a live test confirms that Sheets values.get accepts this
per-file grant. Do not assume that entering an ID, selecting a folder, or signing
in to Firebase authorizes a private spreadsheet. New files are not implicitly
covered by a folder grant. This candidate normally avoids broad spreadsheet access,
but requires confirmation with the current API/project/verification requirements.

Fallback candidate: spreadsheets.readonly. It is read-only but generally covers
all spreadsheets the user can access, not just the chosen one; limiting the app's
requests to one ID does not narrow the OAuth grant. It may require sensitive-scope
verification, branded consent/owned-domain verification and publishing review.
Do not silently escalate to it. Confirm the least scope and policy obligations
with Google before shipping. No paid server or client secret is inherently needed
for a browser token flow, but scope/verification requirements can still block a
safe release. Keep CSV available if a narrow reviewed grant is not feasible.

## Proposed authorized flow

1. An authenticated user selects Connect Google Sheets, gets clear scope disclosure,
   chooses the Google account, and authorizes the selected spreadsheet. Verify the
   consenting Google identity belongs to the active Firebase account; do not trust
   an editable email string. Tokens live only in memory, never Firestore, URLs,
   source code, localStorage or static assets. Never request/store a refresh token
   or use a client secret in this static PWA.
2. Store source selection only under that user's private path, with a reviewed new
   schema/rule change for future connection metadata. The current importer stores
   hashed CSV source references, not a Sheets connection. Do not add the supplied
   private source identifiers to source code or example configuration.
3. After consent, read only necessary spreadsheet metadata (worksheet title/gid)
   to verify the selected Plan tab, then request its bounded `Plan!A:J` values with
   the Sheets API, never an unauthenticated export URL. Confirm exact ten headers;
   do not accidentally import a different or the legacy 27-column worksheet.
   Request explicit row limits, handle sparse/trailing cells, and use a documented
   formatted-value/date representation that preserves source text and ISO dates.
4. A source-specific Import/Sync Plan action reads only that authorized spreadsheet
   and tab, passes values through the same validated preview/diff/confirmation
   pipeline, and writes only safe rows to the current user's records. No background
   sync while the browser is closed, automatic overwrite or source-sheet mutation.
5. On denial, expiry, wrong-account consent, revocation, missing worksheet or access
   loss, stop and clear the pending connection. Reauthorize explicitly. Switching
   accounts/sign-out clears tokens and previews before any other user's data loads.

Before enabling: test two Google/Firebase accounts, narrowly granted and ungranted
sheets, denied scopes, worksheet changes, expiry/revocation, account switching,
CORS/CSP, authorized domains and current external-app verification. Publish a
privacy/deletion policy and verify hosting-domain eligibility. None of these live
OAuth tests were performed and no private spreadsheet was accessed by this task.
