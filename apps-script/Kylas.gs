/*******************************************************************
 * KYLAS — deal creation, contact stage, notes.
 *
 * Written against the Kylas public Postman collection. Everything
 * here obeys the three rules tools/check.js enforces, because each
 * one exists for a bug that already shipped:
 *
 *   1. ONE PUT, inside kylasUpdateContact_, read-modify-write.
 *      Kylas' Update Contact is a WHOLE-RECORD PUT — the collection
 *      sends every field. Send a partial body and the omitted fields
 *      are cleared and the record owner resets to the API key's
 *      account. So: GET, merge, PUT the whole thing back.
 *
 *   2. Stage changes go through .../pipeline-stages/{id}/activate,
 *      never by writing a stage field.
 *
 *   3. Deals set ownedBy AT CREATION. A deal created without it is
 *      owned by the API key account, and fixing it afterwards means
 *      a PUT — see rule 1.
 *
 * Every name here is prefixed kylas or KYLAS: check.js parses
 * Code.gs and Kylas.gs in one scope, so a shared name would be a
 * duplicate declaration and fail the build.
 *
 * Run kylasSetup() once to discover pipeline/stage/user ids,
 * kylasSelfTest() to verify config without writing anything.
 *******************************************************************/

// ============ CONFIG — fill from kylasSetup() ============

const KYLAS = {
  base: 'https://api.kylas.io/v1',

  // Deal pipelines per booking type. kylasSetup() prints the ids.
  pipelines: {
    Requirement:  { pipelineId: 0, stageId: 0, name: 'Active Requirement' },
    Discovery:    { pipelineId: 0, stageId: 0, name: 'Discovery Call' },
    DemandFunnel: { pipelineId: 0, stageId: 0, name: 'Demand Funnel' }
  },

  // INR. kylasSetup() prints what the tenant actually uses.
  currencyId: 400,

  // The contact's BD pipeline stage lives in a custom field. Booking a
  // discovery call moves the contact to this value.
  contactStageField: 'cfPipelineStageBd',
  discoveryStageValue: 'Discovery Call Booked',

  // How far out a new deal's estimated closure sits, in days.
  closureDays: 30
};

// ============ TRANSPORT ============

function kylasKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('KYLAS_API_KEY');
  if (!key) throw new Error('KYLAS_API_KEY is not set in Script Properties.');
  return key;
}

/**
 * The single place that talks to Kylas. Every caller goes through here
 * so the api-key header and error handling are in one place.
 */
function kylasFetch_(method, path, payload) {
  const options = {
    method: method.toLowerCase(),
    headers: { 'api-key': kylasKey_(), Accept: 'application/json' },
    muteHttpExceptions: true
  };
  if (payload !== undefined && payload !== null) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }

  const res = UrlFetchApp.fetch(KYLAS.base + path, options);
  const code = res.getResponseCode();
  const body = res.getContentText();

  if (code === 401 || code === 403) {
    throw new Error('Kylas rejected the API key (' + code + ') on ' + method + ' ' + path);
  }
  if (code < 200 || code >= 300) {
    throw new Error('Kylas ' + code + ' on ' + method + ' ' + path + ': ' + body.slice(0, 300));
  }
  return body ? JSON.parse(body) : {};
}

// ============ CONTACT ============

function kylasGetContact_(contactId) {
  return kylasFetch_('GET', '/contacts/' + encodeURIComponent(contactId));
}

/**
 * THE ONLY PUT IN THIS FILE, and the only sanctioned way to change a
 * contact.
 *
 * Reads the record, merges `changes` into it, and writes the whole
 * thing back. Kylas' Update Contact replaces the record: a partial
 * body blanks the fields you left out and resets ownedBy to the API
 * key's user. That is the bug tools/check.js exists to prevent, so do
 * not add a second PUT anywhere — extend this function instead.
 */
