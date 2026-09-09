# What runs on GitHub

Three workflows. Only the first runs on its own.

| Workflow | When | What it does |
|---|---|---|
| `ci.yml` | every push and PR | Parses every file, enforces the Kylas owner-safety rules, and validates `config/overlay-config.json`. |
| `package-extension.yml` | manually, or on a `v*` tag | Builds the installable zip. |
| `deploy-apps-script.yml` | manually, or when `poc-router/**` changes | Pushes the `.gs` files into the Apps Script project. **Skips itself until its secrets are set.** |

---

## What can and can't move to GitHub

Worth being straight about this, because it decides how much of the
extension you can change without a developer.

**GitHub Actions cannot serve requests.** A workflow is a batch job: it
triggers, runs, exits. It can't answer the extension when a BD clicks *Book
meeting*. So the live paths — booking a calendar slot, reading pipelines,
looking up a contact, writing to Kylas — still need the Apps Script web app.
That isn't a limitation of how this was built; nothing hosted on Actions
could do it.

What *does* move to GitHub is everything else, which is most of what
actually changes week to week:

| Change | Where you make it | Reaches BDs |
|---|---|---|
| What the company panel shows | `config/overlay-config.json` | ~10 min, automatically |
| The home-page queue buckets | `config/overlay-config.json` | ~10 min, automatically |
| Apps Script logic (`Overlay.gs`, `Kylas.gs`) | edit + push, workflow deploys | on push |
| Extension code | edit + push, then a new zip | on reinstall |

Only the last one needs anyone to reinstall anything. See
[`config/README.md`](../../config/README.md) for how the first two work.

---

## `deploy-apps-script.yml` — read this before enabling it

`clasp push --force` makes the Apps Script project match the folder it is
given **exactly**: any file in the project that isn't in the folder is
deleted. Pointed straight at the POC Router script id, this repo would
delete `Code.gs` and `index.html` — the booking engine and the entire POC
Router UI.

So the workflow **pulls the live project first**, copies `poc-router/*.gs`
on top, and pushes the merged folder. Files this repo doesn't know about
survive untouched. A second guard refuses to push at all if `Code.gs` and
every `.html` have somehow gone missing from the build folder.

That said, the cleaner arrangement is a **dedicated Apps Script project** for
the overlay backend, separate from POC Router. Two reasons:

- A bad deploy can only break the overlay, never the POC Router page the
  whole team uses.
- The two projects stop sharing a global namespace, so a name collision
  between `Code.gs` and `Kylas.gs` becomes impossible rather than something
  `tools/check.js` has to watch for.

The alternative is to move `Overlay.gs` and `Kylas.gs` into the poc-router
repo, whose `deploy.yml` already ships that project. That works too — the
files just live somewhere else.

### Secrets it needs

| Secret | What |
|---|---|
| `CLASPRC_JSON` | Contents of `~/.clasprc.json` after `clasp login` locally. |
| `APPS_SCRIPT_ID` | Script id of the target project (Project Settings → IDs). |
| `APPS_SCRIPT_DEPLOYMENT_ID` | Only for the "also deploy" option. The **existing** deployment's id, so the `/exec` URL already in every BD's popup keeps working — a fresh `clasp deploy` mints a new URL nobody is pointing at. |

Until `CLASPRC_JSON` and `APPS_SCRIPT_ID` exist the workflow logs a warning
and skips, so it never turns a commit red for being unconfigured.

---

## `package-extension.yml`

Produces `kylas-overlay-<version>.zip` and attaches it to the build. Tagging
`v0.2.0` also attaches it to a GitHub Release, which is the link to hand a
new BD.

The `bundle_secrets` option bakes `AIRTABLE_PAT` and `BACKEND_URL` into the
zip. It is **off by default and never attached to a release**, because a
release asset on a public repo is world-readable and a bundled token can be
read straight out of the extension folder by anyone it's installed for. The
supported ways to get a token to a BD remain:

1. **Chrome policy** (`managed_schema.json`) — the token stays in the Google
   Admin console, BDs enter nothing. This is the right answer for a team.
2. **The popup** — the BD pastes it once.

Whichever route, mint the PAT **read-only and scoped to the one base**. It
sits in a browser; it should not be able to write anything.
