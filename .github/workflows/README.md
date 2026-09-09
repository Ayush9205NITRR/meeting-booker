# What runs on GitHub

Start with [`../../SETUP.md`](../../SETUP.md) — that's the one-time
checklist. This file explains what each workflow does and why.

| Workflow | Trigger | Does |
|---|---|---|
| `ci.yml` | every push and PR | Parses every file, enforces the Kylas owner-safety rules, validates `config/overlay-config.json`. |
| `import-apps-script.yml` | manual | Pulls the live Apps Script project into `apps-script/` and commits it. Run once, so git becomes the source of truth. |
| `deploy-apps-script.yml` | push to `apps-script/**` | Ships that code to the live web app, keeping the same `/exec` URL. |
| `release-extension.yml` | push to `extension/**` | Builds the zip, and — if signing is set up — a signed CRX that Chrome auto-updates from. |
| `claude.yml` | `@claude` in an issue or PR comment | Claude makes the change and opens a PR. |

---

## The one thing that can't move to GitHub

**GitHub Actions cannot serve requests.** A workflow triggers, runs, and
exits. It can't answer the extension when a BD clicks *Book meeting*. So
the live paths — calendar availability, booking a slot, reading pipelines,
writing to Kylas — still run on the Apps Script web app.

What moves to GitHub is where the *code* lives and how it gets there.
After the import, nobody edits in the Apps Script editor; the editor just
runs whatever the last commit put in it.

---

## `deploy-apps-script.yml` — the guard, and why it's there

`clasp push --force` makes the Apps Script project match the folder
**exactly**: a file in the project that isn't in the folder is **deleted**.
That's what makes the repo authoritative — and it's also the one way this
setup could destroy something. Before the import runs, `apps-script/` has
no `Code.gs` and no `index.html`, so a deploy in that state would delete
the booking engine and the whole POC Router page.

So the workflow refuses to push unless both are present, and says why. Run
the import first and the condition takes care of itself.

The deploy updates the **existing** deployment by id rather than creating a
new one, so the `/exec` URL in every BD's extension popup keeps working.

---

## `release-extension.yml` — how auto-update works

Chrome will auto-update an extension it didn't get from the Web Store, as
long as three things line up:

1. A **CRX signed with a stable key.** The key determines the extension ID,
   so it must never change. `CRX_PRIVATE_KEY` holds it; `tools/crx-id.js`
   derives the ID from it.
2. An **`updates.xml`** naming the current version and where the CRX lives.
   Published to GitHub Pages alongside the CRX.
3. The extension **force-installed by policy** from the Admin console,
   pointing at that `updates.xml`.

The version is set to `<major>.<minor>.<run number>` at build time, so it
always increases and Chrome always sees an update — nobody has to remember
to bump `manifest.json`.

The build also writes a `key` field into the packed manifest, so a copy
installed by hand from the zip gets the *same* extension ID as the CRX.
Without it Chrome invents a random ID per unpacked folder, and the ID in
the Admin console wouldn't match.

**Without `CRX_PRIVATE_KEY` the workflow still runs** and still produces the
zip — you just don't get auto-update. That's the fallback, and it's how the
first install happens either way.

---

## `claude.yml`

Mention `@claude` in an issue or a PR comment and it makes the change on a
branch and opens a PR. It's allowed to run the repo's own checks
(`npm run check`, `npm run check:config`) so it can catch and fix what it
broke before you look at the diff.

Needs an `ANTHROPIC_API_KEY` secret. Without it the workflow fails on the
run rather than silently doing nothing — which is the right way round, since
you'd otherwise be waiting on a reply that never comes.

---

## Secrets, all together

| Secret | Needed for | Where it comes from |
|---|---|---|
| `CLASPRC_JSON` | import + deploy | `clasp login`, then `cat ~/.clasprc.json` |
| `APPS_SCRIPT_ID` | import + deploy | Apps Script → Project Settings → Script ID |
| `APPS_SCRIPT_DEPLOYMENT_ID` | deploy | Apps Script → Manage deployments |
| `ANTHROPIC_API_KEY` | `@claude` | console.anthropic.com |
| `CRX_PRIVATE_KEY` | auto-update | `openssl genrsa -out key.pem 2048` |

Import and deploy **skip themselves with a warning** when their secrets are
missing, so an unconfigured repo doesn't turn every commit red. Release
falls back to the zip. Only `claude.yml` fails loudly, on purpose.

None of these can be read by the extension at runtime — GitHub Secrets exist
only inside a workflow run. The Airtable token a BD's browser uses comes
from Chrome policy or the popup, never from here.
