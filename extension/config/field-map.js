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
    // A value is a column name, a LIST of candidates (the first one present
    // on the record wins), or { field, type }. Lists exist because the same
    // fact is spelled differently depending on how the column was made; a
    // candidate that matches nothing is skipped, so extra ones are free.
    fields: {
      "Status of reachout": "Status of Reachout",
      "Source of data": "Source of Data",
      "Annual revenue": [
        "Annual Revenue",
        "Annual Revenue - Apollo",
        "Revenue",
        "Estimated Annual Revenue",
      ],
      Employees: [
        "# Employees",
        "Employees",
        "# Employees - Apollo",
        "Employee Count",
        "Headcount",
      ],
      "Funding stage": [
        "Funding stage",
        "Funding Stage",
        "Latest Funding Stage",
        "Funding Round",
      ],
      "Total funding": ["Total Funding", "Total Funding Amount", "Total Funding Raised"],
      "Latest funding amount": ["Latest Funding Amount", "Last Funding Amount"],
      "Latest funding type": ["Latest Funding Type", "Last Funding Type"],
      "Offsite timeline": [
        "Offsite Timeline",
        "Offsite Timeline (BD - New)",
        "Offsite Timeline (BD)",
      ],
      "Boolean post": {
        field: [
          "Boolean Post link - kylas",
          "Boolean Post Link - Kylas",
          "Boolean Post link",
          "Boolean Post Link",
        ],
        type: "link",
      },
      Website: { field: "Website", type: "link" },
      LinkedIn: { field: ["linkedin - Appollo", "LinkedIn - Apollo", "LinkedIn"], type: "link" },
    },

    notes: {},
  },
};
