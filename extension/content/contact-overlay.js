// Runs on https://app.kylas.io/sales/contacts/details/<id>
// Adds a "Book Meeting" overlay: pick a meeting type -> pick a free slot ->
// confirm. The backend (POC Router) does availability, calendar blocking,
// deal creation and the contact status update to "Discovery Call".
// A second "Add meeting notes" box lets the BD drop in qualitative notes
// any time after the call — it's independent of the booking step.

(function () {
  const CONTACT_PATH = /\/sales\/contacts\/details\/(\d+)/;

  let currentContactId = null;
  let selectedMeetingType = null;
  let selectedSlot = null;
  let lastDealId = null;

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

    panel.body.querySelector("#ko-book-btn").addEventListener("click", () => {
      loadMeetingTypes(panel);
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

  async function loadMeetingTypes(panel) {
    renderLoading(panel, "Loading meeting types…");
    try {
      const response = await KylasOverlay.request("getMeetingTypes", {});
      if (!response || response.ok === false) {
        renderError(panel, response?.error || "Could not load meeting types.", () =>
          renderIdle(panel)
        );
        return;
      }
      renderMeetingTypes(panel, response);
    } catch (err) {
      renderError(panel, String(err), () => renderIdle(panel));
    }
  }

  function renderMeetingTypes(panel, response) {
    const notice = response.demo
      ? `<div class="ko-notice">${KylasOverlay.escapeHtml(response.notice)}</div>`
      : "";
    const options = response.meetingTypes
      .map(
        (mt) => `
        <label class="ko-radio-row">
          <input type="radio" name="ko-meeting-type" value="${mt.id}">
          ${KylasOverlay.escapeHtml(mt.name)}
          <span class="ko-muted">${mt.durationMinutes}m</span>
        </label>`
      )
      .join("");

    panel.setBody(`
      ${notice}
      <div class="ko-step-title">1. Meeting type</div>
      ${options}
      <button class="ko-primary-btn" id="ko-continue-availability" disabled>Check availability</button>
      <button class="ko-secondary-btn" id="ko-back">Back</button>
    `);

    const continueBtn = panel.body.querySelector("#ko-continue-availability");
    panel.body.querySelectorAll('input[name="ko-meeting-type"]').forEach((input) => {
      input.addEventListener("change", () => {
        selectedMeetingType = input.value;
        continueBtn.disabled = false;
      });
    });
    continueBtn.addEventListener("click", () => loadAvailability(panel));
    panel.body.querySelector("#ko-back").addEventListener("click", () => renderIdle(panel));
  }

  async function loadAvailability(panel) {
    renderLoading(panel, "Checking calendars…");
    try {
      const response = await KylasOverlay.request("getAvailability", {
        meetingTypeId: selectedMeetingType,
        contactId: currentContactId,
      });
      if (!response || response.ok === false) {
        renderError(panel, response?.error || "Could not load availability.", () =>
          loadMeetingTypes(panel)
        );
        return;
      }
      renderSlots(panel, response);
    } catch (err) {
      renderError(panel, String(err), () => loadMeetingTypes(panel));
    }
  }

  function renderSlots(panel, response) {
    const notice = response.demo
      ? `<div class="ko-notice">${KylasOverlay.escapeHtml(response.notice)}</div>`
      : "";

    if (!response.slots?.length) {
      panel.setBody(
        notice +
          `<div class="ko-empty">No free slots found.</div>
           <button class="ko-secondary-btn" id="ko-back">Back</button>`
      );
      panel.body.querySelector("#ko-back").addEventListener("click", () => loadMeetingTypes(panel));
      return;
    }

    const options = response.slots
      .map((slot, i) => {
        const start = new Date(slot.startIso);
        const label = start.toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
        return `
          <button class="ko-slot-btn" data-index="${i}">
            ${KylasOverlay.escapeHtml(label)}
            <span class="ko-muted">${KylasOverlay.escapeHtml(slot.hostName)}</span>
          </button>`;
      })
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
        renderConfirm(panel);
      });
    });
    panel.body.querySelector("#ko-back").addEventListener("click", () => loadMeetingTypes(panel));
  }

  function renderConfirm(panel) {
    const start = new Date(selectedSlot.startIso).toLocaleString();
    panel.setBody(`
      <div class="ko-step-title">3. Confirm</div>
      <div class="ko-row"><div class="ko-row-label">When</div><div class="ko-row-value">${KylasOverlay.escapeHtml(
        start
      )}</div></div>
      <div class="ko-row"><div class="ko-row-label">Host</div><div class="ko-row-value">${KylasOverlay.escapeHtml(
        selectedSlot.hostName
      )}</div></div>
      <label class="ko-row-label">Notes (optional)</label>
      <textarea id="ko-confirm-notes" placeholder="Anything to capture before the call…"></textarea>
      <button class="ko-primary-btn" id="ko-confirm-book">Confirm booking</button>
      <button class="ko-secondary-btn" id="ko-back">Back</button>
      <div id="ko-confirm-status"></div>
    `);

    panel.body.querySelector("#ko-back").addEventListener("click", () =>
      loadAvailability(panel)
    );
    panel.body.querySelector("#ko-confirm-book").addEventListener("click", async (e) => {
      const btn = e.target;
      const status = panel.body.querySelector("#ko-confirm-status");
      const notes = panel.body.querySelector("#ko-confirm-notes").value.trim();
      btn.disabled = true;
      status.textContent = "Booking…";
      try {
        const response = await KylasOverlay.request("bookMeeting", {
          contactId: currentContactId,
          meetingTypeId: selectedMeetingType,
          slot: selectedSlot,
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
    panel.setBody(`
      ${notice}
      <div class="ko-success">Meeting booked. Deal created and contact moved to Discovery Call.</div>
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
    currentContactId = contactId;
    selectedMeetingType = null;
    selectedSlot = null;
    lastDealId = null;
    renderIdle(panel);
  });
})();
