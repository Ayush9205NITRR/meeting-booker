#!/usr/bin/env bash
#
# Mints a fresh clasp credential for the CLASPRC_JSON repo secret and puts it
# on your clipboard, without ever printing it.
#
#     bash tools/refresh-clasp-credential.sh
#
# Run this when "Deploy Apps Script" fails with invalid_grant / invalid_rapt.
# That is not a rare event: Google Workspace can require reauthentication for
# sensitive scopes on a schedule, and this refresh token dies every time it
# does — so this is a routine chore, not an incident.
#
# The credential never reaches the terminal, a log, or a chat window. It goes
# from the file to your clipboard, and you paste it straight into GitHub.

set -euo pipefail

CLASP_VERSION="3.4.1"     # must match .github/workflows/deploy-apps-script.yml
RC="$HOME/.clasprc.json"
REPO_SECRET_URL="https://github.com/Ayush9205NITRR/meeting-booker/settings/secrets/actions"

say()  { printf '\n%s\n' "$*"; }
fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "Node.js isn't installed. Get it from https://nodejs.org and run this again."
command -v npm  >/dev/null 2>&1 || fail "npm isn't installed (it comes with Node.js)."

# ── 1. the right clasp ────────────────────────────────────────────────
# clasp 2 and clasp 3 write DIFFERENT credential shapes, and the deploy
# only accepts the version 3 one. Logging in with whatever clasp happens to
# be installed is the single most likely way to waste a round trip here.
current="$(clasp --version 2>/dev/null || echo none)"
if [ "$current" != "$CLASP_VERSION" ]; then
  say "Installing clasp $CLASP_VERSION (found: $current)…"
  npm install -g "@google/clasp@$CLASP_VERSION"
else
  say "clasp $CLASP_VERSION already installed."
fi

# ── 2. log in ─────────────────────────────────────────────────────────
say "A browser window will open. Sign in as the account that OWNS the Apps"
say "Script project — the same one the POC Router runs as. Signing in as"
say "anyone else produces a credential that deploys nothing."
say ""
read -r -p "Press Enter to continue… " _ || true

# --no-localhost is the fallback for a machine where the browser can't
# redirect back to localhost (SSH, some corp laptops). Same resulting file.
if ! clasp login; then
  say "That didn't complete. Trying the paste-a-code flow instead…"
  clasp login --no-localhost
fi

[ -f "$RC" ] || fail "$RC still doesn't exist, so the login didn't finish."

# ── 3. check the shape BEFORE it goes anywhere ────────────────────────
# The deploy applies exactly these rules. Failing here costs seconds;
# failing there costs a red build and another trip round this loop.
verdict="$(node -e '
  const fs = require("fs");
  let raw;
  try { raw = fs.readFileSync(process.argv[1], "utf8"); } catch (e) { console.log("MISSING"); process.exit(0); }
  let c;
  try { c = JSON.parse(raw); } catch (e) { console.log("NOTJSON"); process.exit(0); }
  if (c.token && c.token.refresh_token) { console.log("CLASP2"); process.exit(0); }
  if (!(c.tokens && c.tokens.default && c.tokens.default.refresh_token)) { console.log("NOREFRESH"); process.exit(0); }
  console.log("OK");
' "$RC")"

case "$verdict" in
  OK)        say "Credential looks right (clasp 3 format, refresh_token present)." ;;
  CLASP2)    fail "This is a clasp 2 credential. Run: npm install -g @google/clasp@$CLASP_VERSION — then run this script again." ;;
  NOREFRESH) fail "No refresh_token in $RC. Run 'clasp logout', then this script again." ;;
  NOTJSON)   fail "$RC isn't valid JSON. Run 'clasp logout', then this script again." ;;
  *)         fail "Couldn't read $RC ($verdict)." ;;
esac

# ── 4. clipboard, not stdout ──────────────────────────────────────────
copied=""
if   command -v pbcopy  >/dev/null 2>&1; then pbcopy  < "$RC"; copied="clipboard (pbcopy)"
elif command -v clip    >/dev/null 2>&1; then clip    < "$RC"; copied="clipboard (clip)"
elif command -v wl-copy >/dev/null 2>&1; then wl-copy < "$RC"; copied="clipboard (wl-copy)"
elif command -v xclip   >/dev/null 2>&1; then xclip -selection clipboard < "$RC"; copied="clipboard (xclip)"
fi

say "─────────────────────────────────────────────────────────────────"
if [ -n "$copied" ]; then
  say "Copied to your $copied."
  say ""
  say "1. Open $REPO_SECRET_URL"
  say "2. CLASPRC_JSON -> Update secret -> paste -> Update"
else
  say "No clipboard tool found. Open this file and copy ALL of it:"
  say ""
  say "    $RC"
  say ""
  say "Copy the whole thing including the outer { and }, then:"
  say "1. Open $REPO_SECRET_URL"
  say "2. CLASPRC_JSON -> Update secret -> paste -> Update"
fi
say ""
say "3. Re-run the 'Deploy Apps Script' workflow."
say ""
say "This is a live Google credential: it goes in the GitHub secret and"
say "nowhere else. Not into a chat, a ticket, or a commit."
say "─────────────────────────────────────────────────────────────────"
