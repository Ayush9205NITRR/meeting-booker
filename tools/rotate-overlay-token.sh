#!/usr/bin/env bash
#
# Rotates OVERLAY_TOKEN and sets the backend URL that the configured
# extension zip is built from.
#
#   ./tools/rotate-overlay-token.sh [deployment-id-or-exec-url]
#
# The new token is generated here, written straight into GitHub secrets,
# and never printed. It exists in this shell and nowhere else, and the
# shell forgets it when the script ends. Nothing to copy, paste, or
# accidentally leave in a chat window.
#
# Rotating the token moves the backend to a value no browser knows, so
# rebuilding the extension against it is PART of the rotation rather than
# a follow-up to it. Stopping halfway leaves every panel showing
# "Couldn't read calendars." with nothing to say why. Hence, in order:
#
#   1. works out the deployment id, whatever shape you paste
#   2. mints a token and sets OVERLAY_TOKEN + OVERLAY_BACKEND_URL
#   3. optionally sets OVERLAY_AIRTABLE_PAT
#   4. redeploys the Apps Script so the new token goes live
#   5. proves the new token works and the old one no longer does
#   6. rebuilds the extension and downloads the configured zip

set -euo pipefail

REPO="Ayush9205NITRR/meeting-booker"

# Taken from the /exec URL you pasted earlier in the session. The deploy
# workflow always updates this same deployment rather than minting a new
# one, so it stays put — but pass a different id as an argument if the
# deployment is ever recreated from scratch.
DEFAULT_DEPLOY_ID="AKfycbyaWOqS_ViTul9dRkNNGn4gsIXp6Xv77HhADg8Ir8BFhBLLpvSbH8vfdtyJ6-0TvNDq3g"

die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32mok\033[0m  %s\n' "$*"; }

# ---------------------------------------------------------------- checks
command -v gh >/dev/null || die "The GitHub CLI (gh) isn't installed.
  brew install gh && gh auth login
Or do it through the web UI instead — the steps are in the chat."

command -v openssl >/dev/null || die "openssl isn't on PATH. It ships with macOS, so this is unusual."

gh auth status >/dev/null 2>&1 || die "gh isn't logged in. Run: gh auth login"

[ $# -le 1 ] || die "Usage: $0 [deployment-id-or-exec-url]

Run it with no arguments to use the deployment this project already has.
Pass an id or a URL only if the deployment was recreated."

# ------------------------------------------------------- deployment id
#
# Google shows the URL three different ways depending on where you copy
# it from, and the /a/macros/<domain>/ one is the form that silently
# fails later: it sends the caller through a Google account check, so the
# extension gets a sign-in page instead of JSON. Pulling the id out and
# rebuilding the URL means it does not matter which one you paste.
RAW="${1:-$DEFAULT_DEPLOY_ID}"
case "$RAW" in
  *script.google.com*)
    DEPLOY_ID=$(printf '%s' "$RAW" | sed -n 's|.*/s/\([A-Za-z0-9_-]\{20,\}\)/.*|\1|p')
    [ -n "$DEPLOY_ID" ] || die "Couldn't find a deployment id in that URL.
Expected something containing  /s/AKfyc.../exec"
    case "$RAW" in
      *"/a/macros/"*) ok "took the id out of the /a/macros/ URL — rebuilding it in the form the extension can actually use" ;;
    esac
    ;;
  *)
    DEPLOY_ID="$RAW"
    ;;
esac

printf '%s' "$DEPLOY_ID" | grep -Eq '^[A-Za-z0-9_-]{20,}$' \
  || die "That doesn't look like a deployment id: $DEPLOY_ID
It should be 20+ characters, usually starting AKfyc."

EXEC_URL="https://script.google.com/macros/s/$DEPLOY_ID/exec"
step "Deployment"
ok "$EXEC_URL"

# --------------------------------------------------------------- token
step "Minting a new token"
TOKEN=$(openssl rand -hex 24)
ok "48 hex characters generated (not shown, and not written to disk)"

step "Setting the repo secrets"
printf '%s' "$TOKEN" | gh secret set OVERLAY_TOKEN --repo "$REPO" >/dev/null
ok "OVERLAY_TOKEN          (what the backend checks)"

printf '%s' "$EXEC_URL?token=$TOKEN" | gh secret set OVERLAY_BACKEND_URL --repo "$REPO" >/dev/null
ok "OVERLAY_BACKEND_URL    (what the extension is built with)"

# Both of these have to be set. Setting only OVERLAY_TOKEN moves the
# backend to a token the extension has no way to know, which reads as
# "Couldn't read calendars." in the panel and gives no hint why.
gh secret list --repo "$REPO" --json name --jq '.[].name' 2>/dev/null | grep -qx OVERLAY_BACKEND_URL \
  || die "OVERLAY_BACKEND_URL did not get set. Stopping here: the backend has
NOT been moved to the new token yet, so everything still works on the old
one. Check 'gh auth status' and run this again."

