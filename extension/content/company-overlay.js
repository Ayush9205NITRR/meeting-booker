// Runs on https://app.kylas.io/sales/companies/details/<id>
// Shows the curated Airtable "Company List" record for this Kylas company,
// keyed by Kylas Company Id. What gets shown is entirely driven by
// config/field-map.js — edit that file, not this one.

(function () {
  const COMPANY_PATH = /\/sales\/companies\/details\/(\d+)/;
  const config = (window.KylasOverlayConfig && window.KylasOverlayConfig.company) || {};

  let currentFields = {};

  // A field-map entry is either "Column Name" or { field, type }.
  function resolve(entry) {
    if (typeof entry === "string") return { field: entry, type: "text" };
    return { field: entry.field, type: entry.type || "text" };
  }

  function renderSkeleton(panel) {
    panel.setBody(`
      <div class="ko-skeleton-row"></div>
      <div class="ko-skeleton-row ko-short"></div>
      <div class="ko-skeleton-row"></div>
      <div class="ko-skeleton-row ko-short"></div>
    `);
  }

  function renderError(panel, message) {
    panel.setBody(`<div class="ko-error">${KylasOverlay.escapeHtml(message)}</div>`);
  }

  function badgesHtml(fields) {
    const badges = (config.badges || [])
      .map((column) => fields[column])
      .filter((v) => v != null && String(v).trim())
      .map((v) => `<span class="ko-badge">${KylasOverlay.escapeHtml(v)}</span>`)
      .join("");
    return badges ? `<div class="ko-badges">${badges}</div>` : "";
  }

  // Compact number tiles — POC counts and other at-a-glance figures.
  // A zero is meaningful here ("nobody worked this account"), so unlike
  // badges these render even when the value is 0.
  function statsHtml(fields) {
    const tiles = Object.entries(config.stats || {})
      .map(([label, entry]) => {
        const { field } = resolve(entry);
        const raw = fields[field];
        if (raw == null || String(raw).trim() === "") return "";
        return `
          <div class="ko-stat">
            <div class="ko-stat-value">${KylasOverlay.escapeHtml(raw)}</div>
            <div class="ko-stat-label">${KylasOverlay.escapeHtml(label)}</div>
          </div>`;
      })
      .filter(Boolean)
      .join("");
    return tiles ? `<div class="ko-stats">${tiles}</div>` : "";
  }

  function fieldsHtml(fields) {
    const rows = Object.entries(config.fields || {})
      .map(([label, entry]) => {
        const { field, type } = resolve(entry);
        const value = fields[field];
        const hasValue = value != null && String(value).trim();
        const copy = hasValue
          ? `<button class="ko-copy" data-value="${KylasOverlay.escapeHtml(value)}" title="Copy">⧉</button>`
          : "";
        return `
          <div class="ko-row">
            <div class="ko-row-label">${KylasOverlay.escapeHtml(label)}</div>
            <div class="ko-row-value">${KylasOverlay.renderValue(value, type)}</div>
            ${copy}
          </div>`;
      })
      .join("");
    return rows;
  }

  function notesHtml(fields) {
    return Object.entries(config.notes || {})
      .map(([label, entry]) => {
        const { field } = resolve(entry);
        const value = fields[field];
        if (!value || !String(value).trim()) return "";
        return `
          <div class="ko-note">
            <div class="ko-section-label">${KylasOverlay.escapeHtml(label)}</div>
            <div class="ko-note-body">
              <div class="ko-note-text ko-clamped">${KylasOverlay.escapeHtml(value)}</div>
            </div>
            <button class="ko-more">Show more</button>
          </div>`;
      })
      .join("");
  }

  function rawHtml(fields) {
    const rows = Object.entries(fields)
      .map(
        ([key, value]) => `
        <div class="ko-raw-row">
          <div class="ko-raw-key">${KylasOverlay.escapeHtml(key)}</div>
          <div class="ko-raw-val">${KylasOverlay.escapeHtml(value)}</div>
        </div>`
      )
      .join("");
    return `<div class="ko-raw" id="ko-raw" hidden>${
      rows || '<div class="ko-raw-row">No fields returned.</div>'
    }</div>`;
  }

  function renderCompany(panel, response) {
    const fields = response.company?.fields || {};
    currentFields = fields;

    const headerConfig = config.header || {};
    const name = fields[headerConfig.name] || "Unknown company";
    const subtitleValue = fields[headerConfig.subtitle];
    panel.setHeader({
      name,
      subtitleHtml: subtitleValue
        ? KylasOverlay.renderValue(subtitleValue, headerConfig.subtitleType || "text")
        : `<span class="ko-empty-value">No ${KylasOverlay.escapeHtml(
            headerConfig.subtitle || "subtitle"
          )}</span>`,
    });

    const notice = response.demo
      ? `<div class="ko-notice">${KylasOverlay.escapeHtml(response.notice)}</div>`
      : "";

    if (!Object.keys(fields).length) {
      panel.setBody(
        notice + `<div class="ko-empty">No curated Airtable record found for this company yet.</div>`
      );
      return;
    }

    panel.setBody(`
      ${notice}
      ${badgesHtml(fields)}
      ${statsHtml(fields)}
      ${fieldsHtml(fields)}
      ${notesHtml(fields)}
      <div class="ko-footer">
        <button class="ko-ghost-btn" id="ko-toggle-raw">Show all fields</button>
        ${rawHtml(fields)}
      </div>
    `);

    KylasOverlay.bindCopyButtons(panel.body);

    panel.body.querySelectorAll(".ko-more").forEach((btn) => {
      btn.addEventListener("click", () => {
        const text = btn.previousElementSibling.querySelector(".ko-note-text");
        const clamped = text.classList.toggle("ko-clamped");
        btn.textContent = clamped ? "Show more" : "Show less";
      });
    });

    const rawEl = panel.body.querySelector("#ko-raw");
    const rawBtn = panel.body.querySelector("#ko-toggle-raw");
    rawBtn.addEventListener("click", () => {
      rawEl.hidden = !rawEl.hidden;
      rawBtn.textContent = rawEl.hidden ? "Show all fields" : "Hide all fields";
    });
  }

  async function loadCompany(companyId, panel) {
    panel.setHeader({ name: "Loading…", subtitleHtml: "" });
    renderSkeleton(panel);
    try {
      const response = await KylasOverlay.request("getCompanyOverlay", { companyId });
      if (!response || response.ok === false) {
        renderError(panel, response?.error || "Failed to load company data.");
        return;
      }
      renderCompany(panel, response);
    } catch (err) {
      renderError(panel, String(err));
    }
  }

  const panel = KylasOverlay.createPanel({
    id: "kylas-overlay-company-panel",
    title: "Account",
    side: "right",
  });

  KylasOverlay.watchRecordId(COMPANY_PATH, (companyId) => loadCompany(companyId, panel));
})();
