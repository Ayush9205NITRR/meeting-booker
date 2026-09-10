/*******************************************************************
 * ENOUT — POC ROUTER
 *
 * The slot ALWAYS gets blocked. Availability is advisory only —
 * it tells you who the tentative POC should be. A clash, a busy
 * calendar, or missing access never stops the booking.
 *
 * BOOKERS   = whoever is running the router. Goes on the invite.
 * PLAYERS   = take the call. Calendar read to suggest a POC.
 * REVIEWERS = managers / shared inbox. Optional on every invite.
 * CLIENT    = their people. Typed in per booking.
 *
 * Nothing is written into the calendar event body.
 *******************************************************************/

// ============ 1. CONFIG — edit only this block ============

const TZ = 'Asia/Kolkata';

// Everyone who may book. Kept in step with kylas-airtable-sync's
// config/team.json `bd_team` — that roster is what the rest of the
// business treats as "the BD team", so a name on it that is missing
// here is a BD who gets told they aren't allowed to book.
//
// shreya@enout.in and shreya.bodwal@enout.in are both listed on
// purpose: the second is the one on the roster, the first was already
// here, and nobody could say which is current. An extra address costs
// nothing; a missing one locks someone out.
const BOOKERS = [
  'aditi.saini@enout.in',
  'anjali.athya@enout.in',
  'arshdeep@enout.in',
  'ayush@enout.in',
  'bhaumik@enout.in',
  'devansh.shukla@enout.in',
  'gaurav@enout.in',
  'gurnoor@enout.in',
  'hisham@enout.in',
  'ife.malpani@enout.in',
  'keshav@enout.in',
  'mayra@enout.in',
  'muskan@enout.in',
  'rashid@enout.in',
  'rubal@enout.in',
  'saahil@enout.in',
  'sejal.agarwal@enout.in',
  'shreya.bodwal@enout.in',
  'shreya@enout.in',
  'tanay.kumar@enout.in'
];

// ORDER MATTERS. This is the hierarchy. When more than one person is
// free, the one highest in this list becomes the POC.
const PLAYERS = [
  { name: 'Hritik',  email: 'hrithik@enout.in' },
  { name: 'Shreya',  email: 'shreya.bodwal@enout.in' },
  { name: 'Aarushi', email: 'aarushi@enout.in' },
  { name: 'Nikita',  email: 'nikita.sharma@enout.in' },
  { name: 'Keshav',  email: 'keshav@enout.in' }
];

// true  — every player goes on the invite, so the slot is held on all
//         their calendars. Only the POC is a required attendee.
// false — only the POC is invited.
const BLOCK_ALL_PLAYERS = true;

// 'order'    — straight down the PLAYERS list. Predictable; the first
//              name takes most calls.
// 'rotation' — among the free ones, whoever took a call least recently.
const ASSIGNMENT = 'order';

const REVIEWERS = [
  { name: 'Ayush',      email: 'ayush@enout.in',      default: true  },
  { name: 'Akash',      email: 'akash@enout.in',      default: true  },
  { name: 'Lakshaya',   email: 'lakshaya.sharma@enout.in',   default: true },
  { name: 'Experience', email: 'experience@enout.in', default: true  },
  { name: 'Pawanjot', email: 'pawanjot@enout.in', default: true  }
];

const DEFAULT_DURATION = 30;

const WORK_START_HOUR = 10;
const WORK_END_HOUR   = 19;
const WORK_DAYS       = [1, 2, 3, 4, 5, 6];   // 1=Mon … 6=Sat, 0=Sun
const SCAN_DAYS       = 3;
const SCAN_STEP_MINS  = 15;

// 4 = Indian FY (Apr–Mar) → "Q2 FY27". Set 1 for calendar quarters.
const FISCAL_YEAR_START_MONTH = 4;

// 'auto'      — write to the POC's calendar; without writer access,
//               fall back to the script account's and invite them.
// 'onPrimary' — always the POC's calendar.
// 'onSelf'    — always the script account's calendar.
const BOOKING_MODE = 'auto';

