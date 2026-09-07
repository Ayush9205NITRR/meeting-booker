# POC Router additions

Files here are **not** part of the Chrome extension. They get pasted into the
POC Router Apps Script project, which acts as the extension's backend so that
no API key ever ships inside the extension.

`Overlay.gs` is self-contained — it doesn't call anything in `Code.gs` or
`Kylas.gs`, so it can go in before the booking endpoints exist.

---

## Setup (about five minutes)

### 1. Add the file

Apps Script editor → **+ → Script** → name it `Overlay` → paste the contents of
`Overlay.gs` → save.

### 2. Add the Airtable token

Project Settings → **Script Properties** → Add:

| Property | Value |
|---|---|
| `AIRTABLE_PAT` | your Airtable personal access token |

The PAT needs `data.records:read` on base `app55PsyRKqkf2CAQ`. It lives here
next to `KYLAS_API_KEY` — never in the repo, never in the extension.

### 3. Patch `doGet` in `Code.gs`

The only change outside this folder. Two lines: the function takes `e`, and
routes to the API when `?action=` is present.

```js
function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  if (action) return overlayApi_(e);

  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('POC Router')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
```

The existing web app is untouched — with no `action` param it still serves
`index.html` exactly as before.

### 4. Verify before deploying

Run `overlaySelfTest()` from the editor (Run → overlaySelfTest → View logs).
It reads only, writes nothing, and prints **every column name in the matched
Airtable row** — which is what you copy into
`extension/config/field-map.js`.

Common results:

| Log says | Meaning |
|---|---|
| `AIRTABLE_PAT set: NO` | step 2 not done |
| `Airtable rejected the token (401/403)` | PAT is wrong, or lacks access to that base |
| `no row matched company id …` | that company isn't in the table, or `Kylas Company Id` is spelled differently — fix `OVERLAY_COMPANY_ID_FIELD` |
| a list of columns | working |

### 5. Deploy and point the extension at it

Deploy the web app as usual (`npm run push`, or merge to `main` and let the
GitHub Action update the existing deployment in place). Then paste the `/exec`
URL into the extension popup and hard-refresh Kylas.

---

## If the extension gets HTML instead of JSON

The deployment is `executeAs: USER_ACCESSING` / `access: DOMAIN`, so Google
requires a signed-in enout.in session. The extension sends
`credentials: "include"`, which normally satisfies that — but if Google answers
the cross-origin call with a sign-in page rather than JSON, the overlay will
show a parse error.

The fallback, if that happens:

1. Redeploy with **Who has access: Anyone**.
2. Add a Script Property `OVERLAY_TOKEN` = any long random string. `Overlay.gs`
   then rejects every request that doesn't carry it.
3. In the extension popup, paste the URL **with the token appended**:
   `https://script.google.com/macros/s/…/exec?token=<your value>`

No extension code change is needed — the popup URL's existing query string is
preserved when the background worker adds its own parameters.

This trades a domain check for an unguessable URL plus a shared secret, on an
endpoint that only ever reads curated company data. Try DOMAIN first.

---

## The `Overlay Config` table — what the overlay shows

Create a table called **`Overlay Config`** in the same base
(`app55PsyRKqkf2CAQ`). This is the control panel: add a row, and every BD's
overlay picks it up within a minute. No extension update, no deploy, no
developer.

Columns (all plain text except where noted):

| Column | Required | What it does |
|---|---|---|
| `Label` | no | What the BD sees. Blank falls back to the column name. |
| `Column` | **yes** | The exact `Company List` column name to read. |
| `Section` | **yes** | Where it appears — see below. |
| `Order` | no | Number. Lower shows first. Blank sorts last, in table order. |
| `Type` | no | `text` (default), `link`, `email`, `phone`. |
| `Active` | no | Checkbox. Untick to hide a row without deleting it. |

`Section` values:

