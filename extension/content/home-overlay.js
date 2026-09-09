// Runs on https://app.kylas.io/sales/home
//
// The BD's own work queue, bucketed. Every BD sees only their own
// contacts: the backend resolves who is signed in and filters by owner,
// so this is per-BDR without anyone choosing a filter.
//
// What the buckets are lives in config/overlay-config.json in the repo —
// edit that on GitHub and every BD follows within ten minutes.
// config/queue.js is only the fallback for when that file can't be read.

(function () {
  // Needs a capture group: watchRecordId reports match[1], so a pattern
  // without one never fires.
  const HOME_PATH = /\/sales\/(home)/;

  let queueCfg = window.KylasQueueConfig || {};
  let config = queueCfg.buckets || [];
  let byAccount = queueCfg.groupBy !== "contact";

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

  // ── account rollup ────────────────────────────────────────
  //
  // A BD works accounts, not loose contacts: five people at one company is
  // one thing to chase, not five. So contacts are grouped by company and
  // the account takes the BEST stage any of its contacts has reached —
  // the same rule kylas-airtable-sync applies for Account Pipeline Stage
  // (BD). Using the same rule is the point: the overlay and the sync must
  // never disagree about where an account stands.

  function stageRank(stage) {
    const order = (queueCfg.accountStageOrder || []).map(norm);
    const aliases = queueCfg.accountStageAliases || {};
    let name = String(stage || "");
    // Kylas carries real spelling variants; the sync keeps the same alias
    // list so a rename there doesn't silently drop accounts to unranked.
    Object.keys(aliases).forEach((from) => {
      if (norm(from) === norm(name)) name = aliases[from];
    });
    const i = order.indexOf(norm(name));
    return i === -1 ? Infinity : i;
  }

  function accounts() {
    const byCompany = new Map();
    (state.contacts || []).forEach((c) => {
      // Contacts with no company can't roll up into an account, so they
      // stand alone rather than being silently dropped.
      const key = (c.company || "").trim() || ("#contact-" + c.id);
      if (!byCompany.has(key)) {
        byCompany.set(key, { company: c.company || c.name, contacts: [] });
      }
      byCompany.get(key).contacts.push(c);
    });

    return [...byCompany.values()].map((a) => {
      let best = null;
      a.contacts.forEach((c) => {
        if (!c.stage) return;
        if (best === null || stageRank(c.stage) < stageRank(best)) best = c.stage;
      });
      return {
        id: a.company,
        name: a.company,
        company: a.company,
        stage: best || "",
        contacts: a.contacts,
        // An account is fresh only when NOBODY on it has been called, and
        // it needs connecting today if ANY contact is due today.
        lastCalledAt: a.contacts.map((c) => c.lastCalledAt).filter(Boolean).sort().pop() || "",
        nextCallDate: a.contacts.map((c) => c.nextCallDate).filter(Boolean).sort()[0] || "",
      };
    });
  }

  function inBucket(row, bucket) {
    if (bucket.rule === "neverCalled") return !row.lastCalledAt;
    if (bucket.rule === "nextCallToday") {
      return byAccount
        ? row.contacts.some((c) => c.nextCallDate === todayStr())
        : row.nextCallDate === todayStr();
    }
    const want = (bucket.stages || []).map(norm);
    return want.indexOf(norm(row.stage)) !== -1;
  }

  function rows() {
    return byAccount ? accounts() : state.contacts || [];
  }

  function bucketed() {
    const list = rows();
    return config.map((b) => ({ ...b, contacts: list.filter((r) => inBucket(r, b)) }));
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
    const total = rows().length;

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
        <div class="ko-hint">${total} ${byAccount ? "account" : "contact"}${total === 1 ? "" : "s"} owned by ${esc(
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

    // An account row can't link to one contact — there are several — so it
    // links to the first and says how many others are on it. That keeps
    // the click useful without pretending an account is a person.
    const row = (r) => {
      const first = byAccount ? r.contacts[0] : r;
      const others = byAccount ? r.contacts.length - 1 : 0;
      const sub = byAccount
        ? [r.stage, others > 0 ? others + " more contact" + (others === 1 ? "" : "s") : ""]
            .filter(Boolean)
            .join(" · ")
        : r.company || r.stage || "";
      const due = byAccount
        ? r.contacts.map((c) => c.nextCallDate).filter(Boolean).sort()[0]
        : r.nextCallDate;

      return `
        <a class="ko-p" href="/sales/contacts/details/${esc(first.id)}">
          <span class="ko-who">
            <span class="ko-n2">${esc(byAccount ? r.company || first.name : r.name)}</span>
            <span class="ko-l2">${esc(sub)}</span>
          </span>
          ${due ? `<span class="ko-tag">${esc(due)}</span>` : ""}
        </a>`;
    };

    return `
      <div class="ko-section-label">${esc(group.label)}</div>
      <div class="ko-list">
        ${group.contacts.slice(0, 100).map(row).join("")}
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
        // Buckets edited on GitHub arrive with the data. An empty list is
        // ignored rather than drawn, so a bad commit can't leave a BD
        // staring at a queue with no buckets in it.
        if (res.queueConfig) {
          queueCfg = res.queueConfig;
          byAccount = queueCfg.groupBy !== "contact";
        }
        const remote = res.queueConfig && res.queueConfig.buckets;
        if (Array.isArray(remote) && remote.length) config = remote;
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
