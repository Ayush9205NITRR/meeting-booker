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
console.log('\nApps Script (apps-script/)');
// Every .gs in the folder, not a fixed list: once "Import from Apps
// Script" has run, Code.gs and anything else the project holds live here
// too, and they have to pass the same checks.
// Both extensions: Apps Script's own name for these is .gs, but clasp 3
// writes .js unless told otherwise, so a project can legitimately hold
// either. They all become server code in the same global namespace, so
// the checks below apply to both.
const gsFiles = fs.readdirSync(path.join(root, 'apps-script'))
  .filter((f) => f.endsWith('.gs') || f.endsWith('.js'))
  .sort();

const sources = {};
for (const name of gsFiles) {
  sources[name] = read('apps-script/' + name);
  try { new Function(sources[name]); ok(name + ' parses'); }
  catch (e) { bad(name + ' parse error: ' + e.message); }
}

// They all land in ONE Apps Script project, which has a single global
// namespace — so a name declared in two files is a duplicate declaration
// at runtime even though each file parses fine on its own. This is the
// check that catches a helper in Kylas.gs colliding with one in Code.gs.
try {
  new Function(gsFiles.map((n) => sources[n]).join('\n'));
  ok(gsFiles.length + ' script file(s) share no top-level names');
} catch (e) {
  bad('the .gs files do not parse together: ' + e.message);
}

const overlay = sources['Overlay.gs'] || '';
const kylas = sources['Kylas.gs'] || '';
if (!kylas) bad('apps-script/Kylas.gs is missing');
if (!overlay) bad('apps-script/Overlay.gs is missing');

// Until the import has run, the live project's own files aren't here yet.
// Deploying in that state would delete them, so say so loudly — the deploy
// workflow refuses on the same condition.
if (!gsFiles.includes('Code.gs') && !gsFiles.includes('Code.js')) {
  warn('Code.gs is not in the repo yet — run the "Import from Apps Script" workflow before deploying');
}

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

// The manifest declares oauthScopes explicitly, which turns Apps Script's
// auto-detection off — so a service used in code but missing from the list
// fails at runtime with a permission error, not at deploy. Each service
// below cost a failed run to discover.
const manifestPath = path.join(root, 'apps-script', 'appsscript.json');
if (fs.existsSync(manifestPath)) {
  const appsScript = JSON.parse(read('apps-script/appsscript.json'));
  const scopes = appsScript.oauthScopes || [];
  const allCode = gsFiles.map((n) => sources[n]).join('\n');

  const needs = [
    ['UrlFetchApp', 'https://www.googleapis.com/auth/script.external_request'],
    ['Calendar.', 'https://www.googleapis.com/auth/calendar'],
    ['Session.get', 'https://www.googleapis.com/auth/userinfo.email'],
  ];

  if (!scopes.length) {
    warn('appsscript.json declares no oauthScopes — Apps Script will auto-detect, which does not re-prompt an already-authorised user');
  } else {
    let missing = 0;
    for (const [service, scope] of needs) {
      if (!allCode.includes(service)) continue;
      if (scopes.includes(scope)) continue;
      bad(service + ' is used but ' + scope + ' is not in appsscript.json oauthScopes');
      missing++;
    }
    if (!missing) ok(scopes.length + ' oauthScopes cover every service the code calls');
  }
}

// Every action the extension asks for must exist in Overlay.gs's router.
// A missing one answers "unknown action: X" at runtime and the panel just
// looks broken — which is exactly how `board` went unnoticed: Code.gs had
// getBoard() all along, but nothing routed to it, so the bookers, the
// tentative POCs and the reviewers were all empty and nobody could see why.
{
  const worker = read('extension/background/service-worker.js');
  const asked = new Set([
    ...[...worker.matchAll(/callBackend\(\{\s*action:\s*"([a-zA-Z]+)"/g)].map((m) => m[1]),
    ...[...worker.matchAll(/postBackend\(\{\s*action:\s*"([a-zA-Z]+)"/g)].map((m) => m[1]),
  ]);
  const routed = new Set(
    [...(sources['Overlay.gs'] || '').matchAll(/case '([a-zA-Z]+)':/g)].map((m) => m[1])
  );

  const missing = [...asked].filter((a) => !routed.has(a));
  if (missing.length) {
    bad('the extension asks for action(s) Overlay.gs does not route: ' + missing.join(', '));
  } else {
    ok(asked.size + ' backend actions all have a route');
  }
}

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

// ---------- workflows ----------
// A step that reads $CLASPRC_JSON but doesn't declare it in its own `env:`
// gets an empty string, not an error — GitHub only exposes a secret to the
// step that asks for it. That reads exactly like a missing secret, and the
// only way to find out is a failed run, so it's worth catching here.
console.log('\nWorkflows');

const wfDir = path.join(root, '.github', 'workflows');
const workflows = fs.readdirSync(wfDir).filter((f) => f.endsWith('.yml')).sort();

let stepsChecked = 0;
for (const file of workflows) {
  const text = read('.github/workflows/' + file);

  // Steps start at a known indent in these files, so splitting on that is
  // enough without pulling in a YAML parser.
  const blocks = text.split(/\n(?=      - (?:name|uses):)/).slice(1);

  for (const block of blocks) {
    stepsChecked++;
    const name = (block.match(/- name: (.+)/) || [, block.match(/- uses: (.+)/)?.[1] || '?'])[1].trim();

    // Only the step's own env block, which ends at the next key at the
    // same indent (run:, with:, if:, ...).
    const envBlock = block.match(/\n        env:\n((?:\s{10,}\S.*\n)+)/);
    const declared = new Set(
      envBlock ? [...envBlock[1].matchAll(/^\s+([A-Z_][A-Z0-9_]*):/gm)].map((m) => m[1]) : []
    );

    const runBlock = block.match(/\n        run: \|\n([\s\S]*?)(?=\n      - |\n  [a-z]|$)/);
    if (!runBlock) continue;

    // Shell and Node both, since these steps pass secrets into node -e.
    const used = new Set([
      ...[...runBlock[1].matchAll(/\$\{?([A-Z_][A-Z0-9_]{2,})\}?/g)].map((m) => m[1]),
      ...[...runBlock[1].matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1]),
    ]);

    // Set by the runner or by an earlier line in the same script.
    const provided = /^(GITHUB_[A-Z_]+|RUNNER_[A-Z_]+|HOME|PATH|PWD|CI)$/;

    for (const v of used) {
      if (provided.test(v)) continue;
      if (declared.has(v)) continue;
      if (new RegExp('^\\s*(export\\s+)?' + v + '=', 'm').test(runBlock[1])) continue;
      bad(file + ' -> "' + name + '" reads $' + v + ' but does not declare it in env: (it will be empty)');
    }
  }
}
ok(stepsChecked + ' workflow steps checked for undeclared env vars');

console.log('\n' + (failed ? failed + ' check(s) failed\n' : 'All checks passed\n'));
process.exit(failed ? 1 : 0);
