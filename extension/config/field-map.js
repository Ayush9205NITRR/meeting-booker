// ─────────────────────────────────────────────────────────────────────
//  WHAT THE OVERLAY SHOWS. Edit this file to change it.
//
//  Format is always:   "Label in the extension": "Exact Airtable column"
//
//  A value can also be an object to control how it renders:
//      "Website": { field: "Website", type: "link" }
//
//  types: "text" (default) | "link" | "email" | "phone"
//
//  Column names must match the `Company List` table exactly. A name
//  that doesn't exist is skipped silently rather than drawn as a dash,
//  so a typo costs you a missing row, not a broken panel. Click
//  "Show all fields" at the bottom of the overlay to see the real ones.
// ─────────────────────────────────────────────────────────────────────

window.KylasOverlayConfig = {
  company: {
    // `name` and `subtitle` take a list — the first column that actually
    // has a value wins. Rows created by different routes carry the name in
    // different columns, so a single hardcoded one is how a record with an
    // obvious name still renders as "Unknown company".
    header: {
      name: ["Company Name - Kylas", "Company Name", "Name", "Company Name - Kylas copy"],
      subtitle: ["Industry", "Industry (Kylas)"],
      subtitleType: "text",
    },

    // One pill: where the account actually stands.
    badges: ["Account Pipeline Stage"],

    // Number tiles.
    stats: {
      "Total POCs": "Total POCs",
      Connected: "Connected POCs",
      MQL: "MQL POCs",
    },

    // The main list, in this order.
    fields: {
      "Status of reachout": "Status of Reachout",
      "Source of data": "Source of Data",
      "Funding type": "Latest Funding Type",
      "Funding amount": "Latest Funding Amount",
      Website: { field: "Website", type: "link" },
      LinkedIn: { field: "linkedin - Appollo", type: "link" },
    },

    notes: {},
  },
};
