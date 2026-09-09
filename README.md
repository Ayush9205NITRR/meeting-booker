# Kylas Overlay (meeting-booker)

A Chrome extension that overlays curated Airtable account data and one-click
meeting booking directly onto Kylas's Company and Contact pages, so BDs never
have to switch tabs. The heavy lifting (calendar availability, slot booking,
Kylas deal creation, contact status updates) is delegated to the existing
**POC Router** Apps Script backend — this extension is a thin client on top
of it.

```
Kylas Company page  →  extension overlay  →  curated Airtable fields (via POC Router)
Kylas Contact page   →  "Book Meeting"     →  meeting type → slots → confirm
                                                     ↓
                                        POC Router: block calendars,
                                        create Kylas deal, set contact
                                        status to "Discovery Call"
```

## Status

- **Extension**: working. Ships with a demo-data fallback, so you can load
  it and click through the whole flow before the backend is wired up.
- **Backend**: `Overlay.gs` (Airtable lookups, deal setup, the BD queue) and
  `Kylas.gs` (deal creation, contact stage, notes) are in `apps-script/`.
  `Code.gs` and `index.html` still live only in the Apps Script editor —
  the **Import from Apps Script** workflow pulls them in. See
  [`SETUP.md`](SETUP.md).
- **Not done yet**: `KYLAS.pipelines` still holds `0` ids. Run
  `kylasSetup()` in the Apps Script editor and fill them in — a deal will
  refuse to be created until they're set, rather than landing in the wrong
  pipeline.

## How this repo works

Everything lives here — the extension **and** the Apps Script backend — and
each part ships itself.

| To change | Edit | Live in |
|---|---|---|
| What the overlay shows, queue buckets | [`config/overlay-config.json`](config/overlay-config.json) on github.com | ~10 min, automatically |
| Backend logic | `apps-script/` | on push, automatically |
| Extension code | `extension/` | on push, automatically *(once signing is set up)* |

You never open the Apps Script editor and BDs never reinstall anything.

**Start here: [`SETUP.md`](SETUP.md)** — the one-time checklist.
Then [`config/README.md`](config/README.md) for the day-to-day edits, and
[`.github/workflows/README.md`](.github/workflows/README.md) for what each
workflow does.

## Setup

The company overlay and the meeting booking are independent. The overlay
needs **only an Airtable token** — no server, nothing deployed.

### Company overlay (2 minutes)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select the **`extension/`** folder, *not* the repo
   root. Chrome needs the folder that directly contains `manifest.json`;
   pointing it at `meeting-booker/` gives "Manifest file is missing or
   unreadable".
3. Create a **read-only** Airtable personal access token at
   <https://airtable.com/create/tokens> with scope `data.records:read` and
   access to the company base (`app55PsyRKqkf2CAQ`).
4. Click the extension icon, paste the token, **Save**. It verifies the
   token immediately and tells you if it's wrong.
5. Open any Kylas company page
   (`https://app.kylas.io/sales/companies/details/<id>`). The panel docks to
   the right with that company's real `Company List` row.

That's it. Base, table and key column default to the right values; the
**Advanced** section in the popup overrides them if that ever changes.

> **On the token.** It sits in the browser's extension storage, so anyone
> who installs the extension can read it out of their own browser. Keep it
> read-only and scoped to the one base, and it can't do damage. If that
> isn't acceptable, the `poc-router/` backend keeps the token server-side
> instead — same overlay, more setup.

## Rolling out to the team — how BDs get the token

Nobody should be pasting a token into a popup: it means the token gets
passed around Slack, and every new joiner is a support request. Pick one of
these instead.

### 1. Admin policy (recommended for a real rollout)

The token lives in the Google Admin console, not in the extension package.
BDs install and enter nothing.

1. Publish the extension to the Chrome Web Store as **private to your
   organisation**, and force-install it from **admin.google.com → Devices →
   Chrome → Apps & Extensions**.
2. On the same screen, open **Policy for extensions** and paste:
   ```json
   { "airtablePat": { "Value": "patXXXXXXXX" } }
   ```
3. Done. Rotating the token later is one edit in the admin console — no new
   extension version, nothing for BDs to do.

Base, table, key column and the POC Router URL can be pushed the same way
(see `extension/managed_schema.json`).

### 2. Bundled file (fine for testing now)

```bash
cp extension/config/secrets.example.js extension/config/secrets.js
# paste the token
```

`secrets.js` is gitignored. Everyone who gets the folder is configured. The
catch: the token ships inside the package, so anyone who installs it can
unzip and read it — read-only and base-scoped matters here.

### 3. Each BD pastes their own

Works, but don't use it for a team. It's for testing a different base
without touching files.

**Precedence** is: what the BD typed → what the admin pushed → the bundled
file → built-in defaults. So a BD with nothing set still gets the admin's
values, and a BD who sets something keeps it.

### Meeting booking (needs the backend)

Booking touches Google Calendar and Kylas, so it does need a server. Paste
the POC Router `/exec` URL and your email into the popup — see
`poc-router/README.md`. Until then the booking flow runs on demo data; the
company overlay is unaffected.

