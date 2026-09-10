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

// ─────────────────────────────────────────────────────────────────────
//  The BD's accounts, straight from `Company List`.
//
//  The queue used to be built from live Kylas contact searches through
//  Apps Script: hundreds of contacts, several round trips, and a rollup
//  computed in the browser on every refresh. Airtable already holds the
//  answer — kylas-airtable-sync writes Account Pipeline Stage per company
//  using exactly the rollup rule we were re-implementing — so reading it
//  is both faster and the same number the rest of the business sees.
//
//  Everything here is a column the sync maintains. Nothing needs a live
//  stage lookup, which is what makes it quick and what stops the queue
//  disagreeing with Airtable.
// ─────────────────────────────────────────────────────────────────────

// Column names, from kylas-airtable-sync's config/field_map.json. A
// rename in Airtable is the one thing that breaks this, so they live in
// one place and can be overridden from config/overlay-config.json.
const ACCOUNT_COLUMNS = {
  id: "Kylas Company Id",
  name: "Company Name - Kylas",
  owner: "Owner - Kylas",
  ownerEmail: "Owner Email",
  stage: "Account Pipeline Stage",
  lastCalled: "Last Called At (Contacts)",
  nextCall: "Next Call Date (Contacts)",
  status: "Status of Reachout",
  accountStatus: "Account Status",
  totalPocs: "Total POCs",
  connectedPocs: "Connected POCs",
  mqlPocs: "MQL POCs",
};

function accountFilterFormula(columns, ownerEmail) {
  const email = String(ownerEmail || "").trim().toLowerCase().replace(/'/g, "\\'");
  // LOWER() both sides: Airtable stores whatever was typed, and a BD's
  // address differing only in case would silently return nothing.
  return `LOWER(TRIM({${columns.ownerEmail}} & '')) = '${email}'`;
}

/**
 * Every account owned by one BD. Returns null when no token is set, so
 * the caller can fall back the same way the company lookup does.
 */
// Columns the queue can do without. `Next Call Date (Contacts)` is written
// by kylas-airtable-sync's account-health rollup, so between the extension
// shipping and that sync running it simply isn't there — and Airtable 422s
// the WHOLE request for one unknown fields[] entry. Asking for it and
// retrying without it means the queue keeps working through that gap
// instead of going dark for everyone at once.
const OPTIONAL_ACCOUNT_COLUMNS = ["nextCall"];

async function airtableMyAccounts(ownerEmail, columnOverrides) {
  const { pat, baseId, table } = await airtableSettings();
  if (!pat) return null;
  if (!ownerEmail) {
    return { ok: false, error: "Set your email in the extension popup to see your accounts." };
  }

  const columns = Object.assign({}, ACCOUNT_COLUMNS, columnOverrides || {});

  let out = await fetchAccountPages(columns, { pat, baseId, table }, ownerEmail);

  if (out.rejected && OPTIONAL_ACCOUNT_COLUMNS.some((k) => columns[k])) {
    const trimmed = Object.assign({}, columns);
    OPTIONAL_ACCOUNT_COLUMNS.forEach((k) => delete trimmed[k]);
    const retry = await fetchAccountPages(trimmed, { pat, baseId, table }, ownerEmail);
    // Only the second answer counts. If dropping the optional columns fixed
    // it, the missing column was the problem; if not, report the original
    // error, which names every column the queue asked for.
    if (!retry.rejected) return retry.result;
  }

  return out.result;
}

// One paged read. Returns { result, rejected } — `rejected` marks the 422
// that airtableMyAccounts retries, so it can tell "unknown column" apart
// from every other failure without parsing the message back out.
async function fetchAccountPages(columns, { pat, baseId, table }, ownerEmail) {
  const wanted = [...new Set(Object.values(columns))];
  const rows = [];
  let offset = "";

  // Airtable pages at 100. A BD with a few hundred accounts is normal, so
  // this follows the offset rather than quietly truncating; the cap stops
  // a misconfigured filter from pulling the whole base.
  for (let page = 0; page < 15; page++) {
    const params = new URLSearchParams({
      pageSize: "100",
      filterByFormula: accountFilterFormula(columns, ownerEmail),
    });
    wanted.forEach((f) => params.append("fields[]", f));
    if (offset) params.set("offset", offset);

    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}?${params}`;

    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
    } catch (err) {
      return { result: { ok: false, error: `Could not reach Airtable: ${err}` } };
    }

    if (res.status === 401 || res.status === 403) {
      return {
        result: {
          ok: false,
          error: "Airtable rejected the token. Check the PAT in the extension popup.",
        },
      };
    }
    if (res.status === 422) {
      // Almost always a renamed column: the formula or a fields[] entry
      // names something that no longer exists.
      return {
        rejected: true,
        result: {
          ok: false,
          error:
            "Airtable rejected the query — usually a renamed column. Expected: " +
            wanted.join(", "),
        },
      };
    }
    if (!res.ok) return { result: { ok: false, error: `Airtable returned ${res.status}.` } };

    const body = await res.json();
    (body.records || []).forEach((r) => {
      const f = airtableFlatten(r.fields);
      rows.push({
        id: f[columns.id] || r.id,
        name: f[columns.name] || "(unnamed account)",
        owner: f[columns.owner] || "",
        stage: f[columns.stage] || "",
        lastCalledAt: f[columns.lastCalled] || "",
        nextCallDate: (columns.nextCall && f[columns.nextCall]) || "",
        status: f[columns.status] || "",
        accountStatus: f[columns.accountStatus] || "",
        totalPocs: f[columns.totalPocs] || "",
        connectedPocs: f[columns.connectedPocs] || "",
        mqlPocs: f[columns.mqlPocs] || "",
      });
    });

    offset = body.offset || "";
    if (!offset) break;
  }

  // Whether the next-call column made it into this read decides whether the
  // "Connect today" bucket can be drawn at all — see usableBuckets().
  return { result: { ok: true, source: "airtable", accounts: rows, hasNextCall: !!columns.nextCall } };
}
