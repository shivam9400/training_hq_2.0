# Audit and cleanup report

Baseline: latest fetched `main`, commit `250358fed4c50fb1d29a194f48f4c51f18a63870`.
All nine tracked files were read; text was scanned for private-key blocks, Google
API keys, GitHub credentials, OAuth client secrets, email addresses and GPS sample
markup. No actual credentials, identifying account information or personal
workout records were found. Source mentions of OAuth tokens, spreadsheet settings
and GPS parsing are code, not embedded credentials or tracks. This is an audit of
the current tracked tree, not a forensic certification of all Git history.

| Original tracked path | Role / audit / disposition |
| --- | --- |
| `AGENTS.md` | Valid safety guidance, stale Android target; replaced with web/security instructions. No secrets. |
| `README.md` | Project overview, stale native goal; replaced with current setup and deployment guide. No personal records. |
| `android/README.md` | 25-byte placeholder only; removed as unrelated to web architecture. |
| `backend/README.md` | 25-byte placeholder only; removed because this milestone has no custom backend. |
| `docs/architecture.md` | Four-byte placeholder; replaced with actual web architecture. |
| `docs/requirements.md` | Valuable legacy constraints, obsolete native milestone; updated, preserving activity/provenance requirements. |
| `download` | Misnamed 291-byte ignore-rule text, not a required executable or export; removed after moving valuable secret/health-export patterns to `.gitignore`. |
| `legacy/apps-script/Code.gs` | Full Apps Script implementation; preserved byte-for-byte. Reviewed settings/data arrays, Sheets schema, sync, readiness, imports and GPS corrections. Config/data defaults are generic; no embedded account secrets or personal rows found. |
| `legacy/apps-script/Index.html` | Mobile reference UI and RPC client; preserved byte-for-byte. Reviewed navigation, forms, status/actions, charts and rendering. No personal records/credentials found. |

No Android build workflow or Android application code exists in this `main`
baseline. Those exist only on the separate historical `feat/android-foundation`
branch, which was not deleted or rewritten. Generated untracked `android/.gradle`,
`android/.kotlin` and `android/app/build` outputs left by previous workspace builds
were inspected as generated-only and removed locally. No app source was deleted
from main beyond its placeholder README.

Valuable schema, import hazards and migration knowledge from commit `241394a`
are preserved in `docs/legacy-architecture.md`, explicitly marked historical.
Web tests port pace, generic TRAINING, non-GPS validity, identity, distance
provenance and plan matching checks. New tests execute pure functions from the
unchanged Apps Script with synthetic fixtures. The legacy 12/13-column CSV defect
is retained as an expected-failure regression; it is not silently fixed or hidden.

The web app, security rules, emulator tests, static-only service worker and web CI
are new. No Google Sheets, Drive files, OAuth grants, deployed Apps Script,
Firebase project, repository visibility or Pages settings were changed. All
removed paths remain recoverable through Git. No history rewrite/force-push.
