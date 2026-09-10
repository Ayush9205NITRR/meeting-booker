// Pulls config/overlay-config.json out of the GitHub repo so the overlay's
// layout and the home-page queue can be changed by editing a file on
// github.com — no extension rebuild, no reinstall, no developer.
//
// Precedence for *where* it reads from is the same as every other setting:
// the BD's popup entry, then what an admin pushed by policy, then what's
// bundled, then the built-in default below.
//
// Failure is deliberately quiet. If GitHub is unreachable, the repo is
// private, or someone commits broken JSON, the last good copy is used; if
// there isn't one, the overlays fall back to the files bundled in
// extension/config/. A bad commit degrades the overlay to yesterday's
// layout — it never takes it down.

const REMOTE_CONFIG_DEFAULT_URL =
  "https://raw.githubusercontent.com/Ayush9205NITRR/meeting-booker/main/config/overlay-config.json";

// Long enough that a busy BD isn't re-fetching all day, short enough that
// "I changed it and nobody sees it" is never the story.
const REMOTE_CONFIG_TTL_MS = 10 * 60 * 1000;

async function remoteConfigUrl() {
  const { configUrl } = await chrome.storage.sync.get("configUrl");
  if (configUrl) return configUrl;

  const managed = await managedSettings();
  if (managed.configUrl) return managed.configUrl;

  return bundledSettings().configUrl || REMOTE_CONFIG_DEFAULT_URL;
}

// Returns the parsed config or null. Never throws.
async function loadRemoteConfig() {
  const cached = await chrome.storage.local.get(["remoteConfig", "remoteConfigAt"]);
  const fresh =
    cached.remoteConfig && Date.now() - (cached.remoteConfigAt || 0) < REMOTE_CONFIG_TTL_MS;
  if (fresh) return cached.remoteConfig;

  try {
    const url = await remoteConfigUrl();
    // cache: "no-cache" so a commit made a minute ago isn't served from
    // Chrome's HTTP cache after our own TTL has already expired.
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = await res.json();
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");

    await chrome.storage.local.set({ remoteConfig: parsed, remoteConfigAt: Date.now() });
    return parsed;
  } catch (e) {
    // Stale beats nothing: a network blip shouldn't drop the BD back to
    // the bundled defaults when a perfectly good copy is sitting here.
    return cached.remoteConfig || null;
  }
}

// The overlays already know how to draw a server-supplied `layout` (that's
// how the Apps Script backend feeds them), so the config's human-friendly
// shape gets converted into exactly that rather than teaching the content
// scripts a second format.
function companyLayoutFrom(config) {
  const company = config && config.company;
  if (!company) return null;

  // An entry is "Column", ["First choice", "Fallback"], or { field, type }
  // where field is either of those. The array form has to pass through
  // whole: reading .field off it yields undefined, which drops the row.
  const toList = (obj) =>
    Object.entries(obj || {}).map(([label, entry]) => {
      if (typeof entry === "string" || Array.isArray(entry)) {
        return { label, column: entry, type: "text" };
      }
      return { label, column: entry.field, type: entry.type || "text" };
    });

  const layout = {
    header: company.header || {},
    badges: (company.badges || []).map((column) => ({ label: column, column, type: "text" })),
    stats: toList(company.stats),
    fields: toList(company.fields),
    notes: toList(company.notes),
  };

  const hasContent =
    layout.badges.length ||
    layout.stats.length ||
    layout.fields.length ||
    layout.notes.length ||
    (layout.header && layout.header.name);

  return hasContent ? layout : null;
}

function queueConfigFrom(config) {
  const buckets = config && config.queue && config.queue.buckets;
  return Array.isArray(buckets) && buckets.length ? { buckets } : null;
}

// Whatever copy of the config is already on disk, without going to the
// network. The queue is the one place where waiting on GitHub would be
// felt: it would put a round trip in front of the Airtable call that the
// BD is actually waiting for. Column overrides are rare, so an
// out-of-date copy — or none at all — is the right trade here. The next
// company overlay refreshes it.
async function cachedRemoteConfig() {
  const cached = await chrome.storage.local.get("remoteConfig");
  return cached.remoteConfig || null;
}

// Airtable column names for the account queue, so a rename in Airtable is
// a config edit on GitHub rather than an extension release.
function queueColumnsFrom(config) {
  const cols = config && config.queue && config.queue.accountColumns;
  return cols && typeof cols === "object" ? cols : null;
}
