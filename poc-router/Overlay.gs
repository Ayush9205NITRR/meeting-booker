/*******************************************************************
 * OVERLAY API — paste this file into the POC Router Apps Script
 * project as a new file called `Overlay.gs`.
 *
 * Serves the Chrome extension (meeting-booker). Self-contained:
 * nothing in Code.gs or Kylas.gs is referenced, so this can go in
 * before the booking endpoints are wired up.
 *
 * The only change needed elsewhere is two lines in Code.gs doGet —
 * see README.md in this folder.
 *
 * This is NOT a new Airtable integration. It reads the same base,
 * the same table and the same column that kylas-airtable-sync
 * already writes twice a day, using the same token — the values
 * below are the ones already in that repo's GitHub Secrets.
 *
 * Secrets live in Script Properties, never in this file:
 *   AIRTABLE_PAT    (required) the SAME token as the sync's
 *                   AIRTABLE_PAT secret. Read-only is enough here.
 *   OVERLAY_TOKEN   (optional) shared secret; if set, every request
 *                   must carry ?token=<value>. Only needed if the
 *                   deployment is opened up to "Anyone" — see README.
 *
 * Run overlaySelfTest() from the editor to verify config without
 * writing anything anywhere.
 *******************************************************************/

// ============ CONFIG ============

// = kylas-airtable-sync's AIRTABLE_COMPANY_BASE_ID.
const OVERLAY_AIRTABLE_BASE = 'app55PsyRKqkf2CAQ';

// Table by name, mirroring the sync's AirtableClient("Company List").
// The table id tbl2Jje9EBC4Cqydw works here too, and survives a rename.
const OVERLAY_AIRTABLE_TABLE = 'Company List';

// The Airtable column holding the Kylas company id. Must match exactly.
// = field_map.json -> company -> id. Note the CRM base's `Companies`
// table spells it "Kylas Company ID" instead — different table, don't
// mix them up.
const OVERLAY_COMPANY_ID_FIELD = 'Kylas Company Id';

// The table that decides what the overlay shows. Edited by the BD
// team, not by developers — add a row, every BD sees the new field
// within OVERLAY_CONFIG_TTL seconds. No redeploy, no extension update.
// If this table is missing, the extension falls back to the defaults
// baked into its own config/field-map.js.
const OVERLAY_CONFIG_TABLE = 'Overlay Config';

// How long a layout is cached before Airtable is re-read. Keep it
// short enough that an edit feels immediate, long enough that the
// config table isn't hit on every single page view.
const OVERLAY_CONFIG_TTL = 60;

// A company id known to exist, used only by overlaySelfTest().
const OVERLAY_SELFTEST_COMPANY_ID = '1778327';

// ============ ROUTER ============

/**
 * Called from Code.gs doGet when ?action= is present.
 * Always answers with JSON, never throws to the caller.
 */
