const MANIFEST = chrome.runtime.getManifest();

const FIELDS = [
  "airtablePat",
  "airtableBaseId",
  "airtableTable",
  "airtableIdColumn",
  "backendUrl",
  "bookerEmail",
];

const el = (id) => document.getElementById(id);
const status = el("status");

chrome.storage.sync.get(FIELDS).then((stored) => {
  FIELDS.forEach((key) => {
    if (stored[key]) el(key).value = stored[key];
  });
  // Open the advanced block if any of it was customised, so a non-default
  // base or table isn't hidden away where nobody looks for it.
  if (stored.airtableBaseId || stored.airtableTable || stored.airtableIdColumn) {
    document.querySelector("details").open = true;
  }
  if (!stored.airtablePat) showProvidedToken();
});

// A token can arrive from an admin policy or from the bundled secrets
// file, in which case the empty box is not "unconfigured" and a BD should
// not go hunting for a token to paste.
async function showProvidedToken() {
  let managed = {};
  try {
    managed = (await chrome.storage.managed.get(null)) || {};
  } catch (e) {
    /* no policy set */
  }
  if (managed.airtablePat) {
    el("airtablePat").placeholder = "Set by your administrator — nothing to do";
    return;
  }
  // The bundled file lives in the service worker's scope, so ask it.
  try {
    const res = await chrome.runtime.sendMessage({
      type: "KYLAS_OVERLAY_REQUEST",
      action: "tokenSource",
    });
    if (res && res.source === "bundled") {
      el("airtablePat").placeholder = "Already configured — nothing to do";
    }
  } catch (e) {
    /* worker asleep; leave the default placeholder */
  }
}

function setStatus(text, cls) {
  status.textContent = text;
  status.className = cls || "";
}

el("save").addEventListener("click", async () => {
  const values = {};
  FIELDS.forEach((key) => {
    values[key] = el(key).value.trim();
  });
  await chrome.storage.sync.set(values);

  if (!values.airtablePat) {
    setStatus("Saved. No Airtable token — the overlay will show demo data.", "");
    return;
  }

  // Verify the token straight away rather than letting the BD discover it
  // is wrong on a company page.
  setStatus("Saved. Checking Airtable…", "");
  const base = values.airtableBaseId || "app55PsyRKqkf2CAQ";
  const table = values.airtableTable || "tbl2Jje9EBC4Cqydw";

  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}?maxRecords=1`,
      { headers: { Authorization: `Bearer ${values.airtablePat}` } }
    );
    if (res.ok) {
      setStatus("Saved — Airtable connected.", "ok");
    } else if (res.status === 401 || res.status === 403) {
      setStatus("Saved, but Airtable rejected the token (check its base access).", "err");
    } else if (res.status === 404) {
      setStatus("Saved, but that base or table was not found.", "err");
    } else {
      setStatus(`Saved, but Airtable returned ${res.status}.`, "err");
    }
  } catch (err) {
    setStatus("Saved, but Airtable could not be reached.", "err");
  }
});

// Shown at the bottom of the popup so "did my reload take?" is answerable
// without digging through chrome://extensions.
document.getElementById("version").textContent =
  "Version " + MANIFEST.version + " · loaded from " + chrome.runtime.id.slice(0, 8);
