// ─────────────────────────────────────────────────────────────────────
//  THE ONLY FILE YOU NEED TO EDIT TO CHANGE WHAT THE OVERLAY SHOWS.
//
//  Format is always:   "Label in the extension": "Exact Airtable column"
//
//  A value can also be an object to control how it renders:
//      "Website": { field: "Website", type: "link" }
//
//  types: "text" (default) | "link" | "email" | "phone"
//
//  The column names below are NOT guesses — they're lifted from
//  kylas-airtable-sync's config/field_map.json ("company" map), which
//  is what already writes the `Company List` table twice a day. If a
//  column is renamed there, rename it here too.
//
//  Don't recognise a column? Open any company in Kylas and click
//  "Show all fields" at the bottom of the overlay — it lists every
//  column coming back, with its value.
// ─────────────────────────────────────────────────────────────────────

window.KylasOverlayConfig = {
  company: {
    // Drives the panel header (avatar initials come from `name`).
    // subtitleType defaults to "text"; use "link" only for a URL column.
    header: {
      name: "Company Name - Kylas",
      subtitle: "Industry (Kylas)",
      subtitleType: "text",
    },

    // Pills under the header — the account's state at a glance.
    // Empty values are skipped automatically.
    badges: ["Account Status", "Account Pipeline Stage", "Pipeline Stage BD"],

    // Compact number tiles. This is the "how much have we worked this
    // account" row that Lusha can't show you.
    stats: {
      POCs: "Total POCs",
      Active: "Active POCs",
      Hot: "Hot POCs",
      Connected: "Connected POCs",
      MQL: "MQL POCs",
      NOI: "NOI Count",
    },

    // The main body. Order here is the order on screen.
    fields: {
      Owner: "Owner - Kylas",
      "Owner email": { field: "Owner Email", type: "email" },
      "Status of reachout": "Status of Reachout",
      "Last called": "Last Called At (Contacts)",
      "Health baseline": "Health Baseline",
      "Status since": "Status Since",
      "Claimed by": "Claimed By",
      Batch: "Batch",
      "Source of data": "Source of Data",
    },

    // Long-form block at the bottom, clamped with a "Show more" toggle.
    // The Company List table has no free-text column today — add one
    // here the moment it does.
    notes: {},
  },
};
