// Direct Airtable reader.
//
// The company overlay is a plain lookup — Kylas company id in, one
// `Company List` row out — so it doesn't need a backend at all. This
// talks to Airtable straight from the service worker, which is why the
// overlay works with nothing deployed anywhere.
//
// The token is entered in the extension popup and lives in
// chrome.storage. It is never in this repo. Use a READ-ONLY personal
// access token scoped to just the company base: anyone who installs the
// extension can read it out of their own browser, so it should not be
// able to write anything or reach any other base.
//
// Booking still goes through POC Router — that one genuinely needs a
// server, because it touches Google Calendar and Kylas.

// Defaults point at the Company List table. The table ID is used rather
// than the name "Company List" because it survives a rename and can't be
// tripped up by the space in the name.
const AIRTABLE_DEFAULTS = {
  airtableBaseId: "app55PsyRKqkf2CAQ",
  airtableTable: "tbl2Jje9EBC4Cqydw",
  airtableIdColumn: "Kylas Company Id",
};

// config/secrets.js is gitignored and optional. When it's present the
// whole team is configured by shipping the folder — nobody types a
// token.
function bundledSettings() {
  return self.KylasOverlaySecrets || {};
}

// Values an admin pushed from the Google Admin console. This is the way
// to roll out to a team: the token stays in the admin console instead of
// inside the extension package, and BDs enter nothing at all.
// Empty object when no policy is set, which is the normal case for a
// developer-mode install.
async function managedSettings() {
  try {
    return (await chrome.storage.managed.get(null)) || {};
  } catch (e) {
    return {};
  }
}

/**
 * Precedence: what the BD typed > what the admin pushed > what's bundled
 * in the folder > the built-in default. The user's own entry wins so a
 * one-off test doesn't require an admin, and everything below it means a
 * BD who has done nothing is still configured.
 */
async function airtableSettings() {
  const [stored, managed] = await Promise.all([
    chrome.storage.sync.get([
      "airtablePat",
      "airtableBaseId",
      "airtableTable",
      "airtableIdColumn",
    ]),
    managedSettings(),
  ]);
  const bundled = bundledSettings();

  const pick = (key, fallback) =>
    String(stored[key] || managed[key] || bundled[key] || fallback || "").trim();

  return {
    pat: pick("airtablePat", ""),
    baseId: pick("airtableBaseId", AIRTABLE_DEFAULTS.airtableBaseId),
    table: pick("airtableTable", AIRTABLE_DEFAULTS.airtableTable),
    idColumn: pick("airtableIdColumn", AIRTABLE_DEFAULTS.airtableIdColumn),
  };
}

// Airtable hands back arrays (multi-select, linked records, attachments)
// and objects (collaborators, buttons). The overlay renders strings, so
// flatten everything rather than letting "[object Object]" reach a BD.
function airtableStringify(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(airtableStringify).filter(String).join(", ");
  if (typeof value === "object") {
    return value.name || value.filename || value.email || value.url || JSON.stringify(value);
  }
  return String(value);
}

function airtableFlatten(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields || {})) {
    out[key] = airtableStringify(value);
  }
  return out;
}

/**
 * `{Column} & ''` coerces the cell to text before comparing, so the match
 * works whether the Kylas id column is a Number or a Text field.
 */
function airtableFormula(idColumn, id) {
  return `TRIM({${idColumn}} & '') = '${String(id).replace(/'/g, "\\'")}'`;
}

/**
 * Looks up one company. Returns a response in the same shape the backend
 * would send, so the content script doesn't care which path was used.
 * Returns null if no token is configured, letting the caller fall through
 * to the backend or to demo data.
 */
async function airtableCompanyLookup(companyId) {
  const { pat, baseId, table, idColumn } = await airtableSettings();
  if (!pat) return null;

  const url =
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}` +
    `?maxRecords=1&filterByFormula=${encodeURIComponent(airtableFormula(idColumn, companyId))}`;

  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
  } catch (err) {
    return { ok: false, error: `Could not reach Airtable: ${err}` };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      error:
        "Airtable rejected the token. Check the PAT in the extension popup, " +
        "and that it has read access to this base.",
    };
  }
  if (res.status === 404) {
    return {
      ok: false,
      error: `Airtable could not find base "${baseId}" or table "${table}". Check both in the popup.`,
    };
  }
  if (!res.ok) {
    return { ok: false, error: `Airtable returned ${res.status}.` };
  }

  const body = await res.json();
  const record = (body.records || [])[0];

  return {
    ok: true,
    source: "airtable",
    company: {
      id: String(companyId),
      recordId: record ? record.id : null,
      fields: record ? airtableFlatten(record.fields) : {},
    },
  };
}
