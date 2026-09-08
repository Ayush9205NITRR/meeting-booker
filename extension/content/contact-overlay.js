// Runs on https://app.kylas.io/sales/contacts/details/<id>
//
// A port of the POC Router web app (src/index.html) into the overlay, so a
// BD books from inside Kylas instead of switching to the /exec page. The
// flow, the field logic and the payload are deliberately identical to that
// page — same getBoard / findNextSlots / bookMeeting contract — so both
// front ends stay interchangeable.
//
// Two meeting structures, as in the original:
//   Active requirement -> "{Company} <> Enout: {Event type} | {Quarter}"
//   Discovery          -> "{Company} <> Enout | {Last event}"
//
// The slot ALWAYS gets blocked. Availability is advisory: it says who the
// tentative POC should be. A clash never stops the booking.

(function () {
  const CONTACT_PATH = /\/sales\/contacts\/details\/(\d+)/;
  const REFRESH_MS = 45000;

  // The three deal types. `pipelineHint` is matched against the pipeline
  // names Kylas returns so the right one is preselected — the BD can always
  // override with the dropdown, so a miss costs a click, not a wrong deal.
  const TYPES = [
    { id: "Requirement", label: "Active requirement", deal: "Active Requirement", pipelineHint: "requirement" },
    { id: "Discovery", label: "Discovery", deal: "Discovery Call", pipelineHint: "discovery" },
    { id: "DemandFunnel", label: "Demand funnel", deal: "Demand Funnel", pipelineHint: "demand" },
  ];
  const typeOf = (id) => TYPES.find((t) => t.id === id) || TYPES[0];

  const state = {
    contactId: null,
    callType: "Requirement", // Requirement | Discovery | DemandFunnel
    company: "",
    extra: "",
    title: "",
    titleEdited: false,
    you: "",
    primary: null,
    board: null,
    revSel: {},
    externals: [],
    busy: false,
    booked: null,
    error: null,

    // Deal. Only these six things are ever asked for.
    pipelines: null,      // [{id,name,stages:[{id,name}]}]
    pipelineId: "",
    stageId: "",
    dealName: "",
    dealNameEdited: false,
    dealValue: "",
    dealValueEdited: false,
    assoc: null,          // { contact, owner, company } from Kylas
    setupError: "",       // why the deal setup couldn't load, shown plainly

    // Client side comes from the company's own contact records, so emails
    // are the ones Kylas holds rather than typed from memory.
    companyContacts: null,
    pickedContacts: {},   // email -> true
  };

  let refreshTimer = null;
  let panel = null;

  // ── helpers ───────────────────────────────────────────────

  const esc = (s) => KylasOverlay.escapeHtml(s);
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  const okEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e).trim());

  function remember(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* storage blocked */
    }
  }
  function recall(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function roundTo5(d) {
    d.setSeconds(0, 0);
    d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
    return d;
  }

  const now5 = roundTo5(new Date());
  state.date = `${now5.getFullYear()}-${pad(now5.getMonth() + 1)}-${pad(now5.getDate())}`;
  state.time = `${pad(now5.getHours())}:${pad(now5.getMinutes())}`;
  state.duration = 30;

  const localStart = () => `${state.date}T${state.time}`;

  // Everyone who ends up on the invite, grouped and labelled. This is the
  // single source of truth for both the count and the roll-up, so what a
  // BD is shown is exactly who gets invited — nobody is silently dropped.
  function attendees() {
    const seen = {};
    const out = [];
    const add = (email, name, role) => {
      const v = String(email || "").trim().toLowerCase();
      if (!v || seen[v]) return;
      seen[v] = 1;
      out.push({ email: v, name: name || v.split("@")[0], role });
    };

    const b = state.board;
    const poc = b && b.players.find((p) => p.email === state.primary);
    if (poc) add(poc.email, poc.name, "POC — leads the call");
    add(state.you, state.you && state.you.split("@")[0], "You — booking it");

    // The contact's owner in Kylas. Missed before, which is why invites
    // were going out without the person who owns the relationship.
    const owner = state.assoc && state.assoc.owner;
    if (owner && owner.email) add(owner.email, owner.name, "Contact owner");

    // Every other player, so the slot is held on all their calendars.
    if (b && b.blockAll) {
      b.players.forEach((p) => add(p.email, p.name, "POC — slot held"));
    }
    if (b) {
      b.reviewers.forEach((r) => {
        if (state.revSel[r.email]) add(r.email, r.name, "Reviewer");
      });
    }

    (state.companyContacts || []).forEach((c) => {
      if (state.pickedContacts[c.email]) {
        add(c.email, c.name, "Client" + (c.designation ? " — " + c.designation : ""));
      }
    });
    state.externals.forEach((e) => add(e, null, "Client — added manually"));

    return out;
  }

  const guestEmails = () => attendees().map((a) => a.email);

  function buildTitle() {
    if (state.titleEdited) return;
    const c = companyName() || "[Company]";
    const x = state.extra.trim();
    const q = (state.board && state.board.quarter) || "";
    state.title =
      state.callType === "Requirement"
        ? `${c} <> Enout: ${x || "[Event type]"}${q ? " | " + q : ""}`
        : `${c} <> Enout | ${x || "[Last event]"}`;
  }

  // One company name, resolved from the contact, used by the invite title
  // and the deal alike. There is no separate per-type company field —
  // "Globemoving" on a Demand Funnel deal and on its invite are the same
  // string because they come from the same place.
  function companyName() {
    return (
      (state.assoc && state.assoc.company && state.assoc.company.name) ||
      state.company.trim()
    );
  }

  function buildDealName() {
    if (state.dealNameEdited) return;
    const co = companyName();
    state.dealName = co ? `${co} — ${typeOf(state.callType).deal}` : typeOf(state.callType).deal;
  }

  // Preselect the pipeline whose name matches the chosen type, and its
  // FIRST stage — that's the whole setup for Demand Funnel, and the same
  // default is right for the other two.
  function applyPipelineDefault() {
    if (!state.pipelines || !state.pipelines.length) return;
    const hint = typeOf(state.callType).pipelineHint;
    const match =
      state.pipelines.find((p) => p.name.toLowerCase().includes(hint)) || state.pipelines[0];
    state.pipelineId = String(match.id);
    state.stageId = match.stages.length ? String(match.stages[0].id) : "";
  }

  const currentPipeline = () =>
    (state.pipelines || []).find((p) => String(p.id) === String(state.pipelineId)) || null;

  // ── rendering ─────────────────────────────────────────────

  function render() {
    buildTitle();
    const b = state.board;
    const isReq = state.callType === "Requirement";

    panel.setBody(`
      ${state.error ? `<div class="ko-error">${esc(state.error)}</div>` : ""}
      ${
        b && b.demo
          ? `<div class="ko-notice">${esc(b.notice)}</div>`
          : ""
      }

      <div class="ko-when">
        <label class="ko-tf"><span>Date</span>
          <input type="date" id="ko-date" value="${esc(state.date)}"></label>
        <label class="ko-tf"><span>Start</span>
          <input type="time" id="ko-time" step="300" value="${esc(state.time)}"></label>
        <label class="ko-tf"><span>Length</span>
          <select id="ko-dur">
            ${[15, 30, 45, 60, 90]
              .map(
                (m) =>
                  `<option value="${m}"${m === state.duration ? " selected" : ""}>${m} min</option>`
              )
              .join("")}
          </select></label>
      </div>
      ${noticesHtml()}

      <div class="ko-step"><span class="ko-n">1</span><h2>Name the invite</h2></div>
      <div class="ko-seg ko-seg-3">
        ${TYPES.map(
          (t) =>
            `<button data-type="${t.id}" class="${t.id === state.callType ? "on" : ""}">${esc(t.label)}</button>`
        ).join("")}
      </div>
      <label class="ko-lb">Company${
        state.assoc && state.assoc.company ? " <span class='ko-from'>from the contact</span>" : ""
      }</label>
      <input type="text" id="ko-company" placeholder="Acme Pvt Ltd" value="${esc(state.company)}">
      <label class="ko-lb">${isReq ? "Event type" : "Last event"}</label>
      <input type="text" id="ko-extra" placeholder="${isReq ? "Offsite" : "Annual Offsite 2025"}"
             value="${esc(state.extra)}">
      <div class="ko-prev">
        <div class="ko-mono" id="ko-title-view"${state.titleEdited ? ' hidden' : ""}>${esc(state.title)}</div>
        <input type="text" id="ko-title" value="${esc(state.title)}"${state.titleEdited ? "" : " hidden"}>
        <button class="ko-link" id="ko-edit-title">${state.titleEdited ? "Use generated" : "Edit"}</button>
      </div>

      <div class="ko-step"><span class="ko-n">2</span><h2>Your email</h2></div>
      <select id="ko-you" class="ko-select${state.you ? "" : " unset"}">
        <option value="">Choose your email…</option>
        ${(b ? b.bookers || [] : [])
          .map(
            (e) => `<option value="${esc(e)}"${e === state.you ? " selected" : ""}>${esc(e)}</option>`
          )
          .join("")}
      </select>

      <div class="ko-step"><span class="ko-n">3</span><h2>Tentative POC</h2>
        <span class="ko-sub">${
          b
            ? `${
                // freeCount can be absent depending on the backend's shape;
                // count it rather than printing "undefined of N free".
                typeof b.freeCount === "number"
                  ? b.freeCount
                  : b.players.filter((p) => p.free).length
              } of ${b.players.length} free`
            : ""
        }</span></div>
      ${whyHtml()}
      <div class="ko-list" id="ko-roster">${rosterHtml()}</div>

      ${b ? guestsHtml() : ""}
      ${dealHtml()}

      <div class="ko-actbar">
        ${flagHtml()}
        <div class="ko-actwho">
          <div class="ko-act-a">${actionLine()}</div>
          <div class="ko-act-b ko-mono">${esc(prettyWhen())}</div>
        </div>
        <button class="ko-go" id="ko-go"${canBook() ? "" : " disabled"}>
          ${state.busy ? "Blocking…" : "Block"}
        </button>
      </div>

      ${resultHtml()}
    `);

    bind();
  }

  function noticesHtml() {
    const b = state.board;
    if (!b || !b.slot) return "";
    const out = [];
    if (b.slot.isPast) out.push("That time has already passed.");
    if (b.slot.outsideHours) out.push("Outside 10am–7pm.");
    return out.map((t) => `<div class="ko-warn">${esc(t)}</div>`).join("");
  }

  function whyHtml() {
    const b = state.board;
    if (!b) return "";
    const p = b.players.find((x) => x.email === state.primary);
    if (!p) return "";
    if (state.primary === b.suggestedPrimary) {
      return `<p class="ko-why"><b>${esc(p.name)}</b> — ${esc(b.why)}</p>`;
    }
    const sug = (b.players.find((x) => x.email === b.suggestedPrimary) || {}).name || "—";
    return `<p class="ko-why"><b>${esc(p.name)}</b> — your pick, over ${esc(sug)}.</p>`;
  }

  function rosterHtml() {
    const b = state.board;
    if (!b) {
      return '<div class="ko-skel"></div><div class="ko-skel"></div><div class="ko-skel"></div>';
    }
    // Free first, then list order. Everyone stays selectable — a busy
    // POC is a warning, never a block.
    const sorted = b.players.slice().sort((a, c) => {
      if (a.free !== c.free) return a.free ? -1 : 1;
      return a.rank - c.rank;
    });
    return sorted
      .map((p) => {
        const on = p.email === state.primary;
        const rank = b.assignment === "order" ? `<span class="ko-rank">#${p.rank}</span>` : "";
        return `
          <div class="ko-p${on ? " sel" : ""}" data-email="${esc(p.email)}">
            <span class="ko-av">${esc(p.initials || KylasOverlay.initials(p.name))}</span>
            <span class="ko-who">
              <span class="ko-n2">${esc(p.name)}</span>
              <span class="ko-l2">${esc(p.line || "")}</span>
            </span>
            <span class="ko-rt">
              ${on ? '<span class="ko-poc">POC</span>' : ""}
              <span class="ko-tag t-${esc(String(p.status).replace(/\s/g, ""))}">${esc(p.status)}</span>
              ${rank}
            </span>
          </div>`;
      })
      .join("");
  }

  function guestsHtml() {
    const b = state.board;
    const you = state.you;
    const others = b.blockAll ? b.players.filter((p) => p.email !== state.primary) : [];
    const total = guestEmails().length;

    return `
      <div class="ko-step"><span class="ko-n">4</span><h2>Who else joins</h2>
        <span class="ko-sub" id="ko-guest-count">${total ? total + " on the invite" : ""}</span></div>
      <div class="ko-cap"><span>From Enout</span>
        <button class="ko-link" id="ko-rev-all">${everyOn() ? "Clear all" : "Add all"}</button></div>
      <div class="ko-tags">
        ${you ? `<span class="ko-fixed"><span class="ko-tk">✓</span>${esc(you.split("@")[0])} (you)</span>` : ""}
        ${b.reviewers
          .map((r) => {
            if (!(r.email in state.revSel)) state.revSel[r.email] = !!r.default;
            return `<button class="ko-tg${state.revSel[r.email] ? " on" : ""}" data-e="${esc(r.email)}">
                      <span class="ko-tk">✓</span>${esc(r.name)}</button>`;
          })
          .join("")}
      </div>
      ${
        others.length
          ? `<p class="ko-hint">Plus every player — ${esc(
              others.map((x) => x.name).join(", ")
            )} — so the slot is held on their calendars too.</p>`
          : ""
      }
      <div class="ko-split">
        <div class="ko-cap"><span>Client side</span></div>
        ${clientContactsHtml()}
        <p class="ko-hint">Anyone not in Kylas — type an email, press Enter.</p>
        <div class="ko-chips" id="ko-chips">
          ${state.externals
            .map(
              (e, i) =>
                `<span class="ko-chip${okEmail(e) ? "" : " bad"}">${esc(e)}
                   <button data-i="${i}">×</button></span>`
            )
            .join("")}
        </div>
        <input type="text" id="ko-ext" placeholder="name@company.com" autocomplete="off">
      </div>

      ${inviteRollupHtml()}`;
  }

  // Client participants come from the company's own contact records, so
  // the email is the one Kylas holds rather than one typed from memory.
  function clientContactsHtml() {
    if (state.companyContacts === null) {
      return `<p class="ko-hint">Loading contacts at this company…</p>`;
    }
    if (!state.companyContacts.length) {
      return `<p class="ko-hint">No other contacts on this company in Kylas.</p>`;
    }
    return `
      <div class="ko-people">
        ${state.companyContacts
          .map(
            (c) => `
          <label class="ko-person${state.pickedContacts[c.email] ? " on" : ""}">
            <input type="checkbox" data-email="${esc(c.email)}"
                   ${state.pickedContacts[c.email] ? "checked" : ""}>
            <span class="ko-person-t">
              <span class="ko-person-n">${esc(c.name)}${
                c.designation ? ` <span class="ko-muted">${esc(c.designation)}</span>` : ""
              }</span>
              <span class="ko-person-e">${esc(c.email)}</span>
            </span>
          </label>`
          )
          .join("")}
      </div>`;
  }

  // The whole point: before blocking, show every stakeholder who will be
  // on the invite, with their email and why they're there. Nobody gets
  // added invisibly.
  function rollupRowsHtml(list) {
    return list
      .map(
        (a) => `
      <div class="ko-invitee">
        <span class="ko-invitee-n">${esc(a.name)}</span>
        <span class="ko-invitee-e">${esc(a.email)}</span>
        <span class="ko-invitee-r">${esc(a.role)}</span>
      </div>`
      )
      .join("");
  }

  // Ticking an attendee must not re-render the panel: that destroys the
  // checkbox under the cursor mid-click and throws away scroll position in
  // a panel this long. Update only what actually changed.
  function refreshAttendees() {
    const list = attendees();
    const rollup = panel.body.querySelector("#ko-rollup");
    if (rollup) rollup.innerHTML = rollupRowsHtml(list);

    const count = panel.body.querySelector("#ko-rollup-count");
    if (count) count.textContent = String(list.length);

    const guestCount = panel.body.querySelector("#ko-guest-count");
    if (guestCount) guestCount.textContent = list.length ? `${list.length} on the invite` : "";

    const actA = panel.body.querySelector(".ko-act-a");
    if (actA) actA.innerHTML = actionLine();
  }

  function inviteRollupHtml() {
    const list = attendees();
    if (!list.length) return "";
    return `
      <div class="ko-split">
        <div class="ko-cap"><span>On the invite</span>
          <span class="ko-muted" id="ko-rollup-count">${list.length}</span></div>
        <div class="ko-rollup" id="ko-rollup">${rollupRowsHtml(list)}</div>
      </div>`;
  }

  // Six fields, nothing else. Company and contact are resolved from the
  // record rather than asked for, so they're shown, not typed.
  function dealHtml() {
    buildDealName();
    const pipe = currentPipeline();
    const co = state.assoc && state.assoc.company;
    const ct = state.assoc && state.assoc.contact;

    return `
      <div class="ko-step"><span class="ko-n">5</span><h2>Deal</h2>
        <span class="ko-sub">created on booking</span></div>
      ${
        state.setupError
          ? `<div class="ko-warn">${esc(state.setupError)}</div>`
          : ""
      }

      <label class="ko-lb">Deal name</label>
      <input type="text" id="ko-deal-name" value="${esc(state.dealName)}">

      <div class="ko-two">
        <div>
          <label class="ko-lb">Pipeline</label>
          <select id="ko-pipeline" class="ko-select">
            ${
              state.pipelines && state.pipelines.length
                ? state.pipelines
                    .map(
                      (p) =>
                        `<option value="${esc(p.id)}"${
                          String(p.id) === String(state.pipelineId) ? " selected" : ""
                        }>${esc(p.name)}</option>`
                    )
                    .join("")
                : `<option>${state.pipelines ? "None found" : "Loading…"}</option>`
            }
          </select>
        </div>
        <div>
          <label class="ko-lb">Stage</label>
          <select id="ko-stage" class="ko-select">
            ${
              pipe
                ? pipe.stages
                    .map(
                      (s) =>
                        `<option value="${esc(s.id)}"${
                          String(s.id) === String(state.stageId) ? " selected" : ""
                        }>${esc(s.name)}</option>`
                    )
                    .join("")
                : `<option>—</option>`
            }
          </select>
        </div>
      </div>

      <label class="ko-lb">Deal value</label>
      <input type="text" id="ko-deal-value" placeholder="e.g. 250000" value="${esc(state.dealValue)}">

      <div class="ko-assoc">
        <div class="ko-kv"><span>Company</span><span>${
          co ? esc(co.name) : '<span class="ko-empty-value">resolving from contact…</span>'
        }</span></div>
        <div class="ko-kv"><span>Contact</span><span>${
          ct ? esc(ct.name) : `#${esc(state.contactId || "")}`
        }</span></div>
      </div>`;
  }

  function everyOn() {
    return (
      state.board && state.board.reviewers.every((r) => state.revSel[r.email])
    );
  }

  function flagHtml() {
    const p = state.board && state.board.players.find((x) => x.email === state.primary);
    return p && p.warn ? `<div class="ko-flag">${esc(p.warn)}</div>` : "";
  }

  function canBook() {
    return !state.busy && !!state.you && !!state.primary && !!state.board;
  }

  function actionLine() {
    if (!state.board) return "Checking calendars…";
    if (!state.you) return "Pick your email in step 2";
    const p = state.board.players.find((x) => x.email === state.primary);
    if (!p) return "Pick a POC";
    return `${esc(p.name)} leads · ${guestEmails().length} on the invite`;
  }

  function prettyWhen() {
    const d = new Date(localStart().replace("T", " ").replace(/-/g, "/"));
    if (isNaN(d)) return localStart();
    const end = new Date(d.getTime() + state.duration * 60000);
    const fmt = (x) => `${x.getHours() % 12 || 12}:${pad(x.getMinutes())}${x.getHours() >= 12 ? "pm" : "am"}`;
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const diff = Math.round((day - today) / 86400000);
    const label =
      diff === 0 ? "Today" : diff === 1 ? "Tomorrow"
        : `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
    return `${label}, ${fmt(d)}–${fmt(end)}`;
  }

  function resultHtml() {
    const r = state.booked;
    if (!r) return "";
    if (!r.ok) return `<div class="ko-error">${esc(r.error || "Booking failed.")}</div>`;
    return `
      <div class="ko-done">
        <div class="ko-done-hd"><i></i><h3>Slot blocked</h3></div>
        <div class="ko-kv"><span>POC</span><span>${esc(r.primary)}</span></div>
        <div class="ko-kv"><span>Held for</span><span>${
          r.playersBlocked > 1 ? `all ${r.playersBlocked} players` : esc(r.primary) + " only"
        }</span></div>
        <div class="ko-kv"><span>When</span><span>${esc(r.when || "")}</span></div>
        <div class="ko-kv"><span>Invited</span><span>${esc(String(r.guests || ""))}</span></div>
        ${r.dealId ? `<div class="ko-kv"><span>Deal</span><span>${esc(r.dealId)}</span></div>` : ""}
        ${r.conflict ? `<div class="ko-kv flagged"><span>Heads up</span><span>${esc(r.conflict)}</span></div>` : ""}
        ${r.note ? `<div class="ko-kv"><span>Note</span><span>${esc(r.note)}</span></div>` : ""}
        ${
          r.link
            ? `<div class="ko-links"><a href="${esc(r.link)}" target="_blank" rel="noopener">Open in Calendar</a>
               ${r.meet ? `<a href="${esc(r.meet)}" target="_blank" rel="noopener">Join link</a>` : ""}</div>`
            : ""
        }
      </div>`;
  }

  // ── events ────────────────────────────────────────────────

  function bind() {
    const $ = (id) => panel.body.querySelector(id);

    $("#ko-date").addEventListener("change", (e) => { state.date = e.target.value; load(); });
    $("#ko-time").addEventListener("change", (e) => { state.time = e.target.value; load(); });
    $("#ko-dur").addEventListener("change", (e) => { state.duration = Number(e.target.value); load(); });

    panel.body.querySelectorAll(".ko-seg button").forEach((btn) => {
      btn.addEventListener("click", () => setType(btn.getAttribute("data-type")));
    });

    $("#ko-deal-name").addEventListener("input", (e) => {
      state.dealName = e.target.value;
      state.dealNameEdited = true;
    });
    $("#ko-deal-value").addEventListener("input", (e) => {
      state.dealValue = e.target.value;
      state.dealValueEdited = true;
    });
    $("#ko-pipeline").addEventListener("change", (e) => {
      state.pipelineId = e.target.value;
      const p = currentPipeline();
      // A stage from the old pipeline is meaningless here, so land on the
      // new pipeline's first stage.
      state.stageId = p && p.stages.length ? String(p.stages[0].id) : "";
      render();
    });
    $("#ko-stage").addEventListener("change", (e) => { state.stageId = e.target.value; });

    // Re-render on each keystroke would steal focus, so update the title
    // preview in place instead.
    const refreshTitle = () => {
      buildTitle();
      const view = $("#ko-title-view");
      const input = $("#ko-title");
      if (view) view.textContent = state.title;
      if (input && !state.titleEdited) input.value = state.title;
    };
    $("#ko-company").addEventListener("input", (e) => {
      state.company = e.target.value;
      if (state.assoc && state.assoc.company) state.assoc.company.name = e.target.value;
      refreshTitle();
      buildDealName();
    });
    $("#ko-extra").addEventListener("input", (e) => { state.extra = e.target.value; refreshTitle(); });
    $("#ko-title").addEventListener("input", (e) => { state.title = e.target.value; });

    $("#ko-edit-title").addEventListener("click", () => {
      state.titleEdited = !state.titleEdited;
      if (!state.titleEdited) buildTitle();
      render();
    });

    $("#ko-you").addEventListener("change", (e) => {
      state.you = e.target.value;
      if (state.you) remember("pocYou", state.you);
      render();
    });

    panel.body.querySelectorAll(".ko-p").forEach((row) => {
      row.addEventListener("click", () => {
        state.primary = row.getAttribute("data-email");
        render();
      });
    });

    const revAll = $("#ko-rev-all");
    if (revAll) {
      revAll.addEventListener("click", () => {
        const on = !everyOn();
        state.board.reviewers.forEach((r) => { state.revSel[r.email] = on; });
        render();
      });
    }
    panel.body.querySelectorAll(".ko-tg").forEach((btn) => {
      btn.addEventListener("click", () => {
        const e = btn.getAttribute("data-e");
        state.revSel[e] = !state.revSel[e];
        btn.classList.toggle("on", state.revSel[e]);
        const all = panel.body.querySelector("#ko-rev-all");
        if (all) all.textContent = everyOn() ? "Clear all" : "Add all";
        refreshAttendees();
      });
    });

    const ext = $("#ko-ext");
    if (ext) {
      const commit = () => {
        ext.value.split(/[,;\s]+/).forEach((e) => {
          const v = e.trim();
          if (v && state.externals.indexOf(v) === -1) state.externals.push(v);
        });
        ext.value = "";
        render();
      };
      ext.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === ",") { ev.preventDefault(); commit(); }
        else if (ev.key === "Backspace" && !ext.value && state.externals.length) {
          state.externals.pop();
          render();
        }
      });
      ext.addEventListener("blur", () => { if (ext.value.trim()) commit(); });
    }
    panel.body.querySelectorAll(".ko-person input").forEach((box) => {
      box.addEventListener("change", () => {
        const email = box.getAttribute("data-email");
        if (box.checked) state.pickedContacts[email] = true;
        else delete state.pickedContacts[email];
        box.closest(".ko-person").classList.toggle("on", box.checked);
        refreshAttendees();
      });
    });

    panel.body.querySelectorAll("#ko-chips button").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.externals.splice(Number(btn.getAttribute("data-i")), 1);
        render();
      });
    });

    $("#ko-go").addEventListener("click", book);
  }

  function setType(type) {
    state.callType = type;
    buildTitle();
    // Switching type re-points the deal at that type's pipeline and first
    // stage — the whole Demand Funnel setup is one click.
    applyPipelineDefault();
    buildDealName();
    render();
  }

  // ── data ──────────────────────────────────────────────────

  async function load() {
    clearTimeout(refreshTimer);
    if (!state.date || !state.time) return;

    state.error = null;
    if (!state.board) render();

    try {
      const res = await KylasOverlay.request("getBoard", {
        localStart: localStart(),
        duration: state.duration,
      });
      if (!res || res.ok === false) {
        state.error = (res && res.error) || "Couldn't read calendars.";
        state.board = null;
        render();
        return;
      }

      const first = !state.board;
      state.board = res;

      if (first) {
        const saved = recall("pocYou");
        if (saved && (res.bookers || []).includes(saved)) state.you = saved;
        res.reviewers.forEach((r) => {
          if (!(r.email in state.revSel)) state.revSel[r.email] = !!r.default;
        });
      }

      // Keep the BD's pick if they made one and that person is still listed.
      if (!state.primary || !res.players.some((p) => p.email === state.primary)) {
        state.primary = res.suggestedPrimary;
      }

      render();
      refreshTimer = setTimeout(load, REFRESH_MS);
    } catch (err) {
      state.error = String(err);
      render();
    }
  }

  // Deal setup, fetched once per contact. Neither of these should be able
  // to break booking, so a failure just leaves the dropdown or the company
  // line empty rather than surfacing an error over the whole panel.
  async function loadDealSetup() {
    const problems = [];

    if (!state.pipelines) {
      try {
        const res = await KylasOverlay.request("getDealPipelines", {});
        state.pipelines = (res && res.pipelines) || [];
        if (state.pipelines.length) applyPipelineDefault();
        else problems.push("No deal pipelines returned");
      } catch (e) {
        state.pipelines = [];
        problems.push("Pipelines failed to load");
      }
    }

    try {
      const res = await KylasOverlay.request("getContact", { contactId: state.contactId });
      if (res && res.ok) {
        state.assoc = res;
        // Company name flows into both the invite title and the deal.
        if (res.company && res.company.name && !state.company.trim()) {
          state.company = res.company.name;
        }
        if (res.company && res.company.dealValue && !state.dealValueEdited) {
          state.dealValue = String(res.company.dealValue);
        }
        buildTitle();
        buildDealName();
        if (res.company && res.company.id) loadCompanyContacts(res.company.id);
        else state.companyContacts = [];
      } else {
        problems.push((res && res.error) || "Contact lookup failed");
        state.companyContacts = [];
      }
    } catch (e) {
      problems.push("Contact lookup failed");
      state.companyContacts = [];
    }

    // Say why rather than leaving a dropdown spinning forever.
    state.setupError = problems.length
      ? problems.join(". ") + ". Set the POC Router URL in the extension popup."
      : "";
    render();
  }

  async function loadCompanyContacts(companyId) {
    try {
      const res = await KylasOverlay.request("getCompanyContacts", { companyId });
      state.companyContacts = (res && res.contacts) || [];
    } catch (e) {
      state.companyContacts = [];
    }
    render();
  }

  async function book() {
    if (!canBook()) return;

    const bad = state.externals.filter((e) => !okEmail(e));
    if (bad.length) {
      state.error = "This doesn't look like an email: " + bad.join(", ");
      render();
      return;
    }
    if (!state.title.trim()) {
      state.error = "The invite needs a title.";
      render();
      return;
    }

    state.busy = true;
    state.error = null;
    render();

    try {
      const res = await KylasOverlay.request("bookMeeting", {
        you: state.you,
        primaryEmail: state.primary,
        localStart: localStart(),
        duration: state.duration,
        title: state.title.trim(),
        company: state.company.trim(),
        callType: state.callType,
        reviewers: state.board.reviewers
          .filter((r) => state.revSel[r.email])
          .map((r) => r.email),
        externals: state.externals,
        contactId: state.contactId,
        // Everyone shown in the roll-up, with the role each was listed
        // under, so the invite matches the panel exactly.
        attendees: attendees(),
        ownerEmail: state.assoc && state.assoc.owner ? state.assoc.owner.email : null,
        // Six fields, exactly. Company and contact go as ids resolved from
        // the record, so the deal lands on the right account without the BD
        // retyping anything the CRM already knows.
        deal: {
          name: state.dealName.trim(),
          type: typeOf(state.callType).deal,
          pipelineId: state.pipelineId,
          stageId: state.stageId,
          value: state.dealValue.trim(),
          companyId: state.assoc && state.assoc.company ? state.assoc.company.id : null,
          contactId: state.contactId,
        },
      });
      state.booked = res;
      if (res && res.ok) state.externals = [];
    } catch (err) {
      state.booked = { ok: false, error: String(err) };
    } finally {
      state.busy = false;
      render();
      setTimeout(load, 1500);
    }
  }

  // ── boot ──────────────────────────────────────────────────

  panel = KylasOverlay.createPanel({
    id: "kylas-overlay-contact-panel",
    title: "Book Meeting",
    side: "right",
  });

  panel.setVisible(false);
  KylasOverlay.watchRecordId(CONTACT_PATH, (contactId) => {
    panel.setVisible(true);
    state.contactId = contactId;
    state.booked = null;
    state.error = null;
    state.assoc = null;
    state.dealNameEdited = false;
    state.dealValueEdited = false;
    state.dealValue = "";
    state.company = "";
    state.companyContacts = null;
    state.pickedContacts = {};
    state.setupError = "";
    panel.setHeader({
      name: "Book Meeting",
      avatar: "📅",
      subtitleHtml: `Contact #${esc(contactId)}`,
    });
    load();
    loadDealSetup();
  }, () => {
    // Left the contact — stop the 45s board refresh so a hidden panel
    // isn't polling calendars in the background.
    clearTimeout(refreshTimer);
    panel.setVisible(false);
  });
})();
