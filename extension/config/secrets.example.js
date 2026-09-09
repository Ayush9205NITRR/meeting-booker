// ─────────────────────────────────────────────────────────────────────
//  Copy this file to `secrets.js` in the same folder and fill in the
//  token. `secrets.js` is gitignored — it never reaches the repo.
//
//      cp extension/config/secrets.example.js extension/config/secrets.js
//
//  Fill it in once, and everyone who gets the extension folder is
//  already configured: no BD ever has to paste a token.
//
//  Use the SAME value as kylas-airtable-sync's AIRTABLE_PAT secret,
//  but mint a READ-ONLY one if you can — this copy lives in every
//  BD's browser, so it should not be able to write anything.
//
//  A token typed into the extension popup overrides whatever is here,
//  which is handy for testing a different base without editing files.
// ─────────────────────────────────────────────────────────────────────

self.KylasOverlaySecrets = {
  airtablePat: "",

  // POC Router /exec URL. Only needed for meeting booking — the company
  // overlay works on the PAT alone.
  backendUrl: "",

  // Where the overlay reads its layout and queue buckets from. Leave
  // blank to use config/overlay-config.json on main, which is what you
  // want unless you are testing a change on a branch first.
  configUrl: "",
};
