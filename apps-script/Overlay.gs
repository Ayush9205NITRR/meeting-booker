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

// Where the company's deal value lives. Run overlaySelfTest() to see the
// company record's fields and set this to the right one.
const OVERLAY_COMPANY_VALUE_FIELD = 'cfDealValue';

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
      case 'dealPipelines':
        return overlayJson_({ ok: true, pipelines: overlayDealPipelines_() });
      case 'contact':
        return overlayJson_(overlayContact_(params.contactId));
      case 'companyContacts':
        return overlayJson_(overlayCompanyContacts_(params.companyId));
      case 'myContacts':
        return overlayJson_(overlayMyContacts_(params.ownerEmail));
      case 'ping':
        return overlayJson_({ ok: true, pong: true });
      default:
        return overlayJson_({ ok: false, error: 'unknown action: ' + params.action });
    }
  } catch (err) {
    return overlayJson_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/**
 * Called from Code.gs doPost. The extension's two write actions arrive as
 * POSTs with a JSON body; everything it only reads goes through
 * overlayApi_ above.
 *
 * The body is sent as text/plain on purpose — application/json would
 * trigger a CORS preflight that Apps Script cannot answer — so it is
 * parsed here rather than read from e.parameter.
 */
function overlayApiPost_(e) {
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return overlayJson_({ ok: false, error: 'Could not read the request body.' });
  }

  try {
    overlayCheckToken_((e && e.parameter) || {});

    switch (body.action) {
      case 'bookMeeting':
        return overlayJson_(overlayBookMeeting_(body));
      case 'addNotes':
        return overlayJson_(overlayAddNotes_(body));
      default:
        return overlayJson_({ ok: false, error: 'unknown action: ' + body.action });
    }
  } catch (err) {
    return overlayJson_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/**
 * Books the slot, then writes to Kylas.
 *
 * The order matters and is not interchangeable. The calendar write is the
 * one that can't be retried cheaply — it holds a real slot in real
 * people's diaries — so it goes first and its result is what the BD is
 * told. The CRM writes come after and are reported alongside: a deal that
 * failed to create is a row to fix, while a meeting that failed to book
 * is a meeting that didn't happen.
 */
function overlayBookMeeting_(p) {
  const booked = bookMeeting(p);
  if (!booked || booked.ok === false) return booked;

  // Never let a CRM failure turn a booked meeting into an error. The slot
  // is already held by this point; kylasOnBooked_ collects its own errors
  // rather than throwing, and they ride back with the success.
  let crm = { dealId: null, errors: [] };
  try {
    crm = kylasOnBooked_({
      contactId:    p.contactId,
      ownerId:      p.ownerId,
      primaryEmail: p.primaryEmail,
      company:      p.company,
      callType:     p.callType,
      notes:        p.notes,
      deal:         p.deal
    });
  } catch (err) {
    crm.errors = ['CRM: ' + String(err && err.message ? err.message : err)];
  }

  booked.dealId = crm.dealId || null;
  booked.crmErrors = crm.errors || [];
  return booked;
}

/**
 * Notes typed into the overlay after the fact, attached to the contact.
 */
function overlayAddNotes_(p) {
  if (!p.contactId) return { ok: false, error: 'No contact to attach the note to.' };
  if (!p.notes || !String(p.notes).trim()) return { ok: false, error: 'The note is empty.' };

  try {
    kylasAddNote_('CONTACT', p.contactId, p.notes);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

/**
 * One place every secret is read from, in this order:
 *
 *   1. Secrets.gs, written by the deploy workflow from GitHub Secrets. It
 *      is never committed and never pulled back into the repo — the import
 *      workflow drops it, and .gitignore blocks it locally.
 *   2. Script Properties, set by hand in the editor.
 *
 * The order means a repo-managed key wins where one exists, and a project
 * that was set up by hand keeps working untouched.
 *
 * `typeof` on an undeclared name is safe in Apps Script — it yields
 * "undefined" rather than throwing — so this works whether or not the
 * deploy wrote a Secrets.gs.
 */
function overlaySecret_(name) {
  try {
    if (typeof OVERLAY_BUILD_SECRETS !== 'undefined' &&
        OVERLAY_BUILD_SECRETS &&
        OVERLAY_BUILD_SECRETS[name]) {
      return OVERLAY_BUILD_SECRETS[name];
    }
  } catch (err) {
    // Fall through to Script Properties.
  }
  return PropertiesService.getScriptProperties().getProperty(name);
}

function overlayJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function overlayCheckToken_(params) {
  const expected = overlaySecret_('OVERLAY_TOKEN');
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
  const pat = overlaySecret_('AIRTABLE_PAT');
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

// ============ KYLAS READS ============
//
// Read-only. Deliberately no PUT and no deal creation here: tools/check.js
// fails the build on a PUT outside kylasUpdateContact_, and deal writes
// belong in Kylas.gs beside the pipeline/stage config and the owner-safety
// rules. These two endpoints only feed the overlay's dropdowns.

function overlayKylasKey_() {
  const key = overlaySecret_('KYLAS_API_KEY');
  if (!key) throw new Error('KYLAS_API_KEY is not set in Script Properties.');
  return key;
}

function overlayKylasGet_(path) {
  const res = UrlFetchApp.fetch('https://api.kylas.io' + path, {
    method: 'get',
    headers: { 'api-key': overlayKylasKey_(), Accept: 'application/json' },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code === 401 || code === 403) throw new Error('Kylas rejected the API key (' + code + ').');
  if (code !== 200) throw new Error('Kylas returned ' + code + ' for ' + path + ': ' + body.slice(0, 200));
  return JSON.parse(body);
}

/**
 * Deal pipelines with their stages, for the overlay's dropdowns.
 *
 * Kylas has moved this payload's shape around between versions, so read
 * defensively: the list may arrive as `content`, `data` or a bare array,
 * and stages may be `stages` or `pipelineStages`. Anything we can't read
 * comes back as an empty stage list rather than throwing, so one odd
 * pipeline doesn't take out the whole dropdown.
 */
function overlayDealPipelines_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('overlayPipelines');
  if (cached) return JSON.parse(cached);

  const raw = overlayKylasGet_('/v1/pipelines/search?page=0&size=100&sort=updatedAt,desc');
  const list = raw.content || raw.data || (Array.isArray(raw) ? raw : []);

  const pipelines = list
    .filter(function (p) {
      const type = String(p.entityType || p.entity || '').toLowerCase();
      // Keep deal pipelines; if a tenant doesn't set entityType, keep it
      // rather than silently offering nothing.
      return !type || type === 'deal';
    })
    .filter(function (p) { return p.active !== false; })
    .map(function (p) {
      const stages = p.stages || p.pipelineStages || [];
      return {
        id: p.id,
        name: p.name || ('Pipeline ' + p.id),
        stages: stages.map(function (s) {
          return { id: s.id, name: s.name || ('Stage ' + s.id) };
        })
      };
    });

  cache.put('overlayPipelines', JSON.stringify(pipelines), 600);
  return pipelines;
}

/**
 * The contact, its owner, and the company it belongs to.
 *
 * This is what lets a deal be created and an invite addressed without the
 * BD retyping anything: the overlay only knows a contact id from the page
 * URL. The owner goes on the calendar invite; the company drives both the
 * invite title and the deal, so the same name is used everywhere.
 */
function overlayContact_(contactId) {
  const id = String(contactId == null ? '' : contactId).trim();
  if (!id) throw new Error('contactId is required.');

  const c = overlayKylasGet_('/v1/contacts/' + encodeURIComponent(id));
  const companyRef = c.company || (c.companies && c.companies[0]) || null;

  let company = null;
  if (companyRef && companyRef.id) {
    company = { id: companyRef.id, name: companyRef.name || '', dealValue: '' };
    // The full record carries the value field; a miss is not fatal, the BD
    // can still type one.
    try {
      const full = overlayKylasGet_('/v1/companies/' + encodeURIComponent(companyRef.id));
      company.name = full.name || company.name;
      company.dealValue = overlayPickValue_(full);
    } catch (e) {
      /* keep the reference-only company */
    }
  }

  return {
    ok: true,
    contact: {
      id: c.id || id,
      name: [c.firstName, c.lastName].filter(String).join(' ').trim() || c.name || '',
      email: overlayPrimaryEmail_(c)
    },
    owner: overlayOwner_(c.ownedBy),
    company: company
  };
}

/** Kylas returns emails as a list of {type,value,primary}. */
function overlayPrimaryEmail_(record) {
  const emails = record.emails || [];
  const primary = emails.filter(function (e) { return e.primary; })[0] || emails[0];
  return (primary && primary.value) || record.email || '';
}

/**
 * The record owner, for the calendar invite. Kylas often omits the email
 * on the embedded ownedBy, so fall back to the user record — the same
 * two-step kylas-airtable-sync does when building its owner-email map.
 */
function overlayOwner_(ownedBy) {
  if (!ownedBy || !ownedBy.id) return null;
  const owner = { id: ownedBy.id, name: ownedBy.name || '', email: ownedBy.email || '' };
  if (!owner.email) {
    try {
      const user = overlayKylasGet_('/v1/users/' + encodeURIComponent(ownedBy.id));
      owner.email = user.email || '';
      owner.name = owner.name || [user.firstName, user.lastName].filter(String).join(' ').trim();
    } catch (e) {
      /* no email available; the overlay shows the name without one */
    }
  }
  return owner;
}

/**
 * Deal value off the company record. Tenants keep this in different
 * places, so try the configured field first, then the usual suspects, and
 * return '' rather than guessing wrong.
 */
function overlayPickValue_(company) {
  const cf = company.customFieldValues || {};
  const candidates = [
    cf[OVERLAY_COMPANY_VALUE_FIELD],
    company[OVERLAY_COMPANY_VALUE_FIELD],
    cf.cfDealValue, cf.cfDealSize, cf.cfRevenue,
    company.annualRevenue, company.revenue
  ];
  for (var i = 0; i < candidates.length; i++) {
    var v = candidates[i];
    if (v === 0) return '0';
    if (v) return typeof v === 'object' ? String(v.value || v.name || '') : String(v);
  }
  return '';
}

/**
 * Every contact at the company, so client-side participants are picked
 * from real records with real email addresses instead of being typed from
 * memory.
 */
function overlayCompanyContacts_(companyId) {
  const id = String(companyId == null ? '' : companyId).trim();
  if (!id) throw new Error('companyId is required.');

  const res = UrlFetchApp.fetch('https://api.kylas.io/v1/search/contact?page=0&size=100&sort=updatedAt,desc', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'api-key': overlayKylasKey_() },
    payload: JSON.stringify({
      fields: ['id', 'firstName', 'lastName', 'emails', 'company', 'department', 'designation'],
      jsonRule: {
        rules: [{ id: 'company.id', field: 'company.id', type: 'string', operator: 'equal', value: id }],
        condition: 'AND', valid: true
      }
    }),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    throw new Error('Kylas contact search returned ' + res.getResponseCode());
  }

  const body = JSON.parse(res.getContentText());
  const list = body.content || body.data || [];

  return {
    ok: true,
    contacts: list.map(function (c) {
      return {
        id: c.id,
        name: [c.firstName, c.lastName].filter(String).join(' ').trim(),
        email: overlayPrimaryEmail_(c),
        designation: c.designation || ''
      };
    }).filter(function (c) { return c.email; })
  };
}

// ============ THE BDR'S OWN CONTACTS ============
//
// Returns the signed-in BD's contacts with the three things the work
// queue needs to bucket them: stage, next call date, last called at.
// The bucketing itself is done in the extension so the definitions live
// in one editable file rather than being split across two codebases.
//
// Identifying the BD matters here: the Kylas API key is a single tenant
// key, so /v1/users/me would return the key's owner, not whoever is
// looking. The deployment runs executeAs USER_ACCESSING, so the Google
// account is the BD's — match that email to a Kylas user.

function overlayMyContacts_(ownerEmail) {
  const email = String(ownerEmail || '').trim() || overlayViewerEmail_();
  if (!email) {
    throw new Error('Could not tell who is signed in. Set your email in the extension popup.');
  }

  const user = overlayFindUserByEmail_(email);
  if (!user) throw new Error('No Kylas user found for ' + email + '.');

  return {
    ok: true,
    owner: { id: user.id, name: user.name, email: email },
    contacts: overlayContactsOwnedBy_(user.id)
  };
}

function overlayViewerEmail_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}

function overlayFindUserByEmail_(email) {
  const target = String(email).trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  const cached = cache.get('overlayUsers');

  let users;
  if (cached) {
    users = JSON.parse(cached);
  } else {
    const raw = overlayKylasGet_('/v1/users?page=0&size=200');
    const list = raw.content || raw.data || (Array.isArray(raw) ? raw : []);
    users = list.map(function (u) {
      return {
        id: u.id,
        email: String(u.email || '').toLowerCase(),
        name: [u.firstName, u.lastName].filter(String).join(' ').trim() || u.name || ''
      };
    });
    cache.put('overlayUsers', JSON.stringify(users), 900);
  }

  return users.filter(function (u) { return u.email === target; })[0] || null;
}

/**
 * Every contact this user owns. Paged, because a BD can own hundreds and
 * a queue that silently stops at the first 100 would quietly under-report
 * exactly the work it exists to surface.
 */
function overlayContactsOwnedBy_(userId) {
  const out = [];
  let page = 0;

  while (page < 20) {                       // 2000 contacts is plenty
    const res = UrlFetchApp.fetch(
      'https://api.kylas.io/v1/search/contact?page=' + page + '&size=100&sort=updatedAt,desc', {
        method: 'post',
        contentType: 'application/json',
        headers: { 'api-key': overlayKylasKey_() },
        payload: JSON.stringify({
          fields: ['id', 'firstName', 'lastName', 'company', 'ownerId',
                   'pipelineStage', 'customFieldValues', 'updatedAt'],
          jsonRule: {
            rules: [{ id: 'ownerId', field: 'ownerId', type: 'string',
                      operator: 'equal', value: String(userId) }],
            condition: 'AND', valid: true
          }
        }),
        muteHttpExceptions: true
      });

    if (res.getResponseCode() !== 200) {
      throw new Error('Kylas contact search returned ' + res.getResponseCode());
    }

    const body = JSON.parse(res.getContentText());
    const list = body.content || body.data || [];
    list.forEach(function (c) { out.push(overlayQueueContact_(c)); });

    if (list.length < 100 || body.last === true) break;
    page++;
  }

  return out;
}

/** Flattens one contact to what the queue needs, tolerating field drift. */
function overlayQueueContact_(c) {
  const cf = c.customFieldValues || {};
  const stage = c.pipelineStage || cf.cfPipelineStageBd || c.stage || '';
  return {
    id: c.id,
    name: [c.firstName, c.lastName].filter(String).join(' ').trim() || c.name || ('#' + c.id),
    company: (c.company && c.company.name) || '',
    stage: typeof stage === 'object' ? (stage.name || '') : String(stage || ''),
    nextCallDate: overlayDateOnly_(cf.cfNextCallDate || c.nextCallDate || ''),
    lastCalledAt: overlayDateOnly_(cf.cfLastCalledAt || c.lastCalledAt || '')
  };
}

/** yyyy-MM-dd in the tenant's timezone, so "today" means the BD's today. */
function overlayDateOnly_(value) {
  if (!value) return '';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyy-MM-dd');
  } catch (e) {
    return '';
  }
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

  // Prints the deal pipelines and stage ids the overlay will offer, so the
  // names can be checked against Kylas without guessing.
  try {
    const pipelines = overlayDealPipelines_();
    Logger.log('Deal pipelines: ' + pipelines.length);
    pipelines.forEach(function (p) {
      Logger.log('  [' + p.id + '] ' + p.name);
      p.stages.forEach(function (s, i) {
        Logger.log('        ' + (i === 0 ? '(first) ' : '        ') + '[' + s.id + '] ' + s.name);
      });
      if (!p.stages.length) Logger.log('        no stages returned — check the payload shape');
    });
  } catch (err) {
    Logger.log('Deal pipelines: FAILED — ' + err.message);
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
