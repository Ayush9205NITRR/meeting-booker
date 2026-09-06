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

- **Extension**: functional, ships with a demo-data fallback so you can load
  it and click through the whole flow before the backend is wired up.
- **Backend**: `src/Code.gs` received — it has `TZ`, `PLAYERS`/`BOOKERS`/
  `REVIEWERS`, `getBoard()`, `findNextSlots()` and `bookMeeting()`, all of
  which the new endpoints below wrap directly (no new allocation logic to
  write). `bookMeeting()` as it stands only touches the calendar — Kylas
  deal creation isn't in this file, so `src/Kylas.gs` and `src/index.html`
  are still needed to see how/where that's wired in before the
  `bookMeeting`/`addNotes` endpoints below can be finished.

## Load the extension (unpacked, for development)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select the `extension/` folder in this repo.
3. Click the extension icon → paste your POC Router `/exec` URL once it
   exposes the endpoints below, and **Save**. Leave it blank to explore with
   demo data.
4. Open any Kylas company or contact detail page
   (`https://app.kylas.io/sales/companies/details/<id>` or
   `.../sales/contacts/details/<id>`) — the overlay panel appears top-right.

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
