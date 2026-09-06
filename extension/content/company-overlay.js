// Runs on https://app.kylas.io/sales/companies/details/<id>
// Shows the curated Airtable "Company List" record for this Kylas company,
// keyed by Kylas Company Id.

(function () {
  const COMPANY_PATH = /\/sales\/companies\/details\/(\d+)/;

  function renderLoading(panel) {
    panel.setBody(`<div class="ko-loading">Loading curated data…</div>`);
  }

  function renderError(panel, message) {
    panel.setBody(`<div class="ko-error">${KylasOverlay.escapeHtml(message)}</div>`);
  }

  function renderCompany(panel, response) {
    const fields = response.company?.fields || {};
    const entries = Object.entries(fields);

    const notice = response.demo
      ? `<div class="ko-notice">${KylasOverlay.escapeHtml(response.notice)}</div>`
      : "";

    if (!entries.length) {
      panel.setBody(
        notice +
          `<div class="ko-empty">No curated Airtable record found for this company yet.</div>`
      );
      return;
    }

    const rows = entries
      .map(
        ([key, value]) => `
        <div class="ko-row">
          <div class="ko-row-label">${KylasOverlay.escapeHtml(key)}</div>
          <div class="ko-row-value">${KylasOverlay.escapeHtml(value)}</div>
        </div>`
      )
      .join("");

    panel.setBody(notice + `<div class="ko-fields">${rows}</div>`);
  }

  async function loadCompany(companyId, panel) {
    renderLoading(panel);
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
    title: "Curated Account Data",
    side: "right",
  });

  KylasOverlay.watchRecordId(COMPANY_PATH, (companyId) => loadCompany(companyId, panel));
})();
