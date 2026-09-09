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
      hint: "Next call date is today",
      // Also derived: a date comparison, not a stage.
      rule: "nextCallToday",
      accent: true,
    },
  ],
};