# ---------------------------------------------------------- airtable
#
# Optional, and separate because it is a different credential with a
# different lifetime. Without it the configured zip still books meetings;
# the company data pane just falls back to demo values.
step "Airtable token (optional — press Enter to skip)"
if gh secret list --repo "$REPO" --json name --jq '.[].name' 2>/dev/null | grep -qx OVERLAY_AIRTABLE_PAT; then
  ok "already set — leaving it alone"
else
  printf '  Paste a READ-ONLY Airtable PAT scoped to the company base,\n'
  printf '  or press Enter to skip: '
  read -r -s PAT
  printf '\n'
  if [ -n "$PAT" ]; then
    printf '%s' "$PAT" | gh secret set OVERLAY_AIRTABLE_PAT --repo "$REPO" >/dev/null
    ok "OVERLAY_AIRTABLE_PAT"
  else
    ok "skipped — company pane will show demo data until you set it"
  fi
  unset PAT
fi

# ------------------------------------------------------------- deploy
#
# Until this runs, the live web app still checks the OLD token: the new
# one only reaches Apps Script through the generated Secrets.gs.
step "Redeploying the Apps Script so the new token goes live"
gh workflow run deploy-apps-script.yml --repo "$REPO" >/dev/null
ok "triggered — waiting for it to finish"

sleep 10
RUN_ID=$(gh run list --repo "$REPO" --workflow deploy-apps-script.yml --event workflow_dispatch \
           --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID" --repo "$REPO" --exit-status >/dev/null 2>&1 || {
  die "The deploy failed. Nothing is live yet and the OLD token still works.
Look at: https://github.com/$REPO/actions/runs/$RUN_ID"
}
ok "deployed"

# ------------------------------------------------------------- verify
#
# -L matters: Apps Script answers with a redirect to
# script.googleusercontent.com, and without it curl returns the redirect
# rather than the data.
step "Checking it actually took"

GOOD=$(curl -sL --max-time 60 "$EXEC_URL?token=$TOKEN&action=dealPipelines" || true)
case "$GOOD" in
  '{"ok":true'*)  ok "new token is accepted" ;;
  '<!DOCTYPE'*|'<html'*)
    die "Got a sign-in page instead of JSON. The deployment's access is not
ANYONE_ANONYMOUS, so the extension will never be able to reach it." ;;
  *) die "New token was rejected. The deploy said it succeeded, so check
whether a stale OVERLAY_TOKEN Script Property is overriding it:
Apps Script -> Project Settings -> Script Properties.

Response was: $(printf '%s' "$GOOD" | head -c 200)" ;;
esac

BAD=$(curl -sL --max-time 60 "$EXEC_URL?token=definitely-not-the-token&action=dealPipelines" || true)
case "$BAD" in
  *'Bad or missing token'*) ok "old/wrong tokens are refused — rotation is real" ;;
  '{"ok":true'*)
    die "A WRONG token was accepted. The endpoint is effectively open.
This happens when OVERLAY_TOKEN is empty everywhere, because the check
returns early when there is nothing to compare against. Do not ship the
zip until this is fixed." ;;
  *) printf '  \033[33m??\033[0m  unexpected answer to a bad token: %s\n' "$(printf '%s' "$BAD" | head -c 120)" ;;
esac

unset TOKEN

# ------------------------------------------------------------- rebuild
#
# The backend is now on a token nobody's browser knows. Until a zip is
# built carrying the matching URL, every extension out there is broken —
# so this is part of the rotation, not a follow-up to it.
step "Rebuilding the extension against the new token"
gh workflow run release-extension.yml --repo "$REPO" >/dev/null
ok "triggered"

sleep 10
REL_ID=$(gh run list --repo "$REPO" --workflow release-extension.yml --event workflow_dispatch \
           --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$REL_ID" --repo "$REPO" --exit-status >/dev/null 2>&1 || {
  die "The release build failed: https://github.com/$REPO/actions/runs/$REL_ID"
}

ART=$(gh run view "$REL_ID" --repo "$REPO" --json databaseId >/dev/null 2>&1; \
      gh api "repos/$REPO/actions/runs/$REL_ID/artifacts" \
        --jq '.artifacts[] | select(.name | startswith("kylas-overlay-configured")) | .name' 2>/dev/null || true)

[ -n "$ART" ] || die "The build succeeded but produced no configured zip, which means
the secrets did not reach it. Check them at:
  https://github.com/$REPO/settings/secrets/actions"

ok "built: $ART"

step "Downloading it"
OUT="$HOME/Downloads/kylas-overlay-configured"
rm -rf "$OUT"
gh run download "$REL_ID" --repo "$REPO" --name "$ART" --dir "$OUT" >/dev/null
ok "$OUT"

cat <<DONE

Done. Backend, secrets and extension are all on the new token.

Install it:

  1. Unzip the file in $OUT
  2. chrome://extensions -> remove the old Kylas Overlay
  3. Load unpacked -> pick the unzipped folder

Then put that same zip in the team Drive folder for everyone else.

Two things this does NOT do:

  - The Admin console policy still has the old backendUrl on it. It only
    affects force-installed copies, so it does not matter during the
    load-unpacked pilot, but it will once the Store listing goes live.

  - Anyone who typed the URL into the extension popup by hand is still on
    the old token, because a popup entry overrides the bundled one. Have
    them clear that field.

DONE
