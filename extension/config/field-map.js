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
//  ── Keep this SHORT. ────────────────────────────────────────────────
//  The overlay is a glance, not a report. A good target is one badge,
//  two or three stat tiles and four to six rows. Anything a BD reads
//  once a quarter belongs in Airtable, not here.
//
//  ── Getting the column names right ──────────────────────────────────
//  A name that doesn't exist in the table is skipped silently rather
//  than drawn as a dash, so a wrong guess costs you a missing row, not
//  a broken panel. To see the truth, either:
//    * run `python scripts/inspect_schema.py` in kylas-airtable-sync
//      (prints every table and field name), or
//    * click "Show all fields" at the bottom of the overlay.
// ─────────────────────────────────────────────────────────────────────

window.KylasOverlayConfig = {
  company: {
    // Avatar initials come from `name`.
    // subtitleType defaults to "text"; use "link" only for a URL column.
    header: {
      name: "Company Name",
      subtitle: "Industry",
      subtitleType: "text",
    },

    // One pill. The single most useful status, not every status.
    badges: ["Highest Calling Stage"],

    // Money and size, up front.
    stats: {
      Revenue: "Company Revenue",
      "Rev / employee": "Revenue Per Employee",
      Employees: "Number of Employees",
    },

    // The short list. Order here is the order on screen.
    fields: {
      "Last interaction": "Last Call",
      Owner: "Owner",
      Website: { field: "Website", type: "link" },
      Location: "City",
    },

    // Long-form block at the bottom, clamped with a "Show more" toggle.
    notes: {},
  },
};