| Section | Appears as |
|---|---|
| `header` | The big company name at the top. Use one row. |
| `subtitle` | The grey line under it. Use one row. |
| `badge` | A coloured pill. Best for one status. |
| `stat` | A number tile. Two or three max. |
| `field` | A labelled row in the main list. |
| `note` | Long text at the bottom, clamped with "Show more". |

A starting point:

| Label | Column | Section | Order |
|---|---|---|---|
| | Company Name | header | 1 |
| | Industry | subtitle | 1 |
| Stage | Highest Calling Stage | badge | 1 |
| Revenue | Company Revenue | stat | 1 |
| Rev / employee | Revenue Per Employee | stat | 2 |
| Last interaction | Last Call | field | 1 |
| Owner | Owner | field | 2 |

### Things worth knowing

- **Keep it short.** One badge, two or three tiles, four to six rows. The
  overlay is a glance, not a report — everything you add competes with what's
  already there.
- **A wrong column name is harmless.** It's skipped silently rather than drawn
  as an empty dash. To see the real names, click **Show all fields** at the
  bottom of the overlay.
- **Changes take up to a minute.** The layout is cached for 60 seconds
  (`OVERLAY_CONFIG_TTL`) so the config table isn't re-read on every page view.
- **If the table doesn't exist**, the overlay falls back to the defaults in
  `extension/config/field-map.js`. Nothing breaks; you just don't get to
  control it from Airtable.
- **`Active` is all-or-nothing.** Airtable doesn't send unchecked checkboxes,
  so if *no* row has `Active` ticked the column is treated as unused and
  everything shows. Once any row is ticked, unticked rows hide.

## Endpoints

| Request | Returns |
|---|---|
| `?action=ping` | `{ ok: true, pong: true }` — quickest way to confirm routing works |
| `?action=companyOverlay&companyId=<kylas id>` | `{ ok: true, company: { id, recordId, fields: {…} } }` |

`fields` is the whole Airtable row, flattened to strings — multi-selects become
comma lists, collaborators become names, attachments become filenames, so
nothing renders as `[object Object]`. A company with no Airtable row is not an
error: it returns `ok` with an empty `fields`, and the overlay says nothing is
curated yet.

Still to come (blocked on `Kylas.gs`): `bookMeeting`, `addNotes`.

---

## Deal creation from a booking

The extension's contact overlay is a port of `src/index.html`, so it sends
`bookMeeting` the same payload that page does — plus one extra field:

```js
{
  you, primaryEmail, localStart, duration,
  title, company, callType,        // callType is "Requirement" or "Discovery"
  reviewers: [...], externals: [...],
  contactId: "5371930"             // NEW — the Kylas contact being booked
}
```

`contactId` is what makes the deal possible without the BD retyping
anything. The company typed into the form is only for the invite title; the
deal needs the real Kylas records.

### Resolving company and deal value from the contact

Every contact belongs to a company, so one lookup gets both:

```
GET /v1/contacts/{contactId}      ->  .company  { id, name }
GET /v1/companies/{companyId}     ->  whatever field holds deal value
```

Then create the deal with `POST /v1/deals`, as `Kylas.gs` already does for
the existing flow — `ownedBy` set to the POC at creation, never patched
afterwards, because a partial `PUT` reassigns record owners.

### The three variables

Per the current spec the deal carries:

| Variable | Source |
|---|---|
| Deal name / type | Starts with **Discovery Call**, varied by `callType` |
| Company | Resolved from the contact, not the typed field |
| Deal value | Pulled from the company record |

`callType` is the classification the BD picked in the overlay:

- `"Requirement"` — Active Requirement. Different POC and structure.
- `"Discovery"` — Discovery Call against an active requirement.

Both come through on the same payload, so one handler can branch on
`callType` rather than needing two endpoints.

### Still needed

`Kylas.gs` itself. The pipeline/stage ids, `kylasFetch_`, the
`kylasUpdateContact_` read-modify-write path and the deal-creation shape all
live there, and the owner-safety rules in `tools/check.js` mean this has to
match those conventions exactly rather than be written fresh.
