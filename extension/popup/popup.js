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

// One click that answers "is the backend actually reachable, as me, right
// now" — rather than opening Kylas, waiting for a panel, and reading a
// message. ?action=ping touches nothing: it reads no data and writes none.
document.getElementById("test").addEventListener("click", async () => {
  const backendUrl = (document.getElementById("backendUrl").value || "").trim();
  if (!backendUrl) return setStatus("Paste the POC Router /exec URL first.", "err");

  setStatus("Testing…");
  let url;
  try {
    url = new URL(backendUrl);
  } catch (e) {
    return setStatus("That doesn't look like a URL.", "err");
  }
  // set(), so a ?token= already on the URL survives.
  url.searchParams.set("action", "ping");

  let res, text;
  try {
    res = await fetch(url.toString(), { credentials: "include" });
    text = await res.text();
  } catch (err) {
    return setStatus(
      "Couldn't reach it at all. Check the URL, and that the extension has been reloaded since the last update.",
      "err"
    );
  }

  try {
    const body = JSON.parse(text);
    if (body.pong) return setStatus("Backend answered. You're connected.", "ok");
    if (/token/i.test(body.error || "")) {
      return setStatus(
        "Backend is up but rejected the token — append ?token=… to the URL above.",
        "err"
      );
    }
    return setStatus("Backend answered with: " + (body.error || text.slice(0, 80)), "err");
  } catch (e) {
    // The failure that has cost the most time: a DOMAIN-restricted web app
    // answers a cross-site request with Google's sign-in page, status 200.
    // Signing in doesn't fix it — the browser won't send Google's session
    // cookie on this kind of request at all.
    const signIn = /accounts\.google\.com|ServiceLogin|<html/i.test(text);
    return setStatus(
      signIn
        ? "Got Google's sign-in page, not data. The deployment is domain-restricted, which can't work from an extension. Redeploy it as \"Anyone\" with an OVERLAY_TOKEN."
        : "Backend replied with something that isn't JSON.",
      "err"
    );
  }
});
