'use strict';
// House rule: apps use their own in-page controls for every message and
// question, never the browser's alert/confirm/prompt dialogs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BANNED = /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(|onbeforeunload|addEventListener\(\s*['"]beforeunload/;

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(path.join(dir, e.name)) : /\.(js|html)$/.test(e.name) ? [path.join(dir, e.name)] : []);
}

test('no browser dialogs in front-end or server-rendered code', () => {
  const root = path.join(__dirname, '..');
  const hits = [];
  for (const f of [...files(path.join(root, 'public')), ...files(path.join(root, 'src'))]) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (BANNED.test(line) && !/^\s*(\/\/|\*)/.test(line)) hits.push(`${path.relative(root, f)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, [], 'use the app\'s own dialog/toast instead');
});