function overlayApi_(e) {
  const params = (e && e.parameter) || {};
  try {
    overlayCheckToken_(params);

    switch (params.action) {
      case 'companyOverlay':
        return overlayJson_(overlayCompany_(params.companyId));
      case 'ping':
        return overlayJson_({ ok: true, pong: true });
      default:
        return overlayJson_({ ok: false, error: 'unknown action: ' + params.action });
    }
  } catch (err) {
    return overlayJson_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function overlayJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function overlayCheckToken_(params) {
  const expected = PropertiesService.getScriptProperties().getProperty('OVERLAY_TOKEN');
  if (!expected) return;                       // token not in use
  if (params.token !== expected) throw new Error('Bad or missing token.');
}

// ============ COMPANY LOOKUP ============

/**
 * Kylas company id -> the curated Airtable row, flattened.
 * A miss is not an error: it returns ok with an empty field set so
 * the overlay can say "nothing curated yet" rather than showing red.
 */
function overlayCompany_(companyId) {
  const id = String(companyId == null ? '' : companyId).trim();
  if (!id) throw new Error('companyId is required.');

  const record = overlayAirtableFind_(id);
  return {
    ok: true,
    company: {
      id: id,
      recordId: record ? record.id : null,
      fields: record ? record.fields : {}
    },
    // null when the Overlay Config table is absent — the extension
    // then renders using its own built-in defaults.
    layout: overlayLayout_()
  };
}

// ============ LAYOUT — read from the Overlay Config table ============

/**
 * Turns the Overlay Config table into the shape the extension renders.
 * Cached briefly so a page view costs one Airtable call, not two.
 *
 * Returns null (not an error) if the table doesn't exist, so a missing
 * config degrades to the extension's defaults instead of a blank panel.
 */
function overlayLayout_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('overlayLayout');
  if (cached) {
    const parsed = JSON.parse(cached);
    return parsed.missing ? null : parsed;
  }

  let rows;
  try {
    rows = overlayAirtableAll_(OVERLAY_CONFIG_TABLE);
  } catch (err) {
    // Table not created yet — cache the miss so we don't retry per view.
    cache.put('overlayLayout', JSON.stringify({ missing: true }), OVERLAY_CONFIG_TTL);
    return null;
  }

  const layout = overlayBuildLayout_(rows);
  cache.put('overlayLayout', JSON.stringify(layout), OVERLAY_CONFIG_TTL);
  return layout;
}

function overlayBuildLayout_(rows) {
  const layout = { header: {}, badges: [], stats: [], fields: [], notes: [] };

  // Airtable omits an unchecked checkbox from the response entirely, so
  // "Active unchecked" and "no Active column" arrive looking identical.
  // If any row has it set, the column exists and blanks mean off; if no
  // row does, the column isn't in use and everything is on.
  const usesActive = rows.some(function (r) {
    return r.Active !== undefined && r.Active !== '';
  });

  rows
    .filter(function (r) {
      if (!usesActive) return true;
      return r.Active === true || r.Active === 'true';
    })
    .map(function (r, i) {
      return {
        label:   String(r.Label || '').trim(),
        column:  String(r.Column || '').trim(),
        section: String(r.Section || '').trim().toLowerCase(),
        type:    String(r.Type || 'text').trim().toLowerCase() || 'text',
        order:   r.Order === undefined || r.Order === '' ? 1e9 : Number(r.Order),
        seq:     i
      };
    })
    .filter(function (r) { return r.column && r.section; })
    // Stable sort: Order wins, original row order breaks ties.
    .sort(function (a, b) { return (a.order - b.order) || (a.seq - b.seq); })
    .forEach(function (r) {
      const entry = { label: r.label || r.column, column: r.column, type: r.type };
      switch (r.section) {
        case 'header':
          layout.header.name = r.column;
          break;
        case 'subtitle':
          layout.header.subtitle = r.column;
          layout.header.subtitleType = r.type;
          break;
        case 'badge': layout.badges.push(entry); break;
        case 'stat':  layout.stats.push(entry);  break;
        case 'field': layout.fields.push(entry); break;
        case 'note':  layout.notes.push(entry);  break;
        default: break;   // unknown section, ignore rather than break the panel
      }
    });

  return layout;
}

/** Every row of a table, following Airtable's pagination. */
function overlayAirtableAll_(tableName) {
  const out = [];
  let offset = '';

  do {
    const url = 'https://api.airtable.com/v0/' + OVERLAY_AIRTABLE_BASE + '/' +
                encodeURIComponent(tableName) + '?pageSize=100' +
                (offset ? '&offset=' + encodeURIComponent(offset) : '');

    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + overlayAirtablePat_() },
      muteHttpExceptions: true
    });

    const code = res.getResponseCode();
    if (code !== 200) {
      throw new Error('Airtable returned ' + code + ' for table ' + tableName);
    }

    const parsed = JSON.parse(res.getContentText());
    (parsed.records || []).forEach(function (rec) {
      out.push(overlayFlatten_(rec.fields || {}));
    });
    offset = parsed.offset || '';
  } while (offset);

  return out;
}

function overlayAirtablePat_() {
  const pat = PropertiesService.getScriptProperties().getProperty('AIRTABLE_PAT');
  if (!pat) throw new Error('AIRTABLE_PAT is not set in Script Properties.');
  return pat;
}

/**
 * `{Field} & ''` coerces the cell to text before comparing, so this
 * matches whether the Kylas id column is a Number or a Text field —
 * that detail has bitten every integration that assumed one or the
 * other.
 */
