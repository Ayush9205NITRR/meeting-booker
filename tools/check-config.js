#!/usr/bin/env node
// Validates config/overlay-config.json — the file the BD team edits on
// github.com to change what the overlay shows.
//
// It is deliberately forgiving about *content* (a column name that doesn't
// exist in Airtable is skipped at render time, not an error here) and
// strict about *shape*, because a shape mistake is what silently drops the
// whole config and sends every overlay back to the bundled defaults.

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'config', 'overlay-config.json');
let failed = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m) => { failed++; console.log('  FAIL ' + m); };
const warn = (m) => console.log('  warn ' + m);

let config;
try {
  config = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok('overlay-config.json is valid JSON');
} catch (e) {
  console.log('  FAIL overlay-config.json: ' + e.message);
  console.log('\n1 check(s) failed\n');
  process.exit(1);
}

// ── company ──────────────────────────────────────────────────────────
const company = config.company;
if (!company || typeof company !== 'object') {
  bad('missing "company" section');
} else {
  const name = company.header && company.header.name;
  const names = Array.isArray(name) ? name : name ? [name] : [];
  if (!names.length) bad('company.header.name is empty — every record would read "Unknown company"');
  else ok(`company.header.name lists ${names.length} candidate column(s)`);

  const TYPES = new Set(['text', 'link', 'email', 'phone']);
  let entries = 0;
  for (const section of ['stats', 'fields', 'notes']) {
    const group = company[section];
    if (group == null) continue;
    if (typeof group !== 'object' || Array.isArray(group)) {
      bad(`company.${section} must be an object of "Label": "Column"`);
      continue;
    }
    // A column is a name, or a list of candidate names — the overlay takes
    // the first one present on the record, so an uncertain column can be
    // spelled several ways without breaking the panel.
    const checkColumn = (where, column) => {
      if (Array.isArray(column)) {
        if (!column.length) return bad(`${where} is an empty list of column names`);
        column.forEach((c, i) => {
          if (typeof c !== 'string' || !c.trim()) bad(`${where}[${i}] is not a column name`);
        });
        return;
      }
      if (typeof column !== 'string' || !column.trim()) {
        bad(`${where} is not a column name`);
      }
    };

    for (const [label, entry] of Object.entries(group)) {
      entries++;
      const where = `company.${section}["${label}"]`;
      if (typeof entry === 'string' || Array.isArray(entry)) {
        checkColumn(where, entry);
      } else if (entry && typeof entry === 'object') {
        if (!entry.field) bad(`${where} has no "field"`);
        else checkColumn(`${where}.field`, entry.field);
        if (entry.type && !TYPES.has(entry.type)) {
          bad(`${where} type "${entry.type}" is not one of ${[...TYPES].join(', ')}`);
        }
      } else {
        bad(`${where} must be a column name, a list of candidates, or { field, type }`);
      }
    }
  }
  if (!Array.isArray(company.badges || [])) bad('company.badges must be a list of column names');
  ok(`${entries} company field(s) declared`);

  const shown = (company.badges || []).length + Object.keys(company.stats || {}).length +
    Object.keys(company.fields || {}).length;
  if (shown > 14) warn(`${shown} things on one panel — the overlay is a glance, not a report`);
}

// ── queue ────────────────────────────────────────────────────────────
const buckets = config.queue && config.queue.buckets;
if (!Array.isArray(buckets) || !buckets.length) {
  bad('queue.buckets is empty — the home-page queue would have nothing to show');
} else {
  const RULES = new Set(['neverCalled', 'nextCallToday', 'nextCallDue']);
  const seen = new Set();
  for (const b of buckets) {
    if (!b.id) { bad('a bucket has no id'); continue; }
    if (seen.has(b.id)) bad(`duplicate bucket id "${b.id}"`);
    seen.add(b.id);
    if (!b.label) bad(`bucket "${b.id}" has no label`);
    // Every bucket needs a way to decide membership. One with neither is
    // drawn as a permanently empty pile, which reads as broken data.
    const hasStages = Array.isArray(b.stages) && b.stages.length;
    if (!hasStages && !b.rule) bad(`bucket "${b.id}" has neither "stages" nor a "rule" — it can never fill`);
    // A rule the extension doesn't implement fails the same way, but
    // silently, so it is worth catching here.
    if (b.rule && !RULES.has(b.rule)) {
      bad(`bucket "${b.id}" uses rule "${b.rule}", which the extension doesn't implement (${[...RULES].join(', ')})`);
    }
  }
  ok(`${buckets.length} queue bucket(s), ids unique`);
}

console.log('\n' + (failed ? failed + ' check(s) failed\n' : 'Config is valid\n'));
process.exit(failed ? 1 : 0);