function kylasUpdateContact_(contactId, changes) {
  const current = kylasGetContact_(contactId);

  // Start from the record as it is, so nothing is dropped.
  const body = {};
  Object.keys(current).forEach(function (k) {
    // Server-managed fields are rejected or meaningless on write.
    if (['id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'recordActions'].indexOf(k) !== -1) return;
    body[k] = current[k];
  });

  // ownedBy must survive untouched unless a change explicitly moves it.
  if (current.ownedBy && current.ownedBy.id) body.ownedBy = { id: current.ownedBy.id };
  if (current.company && current.company.id) body.company = current.company.id;

  Object.keys(changes || {}).forEach(function (k) {
    if (k === 'customFieldValues') {
      body.customFieldValues = Object.assign({}, current.customFieldValues || {}, changes.customFieldValues);
    } else {
      body[k] = changes[k];
    }
  });

  return kylasFetch_('PUT', '/contacts/' + encodeURIComponent(contactId), body);
}

/** Moves the contact's BD stage, e.g. to "Discovery Call Booked". */
function kylasSetContactStage_(contactId, stageValue) {
  const changes = { customFieldValues: {} };
  changes.customFieldValues[KYLAS.contactStageField] = stageValue;
  return kylasUpdateContact_(contactId, changes);
}

// ============ DEAL ============

/**
 * Creates the deal. ownedBy is set here, at creation, because setting
 * it afterwards would need a PUT — and a partial PUT reassigns owners.
 *
 * spec = { name, ownerId, ownerName, pipelineId, stageId, companyId,
 *          companyName, contactId, contactName, value }
 */
function kylasCreateDeal_(spec) {
  if (!spec.ownerId) throw new Error('A deal needs an owner id, or Kylas assigns it to the API key account.');
  if (!spec.pipelineId || !spec.stageId) throw new Error('A deal needs a pipeline and stage id. Run kylasSetup().');

  const closure = new Date(Date.now() + (KYLAS.closureDays * 86400000));

  const deal = {
    ownedBy: { id: Number(spec.ownerId) },
    name: String(spec.name || 'Untitled deal'),
    estimatedClosureOn: closure.toISOString(),
    pipeline: {
      id: Number(spec.pipelineId),
      stage: { id: Number(spec.stageId) }
    }
  };

  if (spec.companyId) {
    deal.company = { id: Number(spec.companyId) };
    if (spec.companyName) deal.company.name = spec.companyName;
  }
  if (spec.contactId) {
    deal.associatedContacts = [{ id: Number(spec.contactId) }];
    if (spec.contactName) deal.associatedContacts[0].name = spec.contactName;
  }

  const value = kylasNumber_(spec.value);
  if (value !== null) {
    deal.estimatedValue = { currencyId: KYLAS.currencyId, value: value };
  }

  return kylasFetch_('POST', '/deals', deal);
}

/**
 * Moves a deal to another stage. Kylas only accepts this through the
 * activate endpoint — writing a stage field does not move the deal.
 */
function kylasMoveDealStage_(dealId, stageId, actualValue) {
  const payload = { reasonForClosing: null, products: null };
  const value = kylasNumber_(actualValue);
  if (value !== null) payload.actualValue = { currencyId: KYLAS.currencyId, value: value };

  return kylasFetch_('POST',
    '/deals/' + encodeURIComponent(dealId) + '/pipeline-stages/' + encodeURIComponent(stageId) + '/activate',
    payload);
}

// ============ NOTES ============

/**
 * Attaches a note. One call targets exactly one record, so a note that
 * should appear on both the deal and the contact is two calls.
 * entityType: 'DEAL' | 'CONTACT' | 'COMPANY' | 'LEAD'
 */
function kylasAddNote_(entityType, entityId, text) {
  if (!text || !String(text).trim()) return null;
  return kylasFetch_('POST', '/notes/relation', {
    sourceEntity: { description: kylasHtml_(text) },
    targetEntityId: String(entityId),
    targetEntityType: String(entityType).toUpperCase()
  });
}

// ============ THE BOOKING HOOK ============

/**
 * Everything Kylas-side that a booking triggers. Called from
 * bookMeeting AFTER the calendar slot is blocked.
 *
 * Deliberately never throws: the slot is already held, and losing the
 * meeting because a CRM write failed would be the wrong trade. Each
 * step reports its own outcome so the overlay can show what landed.
 */
function kylasOnBooked_(p) {
  const out = { dealId: null, stageMoved: false, noted: false, errors: [] };
  const deal = (p && p.deal) || {};

  // The overlay knows the POC by email — Google addresses are what the
  // calendar side works in. Kylas wants its own user id, so translate.
  let ownerId = p.ownerId || null;
  if (!ownerId && p.primaryEmail) {
    try {
      ownerId = kylasUserIdByEmail_(p.primaryEmail);
    } catch (err) {
      out.errors.push('Owner lookup: ' + err.message);
    }
  }

  try {
    const created = kylasCreateDeal_({
      name: deal.name,
      ownerId: ownerId,
      pipelineId: deal.pipelineId,
      stageId: deal.stageId,
      companyId: deal.companyId,
      companyName: p.company,
      contactId: deal.contactId || p.contactId,
      value: deal.value
    });
    out.dealId = created.id || null;
  } catch (err) {
    out.errors.push('Deal: ' + err.message);
  }

  // Only a discovery booking moves the contact's stage.
  if (p.callType === 'Discovery' && p.contactId) {
    try {
      kylasSetContactStage_(p.contactId, KYLAS.discoveryStageValue);
      out.stageMoved = true;
    } catch (err) {
      out.errors.push('Contact stage: ' + err.message);
    }
  }

  if (p.notes && String(p.notes).trim()) {
    try {
      kylasAddNote_(out.dealId ? 'DEAL' : 'CONTACT', out.dealId || p.contactId, p.notes);
      out.noted = true;
    } catch (err) {
      out.errors.push('Note: ' + err.message);
    }
  }

  return out;
}

// ============ HELPERS ============

/**
 * Google email -> Kylas user id, so a deal can be owned by the POC.
 * Cached: the roster is small and changes rarely, and this runs on
 * every booking.
 */
function kylasUserIdByEmail_(email) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) throw new Error('No email to resolve.');

  const cache = CacheService.getScriptCache();
  const cached = cache.get('kylasUsers');
  let users;

  if (cached) {
    users = JSON.parse(cached);
  } else {
    const raw = kylasFetch_('GET', '/users?page=0&size=200');
    users = (raw.content || raw.data || []).map(function (u) {
      return { id: u.id, email: String(u.email || '').toLowerCase() };
    });
    cache.put('kylasUsers', JSON.stringify(users), 900);
  }

  const hit = users.filter(function (u) { return u.email === target; })[0];
  if (!hit) throw new Error('No Kylas user with email ' + email);
  return hit.id;
}

