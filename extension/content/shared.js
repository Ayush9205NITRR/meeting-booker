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

KylasOverlay.escapeHtml = function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
};

KylasOverlay.initials = function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

// Builds a floating panel in a shadow root so Kylas's page CSS can never
// bleed in (or be bled on). Header carries an avatar + name + subtitle,
// the way Lusha/Apollo overlays do.
KylasOverlay.createPanel = function createPanel({ id, title, side = "right" }) {
  const existing = document.getElementById(id);
  if (existing) existing.remove();

  // Docked to the edge as a full-height rail, the way Lusha/Apollo sit,
  // rather than floating over the middle of the record. pointer-events is
  // off on the host so the collapsed rail doesn't eat clicks on the strip
  // of page behind it; the panel and launcher turn it back on.
  const host = document.createElement("div");
  host.id = id;
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.top = "0";
  host.style[side] = "0";
  host.style.height = "100vh";
  host.style.zIndex = "2147483000";
  host.style.pointerEvents = "none";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const styleLink = document.createElement("link");
  styleLink.rel = "stylesheet";
  styleLink.href = chrome.runtime.getURL("styles/overlay.css");
  shadow.appendChild(styleLink);

  // Collapsing hides the whole rail and leaves a slim tab on the edge, so
  // the BD gets the full Kylas page back rather than a stub panel.
  const launcher = document.createElement("button");
  launcher.className = "ko-launcher";
  launcher.title = "Open " + title;
  launcher.textContent = "E";
  launcher.hidden = true;
  shadow.appendChild(launcher);

  const panel = document.createElement("div");
  panel.className = "ko-panel";
  panel.innerHTML = `
    <div class="ko-header">
      <div class="ko-avatar"></div>
      <div class="ko-head-text">
        <div class="ko-title"></div>
        <div class="ko-subtitle"></div>
      </div>
      <button class="ko-collapse" title="Hide">›</button>
    </div>
    <div class="ko-body"></div>
  `;
  shadow.appendChild(panel);

  const body = panel.querySelector(".ko-body");
  const avatarEl = panel.querySelector(".ko-avatar");
  const titleEl = panel.querySelector(".ko-title");
  const subtitleEl = panel.querySelector(".ko-subtitle");
  const collapseBtn = panel.querySelector(".ko-collapse");

  function setCollapsed(collapsed) {
    panel.hidden = collapsed;
    launcher.hidden = !collapsed;
    try {
      localStorage.setItem("koCollapsed", collapsed ? "1" : "0");
    } catch (e) {
      /* storage blocked — the panel just won't remember, which is fine */
    }
  }

  collapseBtn.addEventListener("click", () => setCollapsed(true));
  launcher.addEventListener("click", () => setCollapsed(false));

  // Starts as just the floating icon and opens on click, so the overlay
  // never covers Kylas until it's asked for. Whatever the BD chooses is
  // remembered across records — Kylas is a SPA they live in all day, and
  // a panel that reappears on every record is the fastest way to make an
  // overlay annoying.
  let startCollapsed = true;
  try {
    const saved = localStorage.getItem("koCollapsed");
    if (saved !== null) startCollapsed = saved === "1";
  } catch (e) {
    /* storage blocked — fall back to closed */
  }
  setCollapsed(startCollapsed);

  function setHeader({ name, subtitleHtml, avatar }) {
    titleEl.textContent = name || title;
    avatarEl.textContent = avatar || KylasOverlay.initials(name || title);
    subtitleEl.innerHTML = subtitleHtml || "";
  }

  setHeader({ name: title, subtitleHtml: "" });

  return {
    host,
    shadow,
    body,
    setHeader,
    setBody(html) {
      body.innerHTML = html;
    },
  };
};

// Renders a value as a link/email/phone/plain text per the field map type.
KylasOverlay.renderValue = function renderValue(value, type) {
  const raw = value == null ? "" : String(value).trim();
  if (!raw) return `<span class="ko-empty-value">—</span>`;
  const safe = KylasOverlay.escapeHtml(raw);

  if (type === "link") {
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return `<a href="${KylasOverlay.escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
  }
  if (type === "email") return `<a href="mailto:${safe}">${safe}</a>`;
  if (type === "phone") return `<a href="tel:${safe}">${safe}</a>`;
  return safe;
};

// Wires up every copy button rendered inside a panel body.
KylasOverlay.bindCopyButtons = function bindCopyButtons(body) {
  body.querySelectorAll(".ko-copy").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(btn.dataset.value || "");
        const original = btn.textContent;
        btn.textContent = "✓";
        setTimeout(() => (btn.textContent = original), 1200);
      } catch (err) {
        /* clipboard blocked — nothing useful to show the user */
      }
    });
  });
};
