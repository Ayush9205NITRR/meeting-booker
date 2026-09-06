// Background service worker: the only part of the extension that talks to
// the backend (POC Router Apps Script /exec endpoint). Content scripts never
// fetch directly — this keeps CORS/CSP handling in one place and means the
// backend URL only has to be configured once (popup -> chrome.storage.sync).
//
// API contract (see ../README.md "Backend API Contract" for full spec):
//   GET  {backendUrl}?action=companyOverlay&companyId=<id>
//   GET  {backendUrl}?action=meetingTypes
//   GET  {backendUrl}?action=availability&meetingTypeId=<id>&contactId=<id>
//   POST {backendUrl}  { action: "bookMeeting", ... }
//   POST {backendUrl}  { action: "addNotes", ... }
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
  const res = await fetch(url.toString());
  return res.json();
}

async function postBackend(payload) {
  const backendUrl = await getBackendUrl();
  if (!backendUrl) return null;

  // text/plain avoids a CORS preflight against Apps Script's /exec endpoint
  // (application/json triggers an OPTIONS request Apps Script can't answer).
  const res = await fetch(backendUrl, {
    method: "POST",
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
    company: {
      id: companyId,
      fields: {
        "Company Name": "Acme Robotics (demo)",
        Industry: "Manufacturing",
        Website: "acme-robotics.example",
        "Account Stage": "Discovery",
        "Curated Notes": "Interested in the enterprise tier. Champion is the ops lead.",
        Tags: "warm, enterprise",
      },
    },
  };
}

function mockMeetingTypes() {
  return {
    ok: true,
    demo: true,
    notice: MOCK_MODE_NOTICE,
    meetingTypes: [
      { id: "discovery", name: "Discovery Call", durationMinutes: 30 },
      { id: "demo", name: "Product Demo", durationMinutes: 45 },
      { id: "technical", name: "Technical Deep Dive", durationMinutes: 60 },
    ],
  };
}

function mockAvailability() {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const slot = (offsetHours, hostName, hostUserId) => {
    const start = new Date(now + offsetHours * hour);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    return {
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      hostUserId,
      hostName,
    };
  };
  return {
    ok: true,
    demo: true,
    notice: MOCK_MODE_NOTICE,
    slots: [
      slot(2, "Kiran N", "user-2"),
      slot(4, "Vishnu Sarma", "user-17"),
      slot(24, "Kiran N", "user-2"),
    ],
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
    case "getMeetingTypes": {
      const result = await callBackend({ action: "meetingTypes" });
      return result || mockMeetingTypes();
    }
    case "getAvailability": {
      const result = await callBackend({
        action: "availability",
        meetingTypeId: payload.meetingTypeId,
        contactId: payload.contactId,
      });
      return result || mockAvailability();
    }
    case "bookMeeting": {
      const result = await postBackend({ action: "bookMeeting", ...payload });
      if (result) return result;
      return {
        ok: true,
        demo: true,
        notice: MOCK_MODE_NOTICE + " No meeting was actually booked.",
        meetingId: "demo-meeting",
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
