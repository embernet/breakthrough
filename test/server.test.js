'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/server');
const { loadConfig } = require('../src/config');
const { validateSubmission } = require('../src/scores');
const E = require('../public/js/engine.js');

let server, base, dataDir, db;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'breakthrough-test-'));
  const config = loadConfig({ DATA_DIR: dataDir, PORT: '8195', PORTAL_URL: 'https://horizon.example/' });
  const made = createApp(config);
  db = made.db;
  server = made.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function login(name) {
  const res = await fetch(base + '/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ displayName: name, next: '/' }),
  });
  assert.equal(res.status, 303);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return cookie;
}
const game = (over = {}) => ({
  score: 1234, level: 2, problemsSolved: 6, perfectFits: 1, bestCombo: 2,
  solutionRows: 3, pieces: 60, durationMs: 90_000, topPrinciple: 'Merging', ...over,
});
function post(cookie, body) {
  return fetch(base + '/api/scores', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('healthz is open', async () => {
  const r = await fetch(base + '/healthz');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('logged out: / redirects to /login, /api is 401', async () => {
  const r = await fetch(base + '/', { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login?next=%2F');
  const a = await fetch(base + '/api/decks');
  assert.equal(a.status, 401);
  assert.deepEqual(await a.json(), { error: 'login required' });
  const l = await fetch(base + '/login');
  assert.equal(l.status, 200);
  assert.match(await l.text(), /Display name/);
});

test('login rejects open redirects', async () => {
  const res = await fetch(base + '/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ displayName: 'Eve', next: '//evil.example/' }),
  });
  assert.equal(res.headers.get('location'), '/');
});

test('game page shows the player and the Horizon link', async () => {
  const cookie = await login('Ada <Lovelace>');
  const r = await fetch(base + '/', { headers: { cookie } });
  const html = await r.text();
  assert.equal(r.status, 200);
  assert.match(html, /Ada &lt;Lovelace&gt;/);
  assert.match(html, /href="https:\/\/horizon\.example">← Horizon/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
});

test('decks load with short labels', async () => {
  const cookie = await login('Deck Reader');
  const d = await (await fetch(base + '/api/decks', { headers: { cookie } })).json();
  assert.ok(d.problems.items.length >= 40);
  assert.ok(d.problems.items.every((p) => p.label.length <= 18));
  assert.ok(d.principles.items.length >= 40);
  assert.ok(d.principles.items.every((p) => p.name.length <= 18 && p.hint && p.short));
  assert.ok(d.principles.items.some((p) => p.name === 'Do it in reverse'));
});

test('a DATA_DIR deck overrides the default', async () => {
  fs.mkdirSync(path.join(dataDir, 'decks'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'decks', 'problems.yaml'), 'name: Workshop\nproblems:\n  - Too many meetings\n  - label: A label that is far too long to fit\n');
  const cookie = await login('Facilitator');
  const d = await (await fetch(base + '/api/decks', { headers: { cookie } })).json();
  assert.equal(d.problems.name, 'Workshop');
  assert.equal(d.problems.source, 'data');
  assert.equal(d.problems.items[0].label, 'Too many meetings');
  assert.ok(d.problems.items[1].label.length <= 18);
  assert.equal(d.principles.source, 'default');
  fs.rmSync(path.join(dataDir, 'decks'), { recursive: true });
});

test('scores: submit, leaderboard, my best', async () => {
  const a = await login('Grace');
  const b = await login('Linus');
  let r = await post(a, game());
  assert.equal(r.status, 201);
  let j = await r.json();
  assert.equal(j.personalBest, true);
  assert.equal(j.me.score, 1234);

  r = await post(b, game({ score: 5000 }));
  assert.equal(r.status, 201);

  const lb = await (await fetch(base + '/api/scores', { headers: { cookie: a } })).json();
  assert.equal(lb.top[0].displayName, 'Linus');
  assert.equal(lb.top[0].isMe, false);
  const mine = lb.top.find((x) => x.displayName === 'Grace');
  assert.equal(mine.isMe, true);
  assert.equal(lb.me.rank, 2);
  assert.equal(lb.me.games, 1);
});

test('scores: flood guard and content type', async () => {
  const c = await login('Speedy');
  assert.equal((await post(c, game())).status, 201);
  assert.equal((await post(c, game())).status, 429);
  const r = await fetch(base + '/api/scores', { method: 'POST', headers: { cookie: c, 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(r.status, 415);
});

test('logout ends the session', async () => {
  const c = await login('Leaver');
  const r = await fetch(base + '/logout', { headers: { cookie: c }, redirect: 'manual' });
  assert.equal(r.status, 303);
  assert.equal((await fetch(base + '/api/scores', { headers: { cookie: c } })).status, 401);
});

test('score validation is proportionate', () => {
  assert.equal(validateSubmission(game()).ok, true);
  const bad = [
    game({ score: -1 }),
    game({ score: 1.5 }),
    game({ score: '100' }),
    game({ level: 9 }), // level must match problems solved
    game({ perfectFits: 7 }),
    game({ bestCombo: 9 }),
    game({ problemsSolved: 500, level: E.levelFor(500) }), // > 4 per piece
    game({ pieces: 5000 }), // too fast for 90 s
    game({ score: 99_999_999 }), // not plausible for this game
    game({ topPrinciple: 42 }),
    null, [], 'x',
  ];
  for (const b of bad) assert.equal(validateSubmission(b).ok, false, JSON.stringify(b));
  // a real (bot-played) game always validates
  const g = E.createGame({ seed: 7 });
  for (let i = 0; i < 40 && !g.over; i++) { E.hardDrop(g); E.update(g, 250); }
  assert.equal(validateSubmission(E.summary(g)).ok, true, JSON.stringify(validateSubmission(E.summary(g))));
});
