#!/usr/bin/env node
/**
 * Pre-merge checks. Runs in CI and locally via `npm run check`.
 *
 * Mirrors the rules POC Router's own tools/check.js enforces, because
 * the .gs files here are deployed into that same Apps Script project
 * and would fail its build otherwise. Each rule exists for a bug that
 * already shipped:
 *   - a partial PUT to Kylas          (resets record owners)
 *   - a stage write instead of activate (does not move the deal)
 *   - a deal created without ownedBy  (lands on the API key account)
 *   - JS or .gs that doesn't parse    (breaks the panel silently)
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failed = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { console.log('  FAIL  ' + m); failed++; };
const warn = (m) => console.log('  warn  ' + m);

// ---------- Apps Script ----------
console.log('\nApps Script (poc-router/)');
const overlay = read('poc-router/Overlay.gs');
const kylas = read('poc-router/Kylas.gs');

for (const [name, src] of [['Overlay.gs', overlay], ['Kylas.gs', kylas]]) {
  try { new Function(src); ok(name + ' parses'); }
  catch (e) { bad(name + ' parse error: ' + e.message); }
}

// Both land in one Apps Script project, so a shared top-level name is a
// duplicate declaration at runtime even though each file parses alone.
try { new Function(overlay + '\n' + kylas); ok('Overlay.gs + Kylas.gs share no top-level names'); }
catch (e) { bad('together they do not parse: ' + e.message); }

const puts = [...kylas.matchAll(/kylasFetch_\(\s*'PUT'\s*,\s*([^,]+),/g)].map((m) => m[1].trim());
if (!puts.length) {
  bad('no PUT found — kylasUpdateContact_ should be the one sanctioned write path');
} else {
  const safe = /function kylasUpdateContact_[\s\S]*?kylasFetch_\('PUT'/.test(kylas);
  if (puts.length === 1 && safe) ok('the single PUT is inside kylasUpdateContact_ (read-modify-write)');
  else bad('PUT outside kylasUpdateContact_ — partial PUTs reset record owners: ' + puts.join(', '));
}

if (/pipeline-stages\/'\s*\+.*\+\s*'\/activate/.test(kylas)) ok('stage changes use the activate endpoint');
else bad('stage change is not using .../pipeline-stages/{id}/activate');

if (/ownedBy:\s*\{\s*id:/.test(kylas)) ok('deal owner set at creation');
else bad('deal is created without ownedBy — owner falls back to the API key account');

if (/pipelineId:\s*0/.test(kylas)) warn('KYLAS.pipelines still has 0 ids — run kylasSetup() and fill them in');

// ---------- extension ----------
console.log('\nExtension');
const manifest = JSON.parse(read('extension/manifest.json'));
ok('manifest.json parses');

const scripts = [
  ...manifest.content_scripts.flatMap((c) => c.js),
  manifest.background.service_worker,
  'background/airtable.js',
  'background/remote-config.js',
  'popup/popup.js',
];
let parsed = 0;
for (const rel of scripts) {
  const p = path.join(root, 'extension', rel);
  if (!fs.existsSync(p)) { bad('manifest references a missing file: ' + rel); continue; }
  try { new Function(fs.readFileSync(p, 'utf8')); parsed++; }
  catch (e) { bad(rel + ' parse error: ' + e.message); }
}
if (parsed === scripts.length) ok(parsed + ' extension scripts parse');

// Chrome validates content_scripts strictly; an unknown key can fail the load.
const allowed = new Set(['matches','js','css','run_at','all_frames','exclude_matches',
  'include_globs','exclude_globs','match_about_blank','world']);
const extra = manifest.content_scripts.flatMap((c) => Object.keys(c).filter((k) => !allowed.has(k)));
if (extra.length) bad('non-standard content_scripts keys: ' + extra.join(', '));
else ok('no non-standard content_scripts keys');

// The panel lives in a shadow root and loads its stylesheet by URL, which
// Chrome blocks unless the file is web-accessible.
const war = (manifest.web_accessible_resources || []).flatMap((w) => w.resources);
if (war.includes('styles/overlay.css')) ok('overlay.css is web-accessible');
else bad('styles/overlay.css missing from web_accessible_resources — the panel renders unstyled');

console.log('\n' + (failed ? failed + ' check(s) failed\n' : 'All checks passed\n'));
process.exit(failed ? 1 : 0);
