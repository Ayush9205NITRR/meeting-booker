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
