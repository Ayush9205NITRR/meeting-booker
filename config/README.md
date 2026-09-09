# `overlay-config.json` — the control panel

This is the file you edit to change what the overlay shows. **No developer,
no reinstall, no deploy.**

## How to change something

1. Open [`overlay-config.json`](overlay-config.json) on github.com.
2. Click the pencil icon.
3. Make the change.
4. **Commit changes**.

Every BD's overlay picks it up within ten minutes. They don't have to do
anything — not even reload Kylas twice.

GitHub checks the file the moment you commit. A green tick means it's live;
a red cross means the commit had a mistake in it and everyone is still on
the previous version, which is the safe outcome. Click the cross to see what
it says — it names the exact line.

## The two halves

### `company` — the panel on a company record

```json
"fields": {
  "Funding amount": "Latest Funding Amount",
  "Website": { "field": "Website", "type": "link" }
}
```

Left of the colon is **what the BD sees**. Right of it is the **exact column
name in the `Company List` Airtable table**. To add a row, add a line. To
remove one, delete the line. To reorder, move the line.

`{ "field": ..., "type": ... }` controls how a value is drawn — `text`
(the default), `link`, `email`, or `phone`.

| Section | What it is |
|---|---|
| `header.name` | The big name at the top. A **list** — the first column with a value wins, which is why a record created by a different route still shows a name instead of "Unknown company". |
| `header.subtitle` | The grey line under it. Also a list. |
| `badges` | Coloured pills. One is usually right. |
| `stats` | Number tiles. Two or three. |
| `fields` | The labelled list. Four to six. |
| `notes` | Long text at the bottom, clamped with "Show more". |

**A column name that doesn't exist is skipped**, not drawn as an empty dash
— so a typo costs you a missing row rather than a broken panel. To see the
real column names, click **Show all fields** at the bottom of the overlay.

Keep it short. The overlay is a glance, not a report: everything you add
competes with what's already there.

### `queue` — the buckets on `/sales/home`

```json
{ "id": "mql", "label": "MQL", "stages": ["MQL (Marketing Qualified Lead)", "Follow-up (1)"] }
```

`stages` lists the Kylas Pipeline Stage values that land in the bucket.
Matching ignores case, spacing and dash style, so `CNC (Could Not Connect) – 1`
and `CNC (Could Not Connect) - 1` both count — a cosmetic rename in Kylas
won't quietly empty a bucket.

Two buckets aren't stages at all, and use a `rule` instead:

| Rule | Means |
|---|---|
| `neverCalled` | **Fresh** — nobody has ever called this contact. Same definition kylas-airtable-sync uses. |
| `nextCallToday` | **Connect today** — next call date is today. |

Those two are the only rules that exist. Anything else is rejected by the
check, because a rule the extension doesn't implement would show as a bucket
that never fills.

Click **Show stages found** in the panel to see the stage values actually
coming back from Kylas, with anything no bucket claims flagged.

## If something goes wrong

Nothing here can take the overlay down. In order:

1. GitHub unreachable, or the file has a mistake → the last good copy the
   BD's browser already has.
2. No copy yet either → the defaults bundled in `extension/config/`.

So the worst case is that a change doesn't appear, never that the panel
breaks.