/** "₹ 2,50,000" and "250000" both mean 250000; anything else means none. */
function kylasNumber_(value) {
  if (value === 0) return 0;
  if (!value) return null;
  const n = Number(String(value).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
}

/** Kylas notes render HTML, so plain text needs wrapping and escaping. */
function kylasHtml_(text) {
  const safe = String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return '<div>' + safe.split(/\n+/).join('</div><div>') + '</div>';
}

// ============ SETUP + SELF TEST — run from the editor ============

/** Prints the ids KYLAS needs. Reads only. */
function kylasSetup() {
  Logger.log('Deal pipelines');
  try {
    const raw = kylasFetch_('GET', '/pipelines/search?page=0&size=100&sort=updatedAt,desc');
    const list = raw.content || raw.data || [];
    list.forEach(function (p) {
      const type = String(p.entityType || '').toLowerCase();
      if (type && type !== 'deal') return;
      Logger.log('  [' + p.id + '] ' + p.name);
      (p.stages || p.pipelineStages || []).forEach(function (s, i) {
        Logger.log('       ' + (i === 0 ? '(first) ' : '       ') + '[' + s.id + '] ' + s.name);
      });
    });
  } catch (err) {
    Logger.log('  FAILED: ' + err.message);
  }

  Logger.log('');
  Logger.log('Users (for ownedBy)');
  try {
    const raw = kylasFetch_('GET', '/users?page=0&size=200');
    (raw.content || raw.data || []).forEach(function (u) {
      Logger.log('  [' + u.id + '] ' + [u.firstName, u.lastName].filter(String).join(' ') + '  ' + (u.email || ''));
    });
  } catch (err) {
    Logger.log('  FAILED: ' + err.message);
  }
}

/** Verifies config and connectivity. Writes nothing. */
function kylasSelfTest() {
  Logger.log('API key set: ' +
    (PropertiesService.getScriptProperties().getProperty('KYLAS_API_KEY') ? 'yes' : 'NO'));

  Object.keys(KYLAS.pipelines).forEach(function (k) {
    const p = KYLAS.pipelines[k];
    Logger.log(k + ': pipeline ' + p.pipelineId + ', stage ' + p.stageId +
      (p.pipelineId && p.stageId ? '' : '   <-- still 0, run kylasSetup()'));
  });

  try {
    kylasFetch_('GET', '/users?page=0&size=1');
    Logger.log('Kylas reachable: yes');
  } catch (err) {
    Logger.log('Kylas reachable: NO — ' + err.message);
  }
}
