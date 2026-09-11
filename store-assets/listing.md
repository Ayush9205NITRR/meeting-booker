# Chrome Web Store listing — copy/paste

Publisher: ayush@enout.in  ·  Upload: kylas-overlay-webstore-0.11.0.zip

---------------------------------------------------------------------------
## Store listing tab

**Name**
Kylas Overlay — Sales Intelligence

**Summary** (132 char limit)
Shows your Airtable account data inside Kylas, and books meetings from the
contact page without leaving the CRM.

**Description**
Kylas Overlay is an internal tool for our BD team. It brings the account
information we keep in Airtable — and the meeting-booking flow we run on
Google Calendar — directly into the Kylas CRM pages the team already works
in, so nobody has to switch tabs to answer a basic question.

On the Kylas home page it shows your own accounts grouped by pipeline
stage, including which ones are due a call today or are overdue.

On a company record it shows the curated information for that account:
revenue, headcount, funding, POC counts, reachout status and the links the
team keeps in Airtable.

On a contact record it books a meeting — checks who is free, blocks the
slot, invites the client contacts, and creates the matching deal in Kylas,
in one step.

The extension is published privately and is only installable by members of
our Google Workspace domain. It has no analytics and no server of its own.

**Category**  Workflow & Planning
**Language**  English (United Kingdom)

---------------------------------------------------------------------------
## Privacy tab

**Single purpose**
Display our company's own CRM account data from Airtable inside Kylas CRM
pages, and create meetings from those pages.

**Permission justifications**

storage
  Stores the user's own work email address and the configuration supplied
  by our administrator (which Airtable base to read, and the address of our
  internal booking service). Nothing else is stored and nothing leaves the
  device except the requests described below.

Host permission — app.kylas.io
  This is our CRM and the only place the extension has a user interface.
  The panel is injected into these pages, and the record id in the URL is
  what tells the extension which account to display.

Host permission — api.airtable.com
  Reads our own Airtable base, with a read-only token, to display the
  account information shown in the panel.

Host permission — script.google.com and script.googleusercontent.com
  Calls our own Google Apps Script web app, which checks calendar
  availability and creates the meetings a user books. googleusercontent.com
  is the host Apps Script redirects to when serving a response, so both are
  required for a single call to complete.

Host permission — raw.githubusercontent.com
  Fetches one JSON configuration file that decides which fields the panel
  displays, so the layout can be changed without shipping a new version.
  This is data only. No code is downloaded and none is executed.

**Remote code**  No, I am not using remote code.
  (The only remote fetch is the JSON configuration file above. It is parsed
  as data and never evaluated.)

**Data usage — tick only:**
  Personally identifiable information → NO
  Health / financial / authentication / personal communications / location
  / web history / user activity → NO
  Website content → NO
  We collect none of it. Nothing is transmitted to the developer.

  Then tick all three certifications:
   - not being sold to third parties
   - not being used or transferred for purposes unrelated to the single purpose
   - not being used or transferred to determine creditworthiness

**Privacy policy URL**
https://ayush9205nitrr.github.io/meeting-booker/privacy.html

---------------------------------------------------------------------------
## Distribution tab

**Visibility**  Private
**Publish to**  your Google Workspace domain  (NOT "Public", NOT "Unlisted")
**Regions**     all

---------------------------------------------------------------------------
## After it is approved

1. Copy the new extension ID the Store assigns — it will NOT be
   lafgfglnldeikkcaipdcgaclplijakfk. That id belonged to our self-signed
   build and is now dead.
2. Admin console → Devices → Chrome → Apps & extensions → Users & browsers,
   on BOTH the Enout and TRAVART org units:
     - delete the old entry (the custom-URL one)
     - add by ID with the new id, source: from the Chrome Web Store
     - Installation policy: Force install + pin to browser toolbar
     - Policy for extensions: paste the same JSON, unchanged
3. Anyone who installed the pilot zip must remove it from
   chrome://extensions, or they will run two copies at once.
