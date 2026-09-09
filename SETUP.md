# Setup — do this once

After this, **every change is a commit and deploys itself.** You never open
the Apps Script editor and BDs never reinstall anything.

There are three parts. Part 1 is required. Parts 2 and 3 each remove one
manual step, and you can do them later.

---

## Part 1 — Move the Apps Script code into the repo *(required)*

Right now `Code.gs` and `index.html` only exist inside the Apps Script
editor. This pulls them into git, so the repo becomes the source of truth.

### 1a. Get a clasp login token

On your own laptop, once:

```bash
npm install -g @google/clasp
clasp login
cat ~/.clasprc.json
```

Copy the whole output of that last command.

### 1b. Add three secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
|---|---|
| `CLASPRC_JSON` | The `~/.clasprc.json` you just copied |
| `APPS_SCRIPT_ID` | Apps Script → Project Settings → **Script ID** |
| `APPS_SCRIPT_DEPLOYMENT_ID` | Apps Script → Deploy → Manage deployments → the **Deployment ID** of the live web app |

The deployment id matters: it makes deploys update the *existing* web app,
so the `/exec` URL already sitting in every BD's extension popup keeps
working. Without it a deploy would mint a new URL nobody is pointing at.

### 1c. Run the import

Repo → **Actions → Import from Apps Script → Run workflow**.

It pulls every file out of the live project and commits it to
`apps-script/`. When it's done the repo holds `Code.gs`, `index.html`,
`Overlay.gs`, `Kylas.gs`, `appsscript.json` — the lot.

### 1d. Done — from now on

Push anything under `apps-script/` and **Deploy Apps Script** ships it to
the live web app automatically. The Apps Script editor becomes read-only in
practice; if someone does edit there, run the import again to pull it back
into git.

> One safety note worth knowing about: a deploy makes the live project match
> `apps-script/` exactly, so a file missing from the repo would be deleted
> from the project. That is exactly why the import comes first, and the
> deploy workflow refuses to run at all until `Code.gs` and an `.html` are
> present.

### What the import already took care of

`doGet` used to need a hand-edit in the Apps Script editor to route the
overlay's requests. That edit is now a commit like any other, and `doPost`
— which the overlay needs to book anything — is in too. With no `?action=`
parameter `doGet` serves the POC Router page exactly as before, so that
page is unaffected.

---

## Part 1e — The API keys *(optional, but do it)*

`Kylas.gs` and `Overlay.gs` need a Kylas API key and an Airtable token.
Either place works:

| Where | When to use it |
|---|---|
| **GitHub Secrets** — `KYLAS_API_KEY`, `AIRTABLE_PAT` | You already keep them there. The deploy writes them into the Apps Script project each time it runs, so rotating a key is a secret update plus a re-deploy, and nothing is typed into the editor. |
| **Script Properties** — same names, in the Apps Script editor | Set once by hand, and the repo never sees them at all. |

GitHub Secrets win where both exist. Note they do **not** cross repos: a
`KYLAS_API_KEY` in `kylas-airtable-sync` is invisible here, so it has to be
added to this repo too. Same value, second home.

Two things stop the key reaching git. The generated `Secrets.gs` is in
`.gitignore`, and the import workflow deletes it out of whatever it pulls —
so it can't arrive by hand or by import.

---

## Part 2 — Let Claude make changes from the repo *(optional)*

Add one more secret:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | From <https://console.anthropic.com> |

Then, to ask for a change:

1. Repo → **Issues → New issue**
2. Write what you want, mentioning `@claude`:
   > @claude overlay me Last Call ka column bhi dikhao
3. Claude makes the change and opens a pull request
4. You look at it and click **Merge**
5. The deploy workflow ships it

Every change ends up as an issue, a PR and a commit — what changed, why,
and who asked, all in one place.

---

## Part 3 — Make the extension update itself *(optional)*

Without this, a change to the extension's own code means BDs re-download a
zip. With it, Chrome installs new versions by itself within a few hours.

Note that this is only needed for **extension code**. What the overlay
*shows* already updates on its own through
[`config/overlay-config.json`](config/overlay-config.json) — see
[`config/README.md`](config/README.md).

### 3a. Create a signing key

```bash
openssl genrsa -out key.pem 2048
```

**Keep this file safe and never commit it.** It fixes the extension's ID
forever: lose it and every BD has to reinstall; leak it and someone else can
publish an "update" to your extension. `.gitignore` already blocks it.

Add it as a secret named `CRX_PRIVATE_KEY` — paste the whole file including
the `-----BEGIN` and `-----END` lines.

### 3b. Turn on GitHub Pages

Repo → **Settings → Pages → Source: GitHub Actions**.

### 3c. Push once, then read the ID

Any push that touches `extension/` runs **Release extension**. When it's
green, open `https://<you>.github.io/meeting-booker/` — the page shows the
extension ID and the update URL.

### 3d. Roll it out from the Admin console

<admin.google.com> → **Devices → Chrome → Apps & Extensions → Users &
browsers** → your BD org unit → **+ → Add Chrome app or extension by ID**:

- **Extension ID**: from that page
- **Installation URL**: `https://<you>.github.io/meeting-booker/updates.xml`
- **Installation policy**: Force install

While you're there, set the **policy** for the extension so BDs never enter
a token (see `extension/managed_schema.json` for the fields):

```json
{
  "airtablePat":  { "Value": "pat..." },
  "backendUrl":   { "Value": "https://script.google.com/…/exec" }
}
```

Mint that PAT **read-only and scoped to the one base**. It sits in a
browser; it should not be able to write anything.

---

## What you actually do, week to week

| You want to | You do | Reaches BDs |
|---|---|---|
| Change what the overlay shows | Edit `config/overlay-config.json` on github.com | ~10 min, by itself |
| Change queue buckets | Same file | ~10 min, by itself |
| Change backend logic | Open an issue for @claude, merge the PR | On merge, by itself |
| Change extension code | Same | A few hours, by itself *(Part 3)* |

Nothing on that list involves opening the Apps Script editor or asking
anyone to reinstall.