Because Apps Script web apps deployed with `executeAs: USER_ACCESSING` run as
the signed-in Google account making the request, the BD must already be
signed into their Enout Google Workspace account in that Chrome profile —
the extension's `fetch()` calls include credentials so the browser's existing
Google session is used automatically.

## Backend API Contract (for the POC Router additions)

All requests hit the same Apps Script `/exec` URL. Reads are `GET` with query
params; writes are `POST` with a JSON body sent as `text/plain` (to avoid a
CORS preflight Apps Script can't answer). Every response is JSON:
`{ "ok": true, ... }` or `{ "ok": false, "error": "..." }`.

Two of the four endpoints below are thin wrappers around functions that
already exist in `Code.gs` — no new allocation logic needed for those. The
other two depend on `Kylas.gs`, not yet seen.

### `GET ?action=companyOverlay&companyId=<kylasCompanyId>` — status: pending Kylas.gs
Looks up the Airtable **Company Database / Company List** record where
`Kylas Company Id` matches, and returns its fields flattened.

```json
{
  "ok": true,
  "company": {
    "id": "1776043",
    "fields": {
      "Company Name": "Acme Robotics",
      "Industry": "Manufacturing",
      "Account Stage": "Discovery",
      "Curated Notes": "..."
    }
  }
}
```
`fields` can be anything currently in that Airtable table — the extension
renders whatever keys come back, no schema change needed on the extension
side to add more curated columns later.

### `GET ?action=nextSlots&duration=<mins>&count=<n>` — status: confirmed, wraps `findNextSlots()`
Direct passthrough to `Code.gs`'s existing `findNextSlots(duration, count)` —
same scan window (`SCAN_DAYS`), same work-hours rules. Response reshaped
slightly for the extension (`localStart` kept so a follow-up `getBoard` call
can use it verbatim):

```json
{
  "ok": true,
  "slots": [
    { "localStart": "2026-09-08T09:00", "label": "Tue 8 Sep · 09:00", "free": ["Hritik", "Aarushi"] }
  ]
}
```

### `GET ?action=board&localStart=<...>&duration=<mins>` — status: confirmed, wraps `getBoard()`
Called once the BD picks one of the slots above, to get the suggested POC
and full per-player status before showing the confirm step. Passthrough of
`getBoard(localStart, duration)`'s existing response shape (`players`,
`suggestedPrimary`, `why`, `reviewers`, `slot`, etc. — see `Code.gs` §4).

### `POST` `{ "action": "bookMeeting", "you": "<booker email>", "primaryEmail": "<POC email>", "localStart": "...", "duration": 30, "title": "...", "company": "...", "callType": "...", "reviewers": [...], "externals": [...], "notes": "..." }` — status: partially confirmed
`you`, `primaryEmail`, `localStart`, `duration`, `title`, `company`,
`callType`, `reviewers`, `externals` map 1:1 onto `Code.gs`'s existing
`bookMeeting(payload)` — that part just works. **Still open, pending
Kylas.gs**: where deal creation / contact status update / notes attach
happen. Per the platform requirement these need to happen in this same
call:
1. Block the slot (existing `bookMeeting` — confirmed).
2. Create the Kylas deal, `ownedBy` = the assigned POC (needs company ID +
   contact ID + deal size — the extension only has a Kylas *contact* ID
   from the page URL, so the deal's company/contact linkage has to be
   resolved server-side from the contact record, the way `Kylas.gs` already
   does for other flows).
3. Update the contact's status to **Discovery Call**.
4. If `notes` is non-empty, attach it as a Kylas Note on the new deal
   (`POST /v1/notes/relation`, `targetEntityType: "DEAL"`).

Response (calendar part confirmed, `dealId` pending):
```json
{ "ok": true, "primary": "Hritik", "when": "...", "link": "...", "meet": "...", "dealId": "..." }
```

### `POST` `{ "action": "addNotes", "dealId": "...", "contactId": "...", "notes": "..." }` — status: pending Kylas.gs
Standalone note capture (used after a call, independent of booking) —
`notes/relation` call, `targetEntityId` = `dealId` if present, else
`contactId`.

```json
{ "ok": true }
```

## Repo layout

`extension/` is what Chrome loads — the manifest is in there, not at the
repo root.

Both content scripts match all of `app.kylas.io`, not just the detail
paths, and each shows itself only on its own record type. Kylas routes
client-side, so a script matched to `/details/*` is never injected when a
BD clicks in from a list — it would only appear on a direct load.

```
extension/
  manifest.json
  background/service-worker.js   # only place that calls the backend
  content/shared.js              # panel + messaging helpers
  content/company-overlay.js     # company page overlay
  content/contact-overlay.js     # contact page overlay + booking flow
  popup/                         # backend URL settings
  styles/overlay.css
```

## Why a background-only fetch

Content scripts run inside Kylas's page context — routing all backend calls
through the service worker keeps the POC Router URL and any future API key
out of Kylas's CSP/DOM entirely, and means the URL is configured once (popup)
rather than per content script.
