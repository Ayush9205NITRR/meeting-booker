#!/usr/bin/env node
/**
 * Prints the Chrome extension ID for a signing key.
 *
 *   node tools/crx-id.js key.pem
 *
 * The ID is derived from the public key, so it is fixed for the life of
 * the key. That matters: the ID is what you type into the Google Admin
 * console to force-install the extension, and it must not change when a
 * new version ships. Keep the key, keep the ID.
 *
 * Algorithm is Chrome's: sha256 of the DER SubjectPublicKeyInfo, first
 * 16 bytes, each hex digit mapped 0-f -> a-p.
 */
const crypto = require('crypto');
const fs = require('fs');

const keyPath = process.argv[2];
if (!keyPath) {
  console.error('usage: node tools/crx-id.js <key.pem>');
  process.exit(1);
}

const der = crypto
  .createPublicKey(fs.readFileSync(keyPath))
  .export({ type: 'spki', format: 'der' });

const hash = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32);
const id = [...hash].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

if (process.argv[3] === '--der-base64') console.log(der.toString('base64'));
else console.log(id);
