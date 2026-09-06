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
//  Don't know your exact Airtable column names? Open any company in
//  Kylas and click "Show all fields" at the bottom of the overlay —
//  it lists every column coming back, with its value. Copy the names
//  from there into this file.
// ─────────────────────────────────────────────────────────────────────

window.KylasOverlayConfig = {
  company: {
    // Drives the panel header (avatar initials come from `name`).
    header: {
      name: "Company Name",
      subtitle: "Website",
    },

    // Rendered as pills under the header. Values that are empty are skipped.
    badges: ["Industry"],

    // The main body. Order here is the order on screen.
    fields: {
      Website: { field: "Website", type: "link" },
      Phone: { field: "Phone", type: "phone" },
      Email: { field: "Email", type: "email" },
      City: "City",
      State: "State",
      Country: "Country",
    },

    // Long-form block at the bottom, clamped with a "Show more" toggle.
    notes: {
      About: "Description",
    },
  },
};
