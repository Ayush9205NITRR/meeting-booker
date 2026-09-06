// Shared helpers loaded before company-overlay.js / contact-overlay.js.
// Kylas is a single-page app, so a content script only runs once per full
// page load — navigating from one company/contact to another re-uses the
// same document. watchRecordId() polls the URL so overlays refresh instead
// of going stale.

window.KylasOverlay = window.KylasOverlay || {};

KylasOverlay.extractId = function extractId(pattern) {
  const match = location.pathname.match(pattern);
  return match ? match[1] : null;
};

KylasOverlay.watchRecordId = function watchRecordId(pattern, onChange) {
  let lastId = KylasOverlay.extractId(pattern);
  if (lastId) onChange(lastId);
  setInterval(() => {
    const currentId = KylasOverlay.extractId(pattern);
    if (currentId && currentId !== lastId) {
      lastId = currentId;
      onChange(currentId);
    }
  }, 800);
};

KylasOverlay.request = function request(action, payload) {
  return chrome.runtime.sendMessage({
    type: "KYLAS_OVERLAY_REQUEST",
    action,
    payload,
  });
};

// Builds a collapsible floating panel in a shadow root so Kylas's page CSS
// can never bleed in (or be bled on). Returns handles to update its content.
KylasOverlay.createPanel = function createPanel({ id, title, side = "right" }) {
  const existing = document.getElementById(id);
  if (existing) existing.remove();

  const host = document.createElement("div");
  host.id = id;
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.top = "96px";
  host.style[side] = "16px";
  host.style.zIndex = "2147483000";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const styleLink = document.createElement("link");
  styleLink.rel = "stylesheet";
  styleLink.href = chrome.runtime.getURL("styles/overlay.css");
  shadow.appendChild(styleLink);

  const panel = document.createElement("div");
  panel.className = "ko-panel";
  panel.innerHTML = `
    <div class="ko-header">
      <span class="ko-title">${title}</span>
      <button class="ko-collapse" title="Collapse/expand">–</button>
    </div>
    <div class="ko-body"></div>
  `;
  shadow.appendChild(panel);

  const body = panel.querySelector(".ko-body");
  const collapseBtn = panel.querySelector(".ko-collapse");
  collapseBtn.addEventListener("click", () => {
    const collapsed = panel.classList.toggle("ko-collapsed");
    collapseBtn.textContent = collapsed ? "+" : "–";
  });

  return {
    host,
    shadow,
    setBody(html) {
      body.innerHTML = html;
    },
    body,
  };
};

KylasOverlay.escapeHtml = function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
};