// ============ 2. ENTRY POINT ============

function doGet(e) {
  const params = (e && e.parameter) || {};

  // The Chrome overlay calls this same web app with ?action=..., so route
  // those to the JSON API, which checks the token itself.
  if (params.action) return overlayApi_(e);

  // The page is gated on the same token.
  //
  // This deployment is ANYONE_ANONYMOUS, because a domain check cannot
  // work for the extension: a browser will not send Google's session
  // cookie on a cross-site request from a service worker. Anonymous
  // access is what makes the extension possible — but it also means that
  // without this check, anyone holding the /exec URL could open the POC
  // Router page and book meetings through it, since the page reaches
  // bookMeeting over google.script.run rather than through the API the
  // token guards.
  //
  // So the token protects both doors, not just one.
  const expected = overlaySecret_('OVERLAY_TOKEN');
  if (expected && params.token !== expected) {
    return HtmlService.createHtmlOutput(
      '<div style="font:16px/1.6 system-ui;max-width:34rem;margin:4rem auto;padding:0 1rem">' +
      '<h2 style="margin:0 0 .5rem">POC Router</h2>' +
      '<p>This link needs its access token. Use the bookmarked URL — the one ' +
      'ending in <code>?token=…</code> — rather than the bare /exec address.</p>' +
      '<p style="color:#6b7280">Ask Ayush if you need it again.</p></div>'
    ).setTitle('POC Router');
  }

  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('POC Router')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// The overlay's two write actions — booking a meeting and adding notes.
// index.html doesn't use this path at all: it calls bookMeeting() directly
// through google.script.run, so nothing here changes that page.
function doPost(e) {
  return overlayApiPost_(e);
}

// ============ 3. HELPERS ============

function parseLocal_(str) {
  return Utilities.parseDate(String(str).replace('T', ' '), TZ, 'yyyy-MM-dd HH:mm');
}
function iso_(d)  { return Utilities.formatDate(d, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"); }
function hhmm_(d) { return Utilities.formatDate(d, TZ, 'HH:mm'); }
function overlaps_(aS, aE, bS, bE) { return aS < bE && bS < aE; }
function validEmail_(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e).trim()); }

function initials_(name) {
  const parts = String(name).trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : String(name).substring(0, 2)).toUpperCase();
}

function quarterLabel_(d) {
  const m = Number(Utilities.formatDate(d, TZ, 'M'));
  const y = Number(Utilities.formatDate(d, TZ, 'yyyy'));
  if (FISCAL_YEAR_START_MONTH === 1) return 'Q' + (Math.floor((m - 1) / 3) + 1) + ' ' + y;
  const idx = (m - FISCAL_YEAR_START_MONTH + 12) % 12;
  const q = Math.floor(idx / 3) + 1;
  const fyEnd = (m >= FISCAL_YEAR_START_MONTH ? y + 1 : y) % 100;
  return 'Q' + q + ' FY' + (fyEnd < 10 ? '0' + fyEnd : fyEnd);
}

function rotation_() {
  const raw = PropertiesService.getScriptProperties().getProperty('ROTATION');
  return raw ? JSON.parse(raw) : {};
}
function stampRotation_(email) {
  const r = rotation_();
  r[email] = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty('ROTATION', JSON.stringify(r));
}

function freeBusy_(emails, from, to) {
  return Calendar.Freebusy.query({
    timeMin: iso_(from), timeMax: iso_(to), timeZone: TZ,
    items: emails.map(function (e) { return { id: e }; })
  });
}

