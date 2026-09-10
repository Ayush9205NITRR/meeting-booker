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
function wrap(label, body) {
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

// Returns every plausible repair of `text`, best first. Two things go wrong
// when a key is moved by clipboard: the line breaks vanish, or the BEGIN and
// END lines are left out of the selection and only the body arrives. Both
// leave the key material itself intact, and both fail identically with
// `DECODER routines::unsupported`.
function repairs(text) {
  const out = [];
  const m = text.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
  if (m) {
    const body = m[2].replace(/\s+/g, '');
    if (body) out.push(wrap(m[1], body));
    return out;
  }

  // No markers at all. If what is left looks like base64 of about the right
  // size, it is a body someone copied without its first and last lines.
  // Which header it wants is not knowable from the bytes, so try both and
  // let the DER decoder reject the wrong one.
  const body = text.replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/=]+$/.test(body) && body.length > 800) {
    out.push(wrap('PRIVATE KEY', body));       // PKCS#8, what openssl 3 writes
    out.push(wrap('RSA PRIVATE KEY', body));   // PKCS#1, older openssl
  }
  return out;
}

function rewrapPem(text) {
  const all = repairs(text);
  for (const candidate of all) {
    try { crypto.createPublicKey(candidate); return candidate; } catch (e) { /* next */ }
  }
  return null;
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
          raw.trim().length + ' characters), and what is there could not be read as\n' +
          'a key body either. Generate one with:\n' +
          '  openssl genrsa 2048 > kylas-overlay.pem\n' +
          'then: pbcopy < kylas-overlay.pem  (macOS) and paste that into the\n' +
          'CRX_PRIVATE_KEY secret — the whole file, BEGIN and END lines included.') +
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
