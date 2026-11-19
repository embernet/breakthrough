'use strict';

// Every setting the app reads must reach the container: docker-compose.yml
// lists environment variables explicitly, so a new one that isn't added there
// is silently empty in every deployment.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('docker-compose.yml passes every setting the app reads', () => {
  const compose = read('docker-compose.yml');
  const files = ['src/auth/config.js', 'src/config.js', 'src/server.js'];
  const used = new Set();
  for (const f of files) {
    for (const m of read(f).matchAll(/\benv\.([A-Z][A-Z0-9_]+)|process\.env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1] || m[2]);
  }
  // Set by the image or by compose itself rather than by .env.
  // SSO_CLIENT_SECRET is read only to refuse it (secrets come from SSO_CLIENT_SECRET_FILE).
  // HOST is the bind address outside Docker; in the container the default 0.0.0.0 is right.
  for (const k of ['NODE_ENV', 'TEST_ALLOW_HTTP_ISSUER', 'SSO_CLIENT_SECRET', 'HOST']) used.delete(k);
  const missing = [...used].filter((k) => !new RegExp(`^\\s+${k}:`, 'm').test(compose));
  assert.deepStrictEqual(missing, [], `add to docker-compose.yml environment: ${missing.join(', ')}`);
});
