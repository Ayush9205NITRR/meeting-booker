// ─────────────────────────────────────────────────────────────────────
//  THE BDR WORK QUEUE shown on https://app.kylas.io/sales/home
//
//  Each bucket is either a list of Pipeline Stage values, or a derived
//  rule that no single stage can express.
//
//  Stage names are matched loosely — lowercased, whitespace collapsed,
//  and en/em dashes folded to "-" — which is the same normalisation
//  kylas-airtable-sync's account_pipeline_order.json documents. So
//  "CNC (Could Not Connect) – 1" still matches "CNC (Could Not
//  Connect) - 1". Punctuation drift in Kylas won't silently empty a
//  bucket.
//
//  The names below are the real ones from that file's `order` list.
//  Click "Show stages found" in the panel to see the values actually
//  coming back, and correct anything that has been renamed in Kylas.
// ─────────────────────────────────────────────────────────────────────

window.KylasQueueConfig = {
  // Accounts, not loose contacts: a BD chases a company, not five people at
  // one. An account takes the BEST stage any of its contacts has reached,
  // which is the rule kylas-airtable-sync uses for Account Pipeline Stage
  // (BD) — using the same rule is what stops the overlay and the sync
  // disagreeing about where an account stands. Set to "contact" to go back
  // to listing individual contacts.
  groupBy: "account",

  // Rank order, best first. Copied from kylas-airtable-sync's
  // config/account_pipeline_order.json; keep the two in step.
  accountStageOrder: [
      "SQL (Sales Qualified Lead)",
      "Discovery Call Done - Awaiting Client Inputs",
      "Closing Loops - Low Value",
      "Reschedule Pending",
      "Discovery Call No-Show",
      "Discovery Call Booked",
      "Follow-up (1)",
      "Follow-up (2)",
      "Follow-up (3)",
      "Followup - CNC",
      "MQL (Marketing Qualified Lead)",
      "Activation",
      "Offsite Delayed",
      "Offsite Done (Late Reachout)",
      "Not Interested",
      "Connect Later",
      "CNC (Could Not Connect) - 3",
      "CNC (Could Not Connect) - 2",
      "CNC (Could Not Connect) - 1",
      "Disqualified - Wrong POC",
      "Invalid Contact",
      "Not a Decision Maker (NDM)",
      "POC - Organization - Changed",
      "LinkedIn Outreach Initiated"
  ],

  // Real spellings that exist in Kylas, so a rename there doesn't quietly
  // drop accounts to unranked.
  accountStageAliases: {
      "Offsite Done": "Offsite Done (Late Reachout)",
      "Offsite Dealyed": "Offsite Delayed",
      "POC - Organisation - Changed": "POC - Organization - Changed",
      "Yet to Be Mined": "LinkedIn Outreach Initiated"
  },

  buckets: [
    {
      id: "toExhaust",
      label: "To exhaust",
      hint: "Worth another attempt before they go cold",
      stages: [
        "CNC (Could Not Connect) - 1",
        "CNC (Could Not Connect) - 2",
        "Connect Later",
      ],
    },
    {
      id: "fresh",
      label: "Fresh",
      hint: "Never called",
      // Not a stage. kylas-airtable-sync defines Fresh as "no contact has
      // ever been called", so it is derived from the call history rather
      // than from Pipeline Stage.
      rule: "neverCalled",
    },
    {
      id: "mql",
      label: "MQL",
      hint: "Qualified, mid follow-up",
      stages: [
        "MQL (Marketing Qualified Lead)",
        "Follow-up (1)",
        "Follow-up (2)",
        "Follow-up (3)",
        "Followup - CNC",
      ],
    },
    {
      id: "activation",
      label: "Activation",
      stages: ["Activation"],
    },
    {
      id: "discovery",
      label: "Discovery call",
      stages: [
        "Discovery Call Booked",
        "Discovery Call Done - Awaiting Client Inputs",
        "Discovery Call No-Show",
      ],
    },
    {
      id: "today",
      label: "Connect today",
      hint: "Due today, or overdue",
      // Also derived: a date comparison, not a stage. "nextCallDue" is
      // today OR earlier — a call missed last week is the most urgent
      // thing here, and "today only" is how it disappears. Use
      // "nextCallToday" for a strict today-only bucket.
      rule: "nextCallDue",
      accent: true,
    },
  ],
};
