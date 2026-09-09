// Runs on https://app.kylas.io/sales/home
//
// The BD's own work queue, bucketed. Every BD sees only their own
// contacts: the backend resolves who is signed in and filters by owner,
// so this is per-BDR without anyone choosing a filter.
//
// What the buckets are lives in config/queue.js — edit that, not this.

(function () {
  // Needs a capture group: watchRecordId reports match[1], so a pattern
  // without one never fires.
  const HOME_PATH = /\/sales\/(home)/;

  const config = (window.KylasQueueConfig && window.KylasQueueConfig.buckets) || [];

  let panel = null;
  let state = { loading: true, error: "", contacts: null, owner: null, open: null, showStages: false };

  const esc = (s) => KylasOverlay.escapeHtml(s);

  // Kylas stage names drift in punctuation — en dashes, double spaces,
  // "Organisation" vs "Organization". Normalise both sides before
  // comparing, the same way account_pipeline_order.json says to, so a
  // cosmetic rename doesn't quietly empty a bucket.
  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[‐-―]/g, "-")
      .replace(/\s*-\s*/g, "-")
      .replace(/\s+/g, " ")
      .replace(/organisation/g, "organization")
      .trim();
  }

  function todayStr() {
    const d = new Date();
    const p = (n) => (n < 10 ? "0" + n : "" + n);
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function inBucket(contact, bucket) {
    if (bucket.rule === "neverCalled") return !contact.lastCalledAt;
    if (bucket.rule === "nextCallToday") return contact.nextCallDate === todayStr();
    const want = (bucket.stages || []).map(norm);
    return want.indexOf(norm(contact.stage)) !== -1;
  }

  function bucketed() {
    const list = state.contacts || [];
    return config.map((b) => ({ ...b, contacts: list.filter((c) => inBucket(c, b)) }));
  }

  function render() {
    if (state.loading) {
      panel.setBody(
        `<div class="ko-skel"></div><div class="ko-skel"></div><div class="ko-skel"></div>`
      );
      return;
    }
    if (state.error) {
      panel.setBody(`<div class="ko-error">${esc(state.error)}</div>`);
      return;
    }

    const groups = bucketed();
    const total = (state.contacts || []).length;

    panel.setBody(`
      <div class="ko-queue">
        ${groups
          .map(
            (g) => `
          <button class="ko-bucket${g.accent ? " accent" : ""}${
              state.open === g.id ? " open" : ""
            }" data-id="${g.id}">
            <span class="ko-bucket-n">${g.contacts.length}</span>
            <span class="ko-bucket-t">
              <span class="ko-bucket-l">${esc(g.label)}</span>
              ${g.hint ? `<span class="ko-bucket-h">${esc(g.hint)}</span>` : ""}
            </span>
          </button>`
          )
          .join("")}
      </div>

      ${listHtml(groups.find((g) => g.id === state.open))}

      <div class="ko-footer">
        <div class="ko-hint">${total} contact${total === 1 ? "" : "s"} owned by ${esc(
      (state.owner && (state.owner.name || state.owner.email)) || "you"
    )}</div>
        <button class="ko-ghost-btn" id="ko-stages">${
          state.showStages ? "Hide stages found" : "Show stages found"
        }</button>
        ${state.showStages ? stagesHtml() : ""}
      </div>
    `);

    panel.body.querySelectorAll(".ko-bucket").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        state.open = state.open === id ? null : id;
        render();
      });
    });
    panel.body.querySelector("#ko-stages").addEventListener("click", () => {
      state.showStages = !state.showStages;
      render();
    });
  }

  function listHtml(group) {
    if (!group) return "";
    if (!group.contacts.length) {
      return `<div class="ko-empty">Nothing in ${esc(group.label)} right now.</div>`;
    }
    return `
      <div class="ko-section-label">${esc(group.label)}</div>
      <div class="ko-list">
        ${group.contacts
          .slice(0, 100)
          .map(
            (c) => `
          <a class="ko-p" href="/sales/contacts/details/${esc(c.id)}">
            <span class="ko-who">
              <span class="ko-n2">${esc(c.name)}</span>
              <span class="ko-l2">${esc(c.company || c.stage || "")}</span>
            </span>
            ${
              c.nextCallDate
                ? `<span class="ko-tag">${esc(c.nextCallDate)}</span>`
                : ""
            }
          </a>`
          )
          .join("")}
      </div>`;
  }

  // Every distinct stage value actually coming back, with how many
  // contacts carry it and whether any bucket claims it. This is how a
  // renamed stage in Kylas gets spotted instead of silently vanishing.
  function stagesHtml() {
    const counts = {};
    (state.contacts || []).forEach((c) => {
      const key = c.stage || "(no stage)";
      counts[key] = (counts[key] || 0) + 1;
    });

    const claimed = {};
    config.forEach((b) => (b.stages || []).forEach((s) => (claimed[norm(s)] = true)));

    const rows = Object.keys(counts)
      .sort((a, b) => counts[b] - counts[a])
      .map(
        (name) => `
        <div class="ko-raw-row">
          <div class="ko-raw-key">${esc(name)}</div>
          <div class="ko-raw-val">${counts[name]}${
          claimed[norm(name)] ? "" : " · not in any bucket"
        }</div>
        </div>`
      )
      .join("");

    return `<div class="ko-raw">${rows || '<div class="ko-raw-row">No contacts.</div>'}</div>`;
  }

  async function load() {
    state.loading = true;
    render();
    try {
      const { bookerEmail } = await chrome.storage.sync.get("bookerEmail");
      const res = await KylasOverlay.request("getMyContacts", { ownerEmail: bookerEmail || "" });
      if (!res || res.ok === false) {
        state.error =
          (res && res.error) ||
          "Could not load your contacts. Set the POC Router URL in the extension popup.";
      } else {
        state.contacts = res.contacts || [];
        state.owner = res.owner || null;
        state.error = "";
      }
    } catch (err) {
      state.error = String(err);
    } finally {
      state.loading = false;
      render();
    }
  }

  panel = KylasOverlay.createPanel({
    id: "kylas-overlay-home-panel",
    title: "My queue",
    side: "right",
  });
  panel.setVisible(false);

  KylasOverlay.watchRecordId(
    HOME_PATH,
    () => {
      panel.setVisible(true);
      panel.setHeader({ name: "My queue", avatar: "◎", subtitleHtml: "Your contacts by stage" });
      if (!state.contacts) load();
      else render();
    },
    () => panel.setVisible(false)
  );
})();