// Google answers a large freeBusy query with `tooManyCalendarsRequested`
// against SOME of the calendars — the rest come back fine, so the failure
// reads as "these particular people are unreachable" when the truth is
// "you asked about too many at once". Only checkAccess is big enough to hit
// this (30 calendars); booking asks about one. Chunking keeps the answer
// about the people rather than about the request.
function freeBusyChunked_(emails, from, to, size) {
  const step = size || 10;
  const calendars = {};
  for (let i = 0; i < emails.length; i += step) {
    const batch = emails.slice(i, i + step);
    try {
      const part = freeBusy_(batch, from, to).calendars || {};
      Object.keys(part).forEach(function (k) { calendars[k] = part[k]; });
    } catch (err) {
      // A whole batch failing is itself worth reporting per person, rather
      // than silently leaving them out of the table.
      batch.forEach(function (e) {
        calendars[e] = { errors: [{ reason: 'query failed: ' + err.message }] };
      });
    }
  }
  return { calendars: calendars };
}

function scriptAccount_() {
  try { return Session.getEffectiveUser().getEmail() || ''; } catch (e) { return ''; }
}

// ============ 4. THE BOARD ============

function getBoard(localStart, duration) {
  try {
    const slotStart = parseLocal_(localStart);
    if (isNaN(slotStart.getTime())) throw new Error('Could not read that date and time.');

    const mins = Math.max(5, Math.min(480, Number(duration) || DEFAULT_DURATION));
    const slotEnd = new Date(slotStart.getTime() + mins * 60000);

    const from = new Date(slotStart.getTime() - 30 * 60000);
    const to   = new Date(Math.max(slotEnd.getTime(), slotStart.getTime() + 150 * 60000));

    const emails = PLAYERS.map(function (p) { return p.email; });
    const fb = freeBusy_(emails, from, to);
    const rot = rotation_();

    const players = PLAYERS.map(function (p, i) {
      const cal  = (fb.calendars || {})[p.email] || {};
      const errs = cal.errors || [];

      const blocks = (cal.busy || []).map(function (b) {
        const bs = new Date(b.start), be = new Date(b.end);
        return { start: iso_(bs), end: iso_(be), label: hhmm_(bs) + '–' + hhmm_(be),
                 clashes: overlaps_(slotStart, slotEnd, bs, be) };
      });

      let status = 'FREE';
      if (errs.length) status = 'NO ACCESS';
      else if (blocks.some(function (b) { return b.clashes; })) status = 'BUSY';

      if (status === 'FREE') {
        const cushion = new Date(slotEnd.getTime() + 15 * 60000);
        if (blocks.some(function (b) {
          return overlaps_(slotEnd, cushion, new Date(b.start), new Date(b.end));
        })) status = 'TIGHT';
      }

      let line, warn = null;
      if (status === 'NO ACCESS') {
        line = 'Calendar not shared';
        warn = "You can't see their calendar — the slot gets blocked either way.";
      } else if (status === 'BUSY') {
        const c = blocks.filter(function (b) { return b.clashes; })[0];
        line = 'In a meeting ' + c.label;
        warn = 'Already booked ' + c.label + '. Blocking this will double-book them.';
      } else if (status === 'TIGHT') {
        const nxt = blocks.filter(function (b) { return new Date(b.start) >= slotEnd; })
          .sort(function (a, b) { return new Date(a.start) - new Date(b.start); })[0];
        line = 'Next meeting at ' + (nxt ? hhmm_(new Date(nxt.start)) : 'soon after');
      } else {
        line = blocks.length
          ? blocks.length + ' other ' + (blocks.length === 1 ? 'meeting' : 'meetings') + ' today'
          : 'Nothing else booked';
      }

      return {
        name: p.name, email: p.email, initials: initials_(p.name),
        rank: i + 1, status: status, line: line, warn: warn,
        free: status === 'FREE' || status === 'TIGHT',
        lastAssigned: rot[p.email] || null,
        lastAssignedLabel: rot[p.email]
          ? Utilities.formatDate(new Date(rot[p.email]), TZ, 'd MMM') : null
      };
    });

    const free  = players.filter(function (p) { return p.status === 'FREE'; });
    const tight = players.filter(function (p) { return p.status === 'TIGHT'; });
    const pool  = (free.length ? free : (tight.length ? tight : players)).slice();

    if (ASSIGNMENT === 'rotation') {
      pool.sort(function (a, b) {
        const ta = a.lastAssigned ? new Date(a.lastAssigned).getTime() : 0;
        const tb = b.lastAssigned ? new Date(b.lastAssigned).getTime() : 0;
        return ta - tb || a.rank - b.rank;
      });
    } else {
      pool.sort(function (a, b) { return a.rank - b.rank; });
    }

    const chosen = pool[0];
    let why;
    if (free.length > 1) {
      why = ASSIGNMENT === 'rotation'
        ? free.length + ' free. ' + chosen.name +
          (chosen.lastAssignedLabel ? ' took a call least recently (' + chosen.lastAssignedLabel + ').'
                                    : " hasn't taken one yet.")
        : free.length + ' free. ' + chosen.name + ' is highest on the list.';
    } else if (free.length === 1) {
      why = chosen.name + ' is the only one free.';
    } else if (tight.length) {
      why = 'Nobody is fully free. ' + chosen.name + ' is closest — back-to-back after.';
    } else {
      why = 'Everyone is booked. ' + chosen.name + ' is first on the list.';
    }

    const now = new Date();
    return {
      ok: true,
      bookers: BOOKERS,
      assignment: ASSIGNMENT,
      blockAll: BLOCK_ALL_PLAYERS,
      slot: {
        startIso: iso_(slotStart), endIso: iso_(slotEnd), duration: mins,
        isPast: slotEnd < now,
        outsideHours: (function () {
          const h = Number(Utilities.formatDate(slotStart, TZ, 'H'));
          const d = Number(Utilities.formatDate(slotStart, TZ, 'u')) % 7;
          return h < WORK_START_HOUR || h >= WORK_END_HOUR || WORK_DAYS.indexOf(d) === -1;
        })()
      },
      players: players,
      reviewers: REVIEWERS,
      suggestedPrimary: chosen.email,
      why: why,
      anyFree: free.length > 0,
      freeCount: free.length,
      quarter: quarterLabel_(slotStart),
      fetchedAt: hhmm_(now)
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// ============ 5. NEXT OPEN SLOTS (suggestion only) ============

function findNextSlots(duration, count) {
  try {
    const mins = Math.max(5, Number(duration) || DEFAULT_DURATION);
    const want = Math.max(1, Math.min(8, Number(count) || 5));
    const now = new Date();
    const horizon = new Date(now.getTime() + SCAN_DAYS * 86400000);
    const emails = PLAYERS.map(function (p) { return p.email; });

    const fb = freeBusy_(emails, now, horizon);
    const busyBy = {};
    emails.forEach(function (e) {
      const cal = (fb.calendars || {})[e] || {};
      busyBy[e] = (cal.errors || []).length ? null
        : (cal.busy || []).map(function (b) { return { s: new Date(b.start), e: new Date(b.end) }; });
    });

    const out = [];
    let cur = new Date(now.getTime());
    cur.setSeconds(0, 0);
    cur.setMinutes(Math.ceil(cur.getMinutes() / SCAN_STEP_MINS) * SCAN_STEP_MINS);

    while (cur < horizon && out.length < want) {
      const h    = Number(Utilities.formatDate(cur, TZ, 'H'));
      const dow  = Number(Utilities.formatDate(cur, TZ, 'u')) % 7;
      const end  = new Date(cur.getTime() + mins * 60000);
      const endH = Number(Utilities.formatDate(end, TZ, 'H'));
      const endM = Number(Utilities.formatDate(end, TZ, 'm'));
      const inHours = WORK_DAYS.indexOf(dow) !== -1 && h >= WORK_START_HOUR &&
                      (endH < WORK_END_HOUR || (endH === WORK_END_HOUR && endM === 0));

      if (inHours) {
        const s = new Date(cur.getTime());
        const free = PLAYERS.filter(function (p) {
          const list = busyBy[p.email];
          if (list === null) return false;
          return !list.some(function (b) { return overlaps_(s, end, b.s, b.e); });
        }).map(function (p) { return p.name; });

        if (free.length) {
          out.push({
            localStart: Utilities.formatDate(cur, TZ, "yyyy-MM-dd'T'HH:mm"),
            label: Utilities.formatDate(cur, TZ, 'EEE d MMM') + ' · ' + hhmm_(cur),
            free: free
          });
        }
      }
      cur = new Date(cur.getTime() + SCAN_STEP_MINS * 60000);
    }
    return { ok: true, slots: out };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// ============ 6. BOOK — always goes through ============

/**
 * payload = { you, primaryEmail, localStart, duration, title, company,
 *             callType, reviewers[], externals[] }
 *
 * Only genuinely unusable input is rejected: a missing booker, an empty
 * title, an unreadable date, a malformed guest address. Clashes and
 * missing calendar access are reported, never blocking.
 *
 * primaryEmail is optional. A discovery call has no tentative POC — none
 * of the players joins it — so the booker runs it alone and no player
 * calendar is held.
 */
function bookMeeting(payload) {
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(10000)) throw new Error('Another booking is going through. Try again in a second.');

    const p = payload || {};
    if (!p.you) throw new Error('Pick your own email first.');
    if (BOOKERS.indexOf(String(p.you).trim().toLowerCase()) === -1) {
      throw new Error('That email is not on the list of people who can book.');
    }
    if (!p.title || !String(p.title).trim()) throw new Error('The invite needs a title.');

    // No POC is a valid booking, not a missing field. One that is named
    // but unknown still is an error — that is a bad payload, not a choice.
    const wantsPoc = !!(p.primaryEmail && String(p.primaryEmail).trim());
    const primary = wantsPoc
      ? PLAYERS.filter(function (x) { return x.email === p.primaryEmail; })[0]
      : null;
    if (wantsPoc && !primary) throw new Error('That person is not on the players list.');

    const start = parseLocal_(p.localStart);
    if (isNaN(start.getTime())) throw new Error('Could not read that date and time.');
    const mins = Math.max(5, Math.min(480, Number(p.duration) || DEFAULT_DURATION));
    const end  = new Date(start.getTime() + mins * 60000);

    // Look, but never stop. Whatever we find gets reported back. With no
    // POC there is no third calendar to clash with.
    let conflict = null;
    if (primary) try {
      const cal = (freeBusy_([primary.email], start, end).calendars || {})[primary.email] || {};
      if ((cal.errors || []).length) {
        conflict = "Couldn't read " + primary.name + "'s calendar, so a clash can't be ruled out.";
      } else if ((cal.busy || []).length) {
        const b = cal.busy[0];
        conflict = primary.name + ' was already booked ' + hhmm_(new Date(b.start)) + '–' +
                   hhmm_(new Date(b.end)) + '. They are now double-booked.';
      }
    } catch (e) {
      conflict = 'Availability check failed, so a clash could not be ruled out.';
    }

    const seen = {};
    const attendees = [];
    function add_(email, optional) {
      const e = String(email).trim().toLowerCase();
      if (!e || seen[e]) return;
      seen[e] = true;
      attendees.push({ email: e, optional: !!optional });
    }

    if (primary) add_(primary.email, false);   // the POC — required
    add_(p.you, false);                        // you booked it

    // Hold the slot on everyone's calendar. Non-POC players go on as
    // optional, so the invite still lands and blocks their time without
    // telling them they have to show up. Without a POC nobody is held:
    // holding every player for a call none of them attends is exactly the
    // wasted time this is meant to avoid.
    let playersBlocked = primary ? 1 : 0;
    if (BLOCK_ALL_PLAYERS && primary) {
      PLAYERS.forEach(function (x) {
        if (x.email === primary.email) return;
        if (!seen[x.email.toLowerCase()]) playersBlocked++;
        add_(x.email, true);
      });
    }

    const allowed = {};
    REVIEWERS.forEach(function (r) { allowed[r.email.toLowerCase()] = true; });
    (p.reviewers || []).forEach(function (e) {
      if (allowed[String(e).trim().toLowerCase()]) add_(e, true);
    });

    const bad = [];
    (p.externals || []).forEach(function (e) {
      const t = String(e).trim();
      if (!t) return;
      if (!validEmail_(t)) { bad.push(t); return; }
      add_(t, false);
    });
    if (bad.length) throw new Error('These addresses look wrong: ' + bad.join(', '));

    // No description. Nothing goes into the event body.
    const resource = {
      summary: String(p.title).trim(),
      start: { dateTime: iso_(start), timeZone: TZ },
      end:   { dateTime: iso_(end),   timeZone: TZ },
      attendees: attendees,
      // Whoever ends up organising, the people on the call need to be able
      // to move it, add someone, or cancel it. With this false the invite
      // is read-only to everyone but the organiser — which is why a POC
      // who received the invite couldn't manage their own meeting.
      guestsCanModify: true,
      guestsCanInviteOthers: true,
      conferenceData: {
        createRequest: { requestId: Utilities.getUuid(),
                         conferenceSolutionKey: { type: 'hangoutsMeet' } }
      },
      extendedProperties: {
        private: { pocRouter: 'true', primary: primary ? primary.email : '', bookedBy: p.you,
                   company: p.company || '', callType: p.callType || '' }
      }
    };
    const opts = { sendUpdates: 'all', conferenceDataVersion: 1 };

    const acct = scriptAccount_();
    let ev = null, hostedOn = 'primary', note = null;
    function onSelf_() { return Calendar.Events.insert(resource, 'primary', opts); }

    // The organiser is whoever is picked in "Your email" — the BD doing
    // the booking. It used to be the tentative POC, which meant the person
    // taking the call owned an invite they hadn't sent, and when writing to
    // their calendar failed it fell back to the script account silently:
    // that is how meetings ended up organised by someone who wasn't
    // involved, with nobody able to manage them.
    const wants = String(p.you).trim();
    let organiser = wants;

    if (BOOKING_MODE === 'onSelf' || wants === acct) {
      ev = onSelf_(); hostedOn = 'self'; organiser = acct;
    } else {
      try {
        ev = Calendar.Events.insert(resource, wants, opts);
        hostedOn = 'booker';
      } catch (writeErr) {
        // Still falls back rather than losing the slot, but says so — and
        // says what would fix it, because the fix is one calendar share.
        ev = onSelf_(); hostedOn = 'self'; organiser = acct;
        note = 'Organised by ' + acct + ' rather than ' + wants +
               ", because that calendar couldn't be written to. Everyone " +
               'invited can still edit the meeting. To have it organised by ' +
               wants + ', share their calendar with ' + acct +
               ' with "Make changes to events".';
      }
    }

    // The rotation tracks who last led a call. A call with no POC moves
    // nobody down the list.
    if (primary) stampRotation_(primary.email);

    return {
      ok: true,
      primary: primary ? primary.name : null,
      title: resource.summary,
      when: Utilities.formatDate(start, TZ, 'EEE d MMM') + ' · ' + hhmm_(start) + '–' + hhmm_(end),
      guests: attendees.length,
      playersBlocked: playersBlocked,
      totalPlayers: PLAYERS.length,
      link: ev.htmlLink,
      meet: ev.hangoutLink || null,
      // Reported on every booking, not just the fallback, so "who is the
      // organiser" is something you can see rather than infer.
      organiser: organiser,
      conflict: conflict,
      hostedOn: hostedOn,
      note: note
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ============ 7. DIAGNOSTIC — run once from the editor ============

function checkAccess() {
  // BOOKERS first, because they are the ones this actually gates. A booker
  // whose calendar the script cannot write to still books fine — but the
  // meeting comes out organised by the script account instead of them, and
  // that is the difference between "I can move my own meeting" and "I have
  // to ask Ayush". Worth knowing for the whole team BEFORE rollout rather
  // than one confused BD at a time.
  const rows = BOOKERS.map(function (e) {
    return { who: e.split('@')[0], email: e, role: 'booker' };
  }).concat(PLAYERS.map(function (x, i) {
    return { who: x.name, email: x.email, role: 'player #' + (i + 1) };
  })).concat(REVIEWERS.map(function (x) {
    return { who: x.name, email: x.email, role: 'reviewer' };
  }));

  const now = new Date();
  const fb = freeBusyChunked_(
    rows.map(function (r) { return r.email; }), now, new Date(now.getTime() + 3600000));

  const acct = scriptAccount_();
  Logger.log('Script runs as: ' + acct);
  Logger.log('Assignment mode: ' + ASSIGNMENT);
  Logger.log('');
  Logger.log(pad_('WHO', 18) + pad_('ROLE', 12) + pad_('READ', 24) + 'WRITE');
  Logger.log('---------------------------------------------------------------------------');

  const needsShare = [];   // real calendar, just hasn't shared it
  const noCalendar = [];   // Google doesn't know this address at all

  rows.forEach(function (r) {
    const c = (fb.calendars || {})[r.email] || {};
    const errs = c.errors || [];
    const reason = errs.length ? String(errs[0].reason || '?') : '';
    const read = errs.length ? 'BLOCKED (' + reason + ')' : 'ok';

    let write, writable = false;
    try {
      const role = Calendar.CalendarList.get(r.email).accessRole;
      writable = (role === 'writer' || role === 'owner');
      write = writable ? 'ok' : 'no (' + role + ')';
    } catch (e) { write = 'no (not shared)'; }

    if (r.role === 'booker' && !writable && r.email !== acct) {
      // notFound from freeBusy means Google has no calendar at this
      // address. Telling that person to "share their calendar" is advice
      // they cannot follow — the address itself is the problem, and it is
      // a different fix: correct it, or take them off BOOKERS.
      if (reason === 'notFound') noCalendar.push(r.email);
      else needsShare.push(r.email);
    }
    Logger.log(pad_(r.who, 18) + pad_(r.role, 12) + pad_(read, 24) + write);
  });

  Logger.log('');
  Logger.log('READ no  — that person just shows NO ACCESS in the list. Still bookable.');
  Logger.log('WRITE no — for a PLAYER or REVIEWER: the invite is sent instead of');
  Logger.log('           written; the slot holds once they accept. Harmless.');
  Logger.log('           for a BOOKER: their meetings get organised by ' + acct);
  Logger.log('           instead of by them, so they do not own their own call.');
  Logger.log('Neither one ever stops a booking.');

  if (needsShare.length) {
    Logger.log('');
    Logger.log('=== ' + needsShare.length + ' need to share their calendar ===');
    needsShare.forEach(function (e) { Logger.log('  ' + e); });
    Logger.log('');
    Logger.log('Each of them, once: Google Calendar -> Settings -> their calendar ->');
    Logger.log('"Share with specific people" -> add ' + acct +
               ' with "Make changes to events".');
  }

  if (noCalendar.length) {
    Logger.log('');
    Logger.log('=== ' + noCalendar.length + ' addresses Google has no calendar for ===');
    noCalendar.forEach(function (e) { Logger.log('  ' + e); });
    Logger.log('');
    Logger.log('These are NOT people who forgot to share — Google says the address');
    Logger.log('does not exist. Usually a typo, a person who has left, or a Kylas');
    Logger.log('login that was never a Google account. Sending them sharing');
    Logger.log('instructions will not work.');
    Logger.log('Fix the address in BOOKERS (apps-script/Code.gs) or remove it, and');
    Logger.log('check config/team.json in kylas-airtable-sync says the same thing.');
    Logger.log('Until then their bookings stay organised by ' + acct + '.');
  }

  if (!needsShare.length && !noCalendar.length) {
    Logger.log('');
    Logger.log('All ' + BOOKERS.length + ' bookers can organise their own meetings.');
  }
}

function pad_(s, n) {
  s = String(s);
  return s.length >= n ? s.substring(0, n - 1) + ' ' : s + Array(n - s.length + 1).join(' ');
}