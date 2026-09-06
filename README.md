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
- **Backend**: not yet built. POC Router needs new JSON API endpoints added —
  see the contract below. Once `src/Code.gs` / `src/Kylas.gs` / `src/index.html`
  are available, the endpoint additions can be written to match its existing
  `PLAYERS` config, `kylasFetch_`, and owner-safety conventions.

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

### `GET ?action=companyOverlay&companyId=<kylasCompanyId>`
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

### `GET ?action=meetingTypes`
Returns the meeting types a BD can book (maps to `PLAYERS` / pipeline config
in POC Router).

```json
{ "ok": true, "meetingTypes": [{ "id": "discovery", "name": "Discovery Call", "durationMinutes": 30 }] }
```

### `GET ?action=availability&meetingTypeId=<id>&contactId=<kylasContactId>`
Runs POC Router's existing calendar-availability + allocation logic and
returns candidate slots.

```json
{
  "ok": true,
  "slots": [
    { "startIso": "2026-09-08T09:00:00.000Z", "endIso": "2026-09-08T09:30:00.000Z", "hostUserId": "2", "hostName": "Kiran N" }
  ]
}
```

### `POST` `{ "action": "bookMeeting", "contactId": "...", "meetingTypeId": "...", "slot": {...}, "notes": "..." }`
Does everything the platform requirement asks for in one call:
1. Blocks the slot on the host's calendar (existing POC Router logic).
2. Creates the Kylas deal (`ownedBy` = the assigned host, company/contact
   resolved from the Kylas contact record — deal name, company, contact,
   deal size as already defined in `Kylas.gs`).
3. Updates the contact's status to **Discovery Call**.
4. If `notes` is non-empty, attaches it as a Kylas Note on the new deal
   (`POST /v1/notes/relation`, `targetEntityType: "DEAL"`).

```json
{ "ok": true, "meetingId": "...", "dealId": "..." }
```

### `POST` `{ "action": "addNotes", "dealId": "...", "contactId": "...", "notes": "..." }`
Standalone note capture (used after a call, independent of booking) —
same `notes/relation` call, `targetEntityId` = `dealId` if present, else
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
