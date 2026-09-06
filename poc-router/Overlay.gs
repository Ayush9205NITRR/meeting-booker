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
 * Secrets live in Script Properties, never in this file:
 *   AIRTABLE_PAT    (required) Airtable personal access token
 *   OVERLAY_TOKEN   (optional) shared secret; if set, every request
 *                   must carry ?token=<value>. Only needed if the
 *                   deployment is opened up to "Anyone" — see README.
 *
 * Run overlaySelfTest() from the editor to verify config without
 * writing anything anywhere.
 *******************************************************************/

// ============ CONFIG ============

const OVERLAY_AIRTABLE_BASE  = 'app55PsyRKqkf2CAQ';
const OVERLAY_AIRTABLE_TABLE = 'tbl2Jje9EBC4Cqydw';

// The Airtable column holding the Kylas company id. Must match exactly.
const OVERLAY_COMPANY_ID_FIELD = 'Kylas Company Id';

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
    }
  };
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
  const url = 'https://api.airtable.com/v0/' + OVERLAY_AIRTABLE_BASE + '/' + OVERLAY_AIRTABLE_TABLE +
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
