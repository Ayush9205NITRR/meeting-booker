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

// A PEM pasted into a GitHub secret often arrives with its line breaks
// gone — some clipboards and terminals flatten it. The key material is
// identical, but OpenSSL will not decode it, and what reaches the build
// log is `DECODER routines::unsupported` and a stack trace, which says
// nothing about what to do. Re-wrap it and carry on; a key that is
// genuinely wrong still fails below, with a sentence that names the fix.
function rewrapPem(text) {
  const m = text.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
  if (!m) return null;
  const body = m[2].replace(/\s+/g, '');
  if (!body) return null;
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN ${m[1]}-----\n${lines.join('\n')}\n-----END ${m[1]}-----\n`;
}

const raw = fs.readFileSync(keyPath, 'utf8');

let publicKey;
try {
  publicKey = crypto.createPublicKey(raw);
} catch (first) {
  const repaired = rewrapPem(raw);
  if (repaired && repaired !== raw) {
    try {
      publicKey = crypto.createPublicKey(repaired);
      console.error('note: the key had no line breaks; re-wrapped it to read it. ' +
                    'Worth re-pasting the secret from the .pem file so this stops happening.');
    } catch (second) { /* fall through to the message below */ }
  }
  if (!publicKey) {
    const has = /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(raw);
    console.error(
      'Could not read a private key from ' + keyPath + '.\n' +
      (has
        ? 'It has the right header, so the contents are damaged — usually a partial\n' +
          'copy. Re-paste the WHOLE file, BEGIN and END lines included.'
        : 'There is no "-----BEGIN ... PRIVATE KEY-----" line in it (' +
          raw.trim().length + ' characters). Generate one with:\n' +
          '  openssl genrsa 2048 > kylas-overlay.pem\n' +
          'and paste the entire file into the CRX_PRIVATE_KEY secret.') +
      '\nOpenSSL said: ' + first.message);
    process.exit(1);
  }
}

const der = publicKey.export({ type: 'spki', format: 'der' });

const hash = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32);
const id = [...hash].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

// `--fix-key` rewrites the file in canonical PEM form. Chrome reads the
// key off disk to pack the CRX, so repairing it only inside this process
// would leave the pack step failing on the same flattened file.
if (process.argv.includes('--fix-key')) {
  const canonical = rewrapPem(raw);
  if (canonical && canonical !== raw) {
    fs.writeFileSync(keyPath, canonical);
    console.error('note: rewrote ' + keyPath + ' with proper line breaks.');
  }
}

if (process.argv.includes('--der-base64')) console.log(der.toString('base64'));
else console.log(id);