function overlayAirtableFind_(id) {
  const formula = "TRIM({" + OVERLAY_COMPANY_ID_FIELD + "} & '') = '" + id.replace(/'/g, "\\'") + "'";
  // The table is referenced by name ("Company List"), so it has to be
  // encoded — an unescaped space here is a 404 that looks like a
  // missing table.
  const url = 'https://api.airtable.com/v0/' + OVERLAY_AIRTABLE_BASE + '/' +
              encodeURIComponent(OVERLAY_AIRTABLE_TABLE) +
              '?maxRecords=1&filterByFormula=' + encodeURIComponent(formula);

  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + overlayAirtablePat_() },
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();

  if (code === 401 || code === 403) {
    throw new Error('Airtable rejected the token (' + code + '). Check AIRTABLE_PAT and its base access.');
  }
  if (code === 404) {
    throw new Error('Airtable base or table not found. Check OVERLAY_AIRTABLE_BASE / OVERLAY_AIRTABLE_TABLE.');
  }
  if (code !== 200) {
    throw new Error('Airtable returned ' + code + ': ' + body.slice(0, 300));
  }

  const parsed = JSON.parse(body);
  const records = parsed.records || [];
  if (!records.length) return null;

  return { id: records[0].id, fields: overlayFlatten_(records[0].fields || {}) };
}

/**
 * The overlay renders plain strings. Airtable hands back arrays
 * (multi-select, linked records, attachments) and objects
 * (collaborators, buttons), so flatten them to something readable
 * rather than letting "[object Object]" reach a BD's screen.
 */
function overlayFlatten_(fields) {
  const out = {};
  Object.keys(fields).forEach(function (key) {
    out[key] = overlayStringify_(fields[key]);
  });
  return out;
}

function overlayStringify_(value) {
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value.map(overlayStringify_).filter(String).join(', ');
  }
  if (typeof value === 'object') {
    // collaborator {name,email}, attachment {filename,url}, button {url}
    return value.name || value.filename || value.email || value.url || JSON.stringify(value);
  }
  return String(value);
}

// ============ SELF TEST — run from the editor ============

function overlaySelfTest() {
  Logger.log('Base:  ' + OVERLAY_AIRTABLE_BASE);
  Logger.log('Table: ' + OVERLAY_AIRTABLE_TABLE);
  Logger.log('Id column: ' + OVERLAY_COMPANY_ID_FIELD);

  const props = PropertiesService.getScriptProperties();
  Logger.log('AIRTABLE_PAT set:  ' + (props.getProperty('AIRTABLE_PAT') ? 'yes' : 'NO — set it first'));
  Logger.log('OVERLAY_TOKEN set: ' + (props.getProperty('OVERLAY_TOKEN') ? 'yes' : 'no (deployment must be DOMAIN-restricted)'));
  Logger.log('');

  // The Overlay Config table is optional, so report on it separately —
  // its absence is a fallback, not a failure.
  try {
    const layout = overlayLayout_();
    if (!layout) {
      Logger.log('Overlay Config table: not found — the extension will use its built-in defaults.');
    } else {
      Logger.log('Overlay Config table: ' +
        (layout.header.name ? '1 header, ' : 'NO header row, ') +
        layout.badges.length + ' badge, ' +
        layout.stats.length + ' stat, ' +
        layout.fields.length + ' field, ' +
        layout.notes.length + ' note row(s)');
    }
  } catch (err) {
    Logger.log('Overlay Config table: FAILED — ' + err.message);
  }
  Logger.log('');

  try {
    const result = overlayCompany_(OVERLAY_SELFTEST_COMPANY_ID);
    const names = Object.keys(result.company.fields);
    if (!names.length) {
      Logger.log('Connected fine, but no row matched company id ' + OVERLAY_SELFTEST_COMPANY_ID + '.');
      Logger.log('Either that company is not in the table, or ' + OVERLAY_COMPANY_ID_FIELD + ' is spelled differently.');
      return;
    }
    Logger.log('Matched Airtable record ' + result.company.recordId);
    Logger.log(names.length + ' columns available to map in field-map.js:');
    names.forEach(function (n) {
      Logger.log('  ' + n + '  =  ' + String(result.company.fields[n]).slice(0, 60));
    });
  } catch (err) {
    Logger.log('FAILED: ' + err.message);
  }
}
