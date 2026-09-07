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

  const state = {
    contactId: null,
    callType: "Requirement", // or "Discovery"
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

  // Mirrors bookMeeting's attendee logic so the count shown matches what
  // actually lands on the invite.
  function guestEmails() {
    const seen = {};
    const out = [];
    const add = (e) => {
      const v = String(e || "").trim().toLowerCase();
      if (v && !seen[v]) {
        seen[v] = 1;
        out.push(v);
      }
    };
    if (state.primary) add(state.primary);
    add(state.you);
    if (state.board && state.board.blockAll) {
      state.board.players.forEach((p) => add(p.email));
    }
    if (state.board) {
      state.board.reviewers.forEach((r) => {
        if (state.revSel[r.email]) add(r.email);
      });
    }
    state.externals.forEach(add);
    return out;
  }

  function buildTitle() {
    if (state.titleEdited) return;
    const c = state.company.trim() || "[Company]";
    const x = state.extra.trim();
    const q = (state.board && state.board.quarter) || "";
    state.title =
      state.callType === "Requirement"
        ? `${c} <> Enout: ${x || "[Event type]"}${q ? " | " + q : ""}`
        : `${c} <> Enout | ${x || "[Last event]"}`;
  }

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
      <div class="ko-seg">
        <button id="ko-t-req" class="${isReq ? "on" : ""}">Active requirement</button>
        <button id="ko-t-disc" class="${isReq ? "" : "on"}">Discovery</button>
      </div>
      <label class="ko-lb">Company</label>
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
        <span class="ko-sub">${b ? `${b.freeCount} of ${b.players.length} free` : ""}</span></div>
      ${whyHtml()}
      <div class="ko-list" id="ko-roster">${rosterHtml()}</div>

      ${b ? guestsHtml() : ""}

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
        <span class="ko-sub">${total ? total + " on the invite" : ""}</span></div>
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
        <p class="ko-hint">Type an email, press Enter.</p>
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

    $("#ko-t-req").addEventListener("click", () => setType("Requirement"));
    $("#ko-t-disc").addEventListener("click", () => setType("Discovery"));

    // Re-render on each keystroke would steal focus, so update the title
    // preview in place instead.
    const refreshTitle = () => {
      buildTitle();
      const view = $("#ko-title-view");
      const input = $("#ko-title");
      if (view) view.textContent = state.title;
      if (input && !state.titleEdited) input.value = state.title;
    };
    $("#ko-company").addEventListener("input", (e) => { state.company = e.target.value; refreshTitle(); });
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
        render();
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
        // The backend resolves the company and deal value from this, so the
        // deal lands on the right account without the BD retyping anything.
        contactId: state.contactId,
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

  KylasOverlay.watchRecordId(CONTACT_PATH, (contactId) => {
    state.contactId = contactId;
    state.booked = null;
    state.error = null;
    panel.setHeader({
      name: "Book Meeting",
      avatar: "📅",
      subtitleHtml: `Contact #${esc(contactId)}`,
    });
    load();
  });
})();
