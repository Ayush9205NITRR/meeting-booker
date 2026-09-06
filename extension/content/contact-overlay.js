// Runs on https://app.kylas.io/sales/contacts/details/<id>
// Adds a "Book Meeting" overlay that mirrors POC Router's actual flow:
// pick a call type (duration) -> see next open slots -> see the board
// (suggested POC + who's free) -> confirm. The backend does calendar
// blocking (Code.gs bookMeeting), and — once Kylas.gs is wired in — Kylas
// deal creation, the contact status update, and the notes attach.
// A second "Add meeting notes" box lets the BD drop in qualitative notes
// any time after the call — independent of the booking step.

(function () {
  const CONTACT_PATH = /\/sales\/contacts\/details\/(\d+)/;

  // Call types are a client-side convenience over POC Router's raw
  // duration/callType fields — there's no server-side "meeting type" list.
  const CALL_TYPES = [
    { id: "discovery", name: "Discovery Call", duration: 30 },
    { id: "demo", name: "Product Demo", duration: 45 },
    { id: "technical", name: "Technical Deep Dive", duration: 60 },
  ];

  let currentContactId = null;
  let selectedCallType = null;
  let selectedSlot = null;
  let selectedBoard = null;
  let lastDealId = null;

  async function getBookerEmail() {
    const { bookerEmail } = await chrome.storage.sync.get("bookerEmail");
    return bookerEmail || null;
  }

  function renderIdle(panel) {
    panel.setBody(`
      <button class="ko-primary-btn" id="ko-book-btn">Book Meeting</button>
      <div class="ko-notes-box">
        <label class="ko-row-label">Add meeting notes</label>
        <textarea id="ko-standalone-notes" placeholder="Qualitative notes from a call…"></textarea>
        <button class="ko-secondary-btn" id="ko-save-standalone-notes">Save to Kylas</button>
        <div id="ko-standalone-notes-status"></div>
      </div>
    `);

    panel.body.querySelector("#ko-book-btn").addEventListener("click", async () => {
      const booker = await getBookerEmail();
      if (!booker) {
        renderNeedsBookerEmail(panel);
        return;
      }
      renderCallTypes(panel);
    });

    panel.body.querySelector("#ko-save-standalone-notes").addEventListener("click", async (e) => {
      const btn = e.target;
      const text = panel.body.querySelector("#ko-standalone-notes").value.trim();
      const status = panel.body.querySelector("#ko-standalone-notes-status");
      if (!text) return;
      btn.disabled = true;
      status.textContent = "Saving…";
      try {
        const response = await KylasOverlay.request("addNotes", {
          contactId: currentContactId,
          dealId: lastDealId,
          notes: text,
        });
        status.textContent =
          response?.ok === false ? `Failed: ${response.error}` : "Saved.";
        if (response?.demo) status.textContent += ` (${response.notice})`;
      } catch (err) {
        status.textContent = `Failed: ${err}`;
      } finally {
        btn.disabled = false;
      }
    });
  }

  function renderNeedsBookerEmail(panel) {
    panel.setBody(`
      <div class="ko-error">
        Set your email in the extension popup first (it must be one of
        POC Router's BOOKERS) — that's who the invite is booked as.
      </div>
      <button class="ko-secondary-btn" id="ko-back">Back</button>
    `);
    panel.body.querySelector("#ko-back").addEventListener("click", () => renderIdle(panel));
  }

  function renderLoading(panel, message) {
    panel.setBody(`<div class="ko-loading">${KylasOverlay.escapeHtml(message)}</div>`);
  }

  function renderError(panel, message, backAction) {
    panel.setBody(`
      <div class="ko-error">${KylasOverlay.escapeHtml(message)}</div>
      <button class="ko-secondary-btn" id="ko-back">Back</button>
    `);
    panel.body.querySelector("#ko-back").addEventListener("click", backAction);
  }

  function renderCallTypes(panel) {
    const options = CALL_TYPES.map(
      (ct) => `
        <label class="ko-radio-row">
          <input type="radio" name="ko-call-type" value="${ct.id}">
          ${KylasOverlay.escapeHtml(ct.name)}
          <span class="ko-muted">${ct.duration}m</span>
        </label>`
    ).join("");

    panel.setBody(`
      <div class="ko-step-title">1. Call type</div>
      ${options}
      <button class="ko-primary-btn" id="ko-continue-slots" disabled>See open slots</button>
      <button class="ko-secondary-btn" id="ko-back">Back</button>
    `);

    const continueBtn = panel.body.querySelector("#ko-continue-slots");
    panel.body.querySelectorAll('input[name="ko-call-type"]').forEach((input) => {
      input.addEventListener("change", () => {
        selectedCallType = CALL_TYPES.find((ct) => ct.id === input.value);
        continueBtn.disabled = false;
      });
    });
    continueBtn.addEventListener("click", () => loadNextSlots(panel));
    panel.body.querySelector("#ko-back").addEventListener("click", () => renderIdle(panel));
  }

  async function loadNextSlots(panel) {
    renderLoading(panel, "Scanning calendars for open slots…");
    try {
      const response = await KylasOverlay.request("getNextSlots", {
        duration: selectedCallType.duration,
        count: 5,
      });
      if (!response || response.ok === false) {
        renderError(panel, response?.error || "Could not load open slots.", () =>
          renderCallTypes(panel)
        );
        return;
      }
      renderSlots(panel, response);
    } catch (err) {
      renderError(panel, String(err), () => renderCallTypes(panel));
    }
  }

  function renderSlots(panel, response) {
    const notice = response.demo
      ? `<div class="ko-notice">${KylasOverlay.escapeHtml(response.notice)}</div>`
      : "";

    if (!response.slots?.length) {
      panel.setBody(
        notice +
          `<div class="ko-empty">No open slots found in the next few days.</div>
           <button class="ko-secondary-btn" id="ko-back">Back</button>`
      );
      panel.body.querySelector("#ko-back").addEventListener("click", () => renderCallTypes(panel));
      return;
    }

    const options = response.slots
      .map(
        (slot, i) => `
          <button class="ko-slot-btn" data-index="${i}">
            ${KylasOverlay.escapeHtml(slot.label)}
            <span class="ko-muted">${KylasOverlay.escapeHtml((slot.free || []).join(", "))}</span>
          </button>`
      )
      .join("");

    panel.setBody(`
      ${notice}
      <div class="ko-step-title">2. Pick a slot</div>
      <div class="ko-slot-list">${options}</div>
      <button class="ko-secondary-btn" id="ko-back">Back</button>
    `);

    panel.body.querySelectorAll(".ko-slot-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedSlot = response.slots[Number(btn.dataset.index)];
        loadBoard(panel);
      });
    });
    panel.body.querySelector("#ko-back").addEventListener("click", () => renderCallTypes(panel));
  }

  async function loadBoard(panel) {
    renderLoading(panel, "Checking who's free at that time…");
    try {
      const response = await KylasOverlay.request("getBoard", {
        localStart: selectedSlot.localStart,
        duration: selectedCallType.duration,
      });
      if (!response || response.ok === false) {
        renderError(panel, response?.error || "Could not load the board.", () =>
          loadNextSlots(panel)
        );
        return;
      }
      selectedBoard = response;
      renderConfirm(panel, response);
    } catch (err) {
      renderError(panel, String(err), () => loadNextSlots(panel));
    }
  }

  function renderConfirm(panel, board) {
    const notice = board.demo
      ? `<div class="ko-notice">${KylasOverlay.escapeHtml(board.notice)}</div>`
      : "";

    const playerOptions = board.players
      .map(
        (p) => `
        <label class="ko-radio-row">
          <input type="radio" name="ko-primary" value="${p.email}" ${
          p.email === board.suggestedPrimary ? "checked" : ""
        }>
          ${KylasOverlay.escapeHtml(p.name)}
          <span class="ko-muted">${KylasOverlay.escapeHtml(p.status)}</span>
        </label>`
      )
      .join("");

    const reviewerOptions = (board.reviewers || [])
      .map(
        (r) => `
        <label class="ko-radio-row">
          <input type="checkbox" name="ko-reviewer" value="${r.email}" ${r.default ? "checked" : ""}>
          ${KylasOverlay.escapeHtml(r.name)}
        </label>`
      )
      .join("");

    panel.setBody(`
      ${notice}
      <div class="ko-step-title">3. Confirm</div>
      <div class="ko-row"><div class="ko-row-label">When</div><div class="ko-row-value">${KylasOverlay.escapeHtml(
        selectedSlot.label
      )}</div></div>
      <div class="ko-why">${KylasOverlay.escapeHtml(board.why || "Pick who takes this call.")}</div>
      ${playerOptions}
      <label class="ko-row-label">Title</label>
      <input type="text" id="ko-title" value="${KylasOverlay.escapeHtml(selectedCallType.name)}">
      <label class="ko-row-label">Company (free text)</label>
      <input type="text" id="ko-company" placeholder="Company name">
      <label class="ko-row-label">Reviewers</label>
      ${reviewerOptions}
      <label class="ko-row-label">Client emails (comma-separated)</label>
      <input type="text" id="ko-externals" placeholder="client@company.com">
      <label class="ko-row-label">Notes (optional)</label>
      <textarea id="ko-confirm-notes" placeholder="Anything to capture before the call…"></textarea>
      <button class="ko-primary-btn" id="ko-confirm-book">Confirm booking</button>
      <button class="ko-secondary-btn" id="ko-back">Back</button>
      <div id="ko-confirm-status"></div>
    `);

    panel.body.querySelector("#ko-back").addEventListener("click", () => loadNextSlots(panel));
    panel.body.querySelector("#ko-confirm-book").addEventListener("click", async (e) => {
      const btn = e.target;
      const status = panel.body.querySelector("#ko-confirm-status");
      const primaryEmail = panel.body.querySelector('input[name="ko-primary"]:checked')?.value;
      const title = panel.body.querySelector("#ko-title").value.trim();
      const company = panel.body.querySelector("#ko-company").value.trim();
      const notes = panel.body.querySelector("#ko-confirm-notes").value.trim();
      const externals = panel.body
        .querySelector("#ko-externals")
        .value.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const reviewers = [...panel.body.querySelectorAll('input[name="ko-reviewer"]:checked')].map(
        (el) => el.value
      );

      if (!title) {
        status.textContent = "Title is required.";
        return;
      }

      btn.disabled = true;
      status.textContent = "Booking…";
      try {
        const you = await getBookerEmail();
        const response = await KylasOverlay.request("bookMeeting", {
          you,
          primaryEmail,
          localStart: selectedSlot.localStart,
          duration: selectedCallType.duration,
          title,
          company,
          callType: selectedCallType.id,
          reviewers,
          externals,
          contactId: currentContactId,
          notes,
        });
        if (!response || response.ok === false) {
          status.textContent = `Failed: ${response?.error || "unknown error"}`;
          btn.disabled = false;
          return;
        }
        lastDealId = response.dealId || lastDealId;
        renderBooked(panel, response);
      } catch (err) {
        status.textContent = `Failed: ${err}`;
        btn.disabled = false;
      }
    });
  }

  function renderBooked(panel, response) {
    const notice = response.demo
      ? `<div class="ko-notice">${KylasOverlay.escapeHtml(response.notice)}</div>`
      : "";
    const link = response.link
      ? `<div class="ko-row"><div class="ko-row-label">Calendar</div><div class="ko-row-value"><a href="${response.link}" target="_blank" rel="noopener">Open event</a></div></div>`
      : "";
    panel.setBody(`
      ${notice}
      <div class="ko-success">Booked with ${KylasOverlay.escapeHtml(
        response.primary || "the assigned POC"
      )}.</div>
      ${link}
      <button class="ko-secondary-btn" id="ko-done">Done</button>
    `);
    panel.body.querySelector("#ko-done").addEventListener("click", () => renderIdle(panel));
  }

  const panel = KylasOverlay.createPanel({
    id: "kylas-overlay-contact-panel",
    title: "Book Meeting",
    side: "right",
  });

  KylasOverlay.watchRecordId(CONTACT_PATH, (contactId) => {
    panel.setHeader({
      name: "Book Meeting",
      avatar: "📅",
      subtitleHtml: `Contact #${KylasOverlay.escapeHtml(contactId)}`,
    });
    currentContactId = contactId;
    selectedCallType = null;
    selectedSlot = null;
    selectedBoard = null;
    lastDealId = null;
    renderIdle(panel);
  });
})();
