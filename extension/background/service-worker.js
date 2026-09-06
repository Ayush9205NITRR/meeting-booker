// Background service worker: the only part of the extension that talks to
// the backend (POC Router Apps Script /exec endpoint). Content scripts never
// fetch directly — this keeps CORS/CSP handling in one place and means the
// backend URL only has to be configured once (popup -> chrome.storage.sync).
//
// API contract (see ../README.md "Backend API Contract" for full spec):
//   GET  {backendUrl}?action=companyOverlay&companyId=<id>      [pending Kylas.gs]
//   GET  {backendUrl}?action=nextSlots&duration=<mins>&count=<n> [confirmed, wraps findNextSlots()]
//   GET  {backendUrl}?action=board&localStart=<...>&duration=<mins> [confirmed, wraps getBoard()]
//   POST {backendUrl}  { action: "bookMeeting", you, primaryEmail, localStart,
//                         duration, title, company, callType, reviewers[],
//                         externals[], notes }                   [calendar part confirmed, deal creation pending]
//   POST {backendUrl}  { action: "addNotes", ... }               [pending Kylas.gs]
//
// `credentials: "include"` is required on every call: the Apps Script web
// app is deployed executeAs USER_ACCESSING / access DOMAIN, so it relies on
// the browser's existing Google session cookie for the signed-in BD.
//
// Every response is JSON: { ok: true, ...} or { ok: false, error: "..." }.

const MOCK_MODE_NOTICE =
  "No backend URL configured yet (set one in the extension popup). Showing demo data.";

async function getBackendUrl() {
  const { backendUrl } = await chrome.storage.sync.get("backendUrl");
  return backendUrl || null;
}

async function callBackend(params) {
  const backendUrl = await getBackendUrl();
  if (!backendUrl) return null;

  const url = new URL(backendUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url.toString(), { credentials: "include" });
  return res.json();
}

async function postBackend(payload) {
  const backendUrl = await getBackendUrl();
  if (!backendUrl) return null;

  // text/plain avoids a CORS preflight against Apps Script's /exec endpoint
  // (application/json triggers an OPTIONS request Apps Script can't answer).
  const res = await fetch(backendUrl, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function mockCompanyOverlay(companyId) {
  return {
    ok: true,
    demo: true,
    notice: MOCK_MODE_NOTICE,
    // Column names mirror the Company List table that kylas-airtable-sync
    // already writes, so the default field-map.js renders fully in demo mode.
    company: {
      id: companyId,
      fields: {
        "Kylas Company Id": companyId,
        "Company Name": "Acme Robotics (demo)",
        Industry: "Manufacturing",
        Website: "acme-robotics.example",
        Phone: "+91 98765 43210",
        Email: "hello@acme-robotics.example",
        City: "Pune",
        State: "Maharashtra",
        Country: "India",
        Description:
          "Interested in the enterprise tier. Champion is the ops lead; procurement runs through the CFO. Last touch was a cold call in March that went well — they asked for a demo but it never got scheduled.",
      },
    },
  };
}

// Mirrors Code.gs findNextSlots(): { localStart, label, free: [names] }
function mockNextSlots(duration) {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const slot = (offsetHours, free) => {
    const start = new Date(now + offsetHours * hour);
    return {
      localStart: start.toISOString().slice(0, 16),
      label:
        start.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) +
        " · " +
        start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
      free,
    };
  };
  return {
    ok: true,
    demo: true,
    notice: MOCK_MODE_NOTICE,
    slots: [
      slot(2, ["Hritik", "Aarushi"]),
      slot(4, ["Shreya", "Keshav"]),
      slot(24, ["Hritik"]),
    ],
  };
}

// Mirrors Code.gs getBoard(): players[], suggestedPrimary, why, reviewers[]
function mockBoard(localStart) {
  return {
    ok: true,
    demo: true,
    notice: MOCK_MODE_NOTICE,
    slot: { startIso: localStart, duration: 30 },
    players: [
      { name: "Hritik", email: "hrithik@enout.in", status: "FREE", line: "Nothing else booked", rank: 1 },
      { name: "Aarushi", email: "aarushi@enout.in", status: "FREE", line: "1 other meeting today", rank: 3 },
    ],
    reviewers: [
      { name: "Ayush", email: "ayush@enout.in", default: true },
      { name: "Akash", email: "akash@enout.in", default: true },
    ],
    suggestedPrimary: "hrithik@enout.in",
    why: "2 free. Hritik is highest on the list.",
  };
}

async function handleRequest(action, payload) {
  switch (action) {
    case "getCompanyOverlay": {
      const result = await callBackend({
        action: "companyOverlay",
        companyId: payload.companyId,
      });
      return result || mockCompanyOverlay(payload.companyId);
    }
    case "getNextSlots": {
      const result = await callBackend({
        action: "nextSlots",
        duration: payload.duration,
        count: payload.count || 5,
      });
      return result || mockNextSlots(payload.duration);
    }
    case "getBoard": {
      const result = await callBackend({
        action: "board",
        localStart: payload.localStart,
        duration: payload.duration,
      });
      return result || mockBoard(payload.localStart);
    }
    case "bookMeeting": {
      const result = await postBackend({ action: "bookMeeting", ...payload });
      if (result) return result;
      return {
        ok: true,
        demo: true,
        notice: MOCK_MODE_NOTICE + " No meeting was actually booked.",
        primary: "Hritik",
        when: payload.localStart,
        link: null,
        meet: null,
        dealId: "demo-deal",
      };
    }
    case "addNotes": {
      const result = await postBackend({ action: "addNotes", ...payload });
      if (result) return result;
      return {
        ok: true,
        demo: true,
        notice: MOCK_MODE_NOTICE + " Notes were not actually saved.",
      };
    }
    default:
      return { ok: false, error: `unknown action: ${action}` };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "KYLAS_OVERLAY_REQUEST") return false;
  handleRequest(message.action, message.payload || {})
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true; // keep the message channel open for the async response
});
