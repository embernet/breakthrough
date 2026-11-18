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

let server, base, dataDir, db, auth;
const PW = 'test-password-123';
let userSeq = 0;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'breakthrough-test-'));
  const config = loadConfig({ DATA_DIR: dataDir, PORT: '8195', PORTAL_URL: 'https://portal.example/', PORTAL_NAME: 'Example Suite' });
  const made = createApp(config);
  db = made.db;
  auth = made.auth;
  server = made.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// Each call makes a fresh local account with this display name and signs in.
async function login(name) {
  const username = `player${++userSeq}`;
  auth.store.addLocalUser(username, name, PW);
  const res = await fetch(base + '/local', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password: PW, next: '/' }),
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
  assert.deepEqual(await a.json(), { error: 'sign in required' });
  const l = await fetch(base + '/login');
  assert.equal(l.status, 200);
  assert.match(await l.text(), /action="\/local"/);
});

test('login rejects open redirects', async () => {
  auth.store.addLocalUser('eve', 'Eve', PW);
  const res = await fetch(base + '/local', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'eve', password: PW, next: '//evil.example/' }),
  });
  assert.equal(res.headers.get('location'), '/');
});

test('game page shows the player and the configured portal link', async () => {
  const cookie = await login('Ada <Lovelace>');
  const r = await fetch(base + '/', { headers: { cookie } });
  const html = await r.text();
  assert.equal(r.status, 200);
  assert.match(html, /Ada &lt;Lovelace&gt;/);
  assert.match(html, /href="https:\/\/portal\.example">← Example Suite/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
});

test('game page has the mode dropdown, default first, honours ?mode=', async () => {
  const cookie = await login('Mode Picker');
  let html = await (await fetch(base + '/', { headers: { cookie } })).text();
  assert.match(html, /<select id="mode-select"[^>]*><option value="software-engineering" selected>Software Engineering<\/option>/);
  assert.match(html, /<option value="algo-trading">Algo Trading<\/option>/);
  assert.match(html, /<option value="algo-trading">Algo Trading<\/option><option value="business-operations">Business Operations<\/option><\/select>/);
  assert.doesNotMatch(html, /innovation/);
  assert.match(html, /data-default-mode="software-engineering"/);
  assert.match(html, /credited to the <span class="noun">pattern<\/span>/);
  html = await (await fetch(base + '/?mode=algo-trading', { headers: { cookie } })).text();
  assert.match(html, /<option value="algo-trading" selected>/);
  assert.match(html, /data-url-mode="algo-trading"/);
  assert.match(html, /credited to the <span class="noun">technique<\/span>/);
  html = await (await fetch(base + '/?mode=%3Cscript%3E', { headers: { cookie } })).text();
  assert.match(html, /data-url-mode=""/, 'unknown ?mode is ignored');
  html = await (await fetch(base + '/?mode=innovation', { headers: { cookie } })).text();
  assert.match(html, /data-url-mode=""/, 'a retired mode falls back to the default');
  assert.match(html, /<option value="software-engineering" selected>/);
});

test('modes API: list, one mode, decks alias, unknown', async () => {
  const cookie = await login('Mode Reader');
  const list = await (await fetch(base + '/api/modes', { headers: { cookie } })).json();
  assert.equal(list.default, 'software-engineering');
  assert.deepEqual(list.modes.map((m) => m.id), ['software-engineering', 'algo-trading', 'business-operations']);
  const at = await (await fetch(base + '/api/modes/algo-trading', { headers: { cookie } })).json();
  assert.equal(at.name, 'Algo Trading');
  assert.equal(at.solutionNoun, 'technique');
  assert.ok(at.problems.some((p) => p.label === 'Look-ahead bias' && p.bestFits.includes('Point-in-time data')));
  assert.ok(at.solutions.every((x) => x.name && x.short && x.hint));
  const d = await (await fetch(base + '/api/decks', { headers: { cookie } })).json();
  assert.equal(d.id, 'software-engineering');
  const d2 = await (await fetch(base + '/api/decks?mode=business-operations', { headers: { cookie } })).json();
  assert.ok(d2.solutions.some((x) => x.name === 'Kaizen'));
  assert.equal((await fetch(base + '/api/modes/innovation', { headers: { cookie } })).status, 404);
  assert.equal((await fetch(base + '/api/modes/nope', { headers: { cookie } })).status, 404);
  assert.equal((await fetch(base + '/api/scores?mode=nope', { headers: { cookie } })).status, 404);
});

test('a DATA_DIR mode file appears without a restart', async () => {
  const dir = path.join(dataDir, 'modes');
  fs.mkdirSync(dir, { recursive: true });
  const mode = {
    id: 'workshop', name: 'Workshop', solutionNoun: 'idea',
    problems: ['Too many meetings', 'Slow decisions', 'No budget', 'Silos', 'Churn'],
    solutions: ['A', 'B', 'C', 'D', 'E'].map((n) => ({ name: 'Idea ' + n, tag: 'ID' + n, hint: 'Try ' + n + '.' })),
  };
  fs.writeFileSync(path.join(dir, 'workshop.yaml'), JSON.stringify(mode));
  const cookie = await login('Facilitator');
  const list = await (await fetch(base + '/api/modes', { headers: { cookie } })).json();
  assert.ok(list.modes.some((m) => m.id === 'workshop' && m.source === 'data'));
  const w = await (await fetch(base + '/api/modes/workshop', { headers: { cookie } })).json();
  assert.equal(w.problems[0].label, 'Too many meetings');
  assert.equal(w.solutionNounPlural, 'ideas');
  fs.rmSync(dir, { recursive: true });
});

test('scores are per mode', async () => {
  const a = await login('Quant');
  const b = await login('Architect');
  let r = await post(a, game({ mode: 'algo-trading', score: 900, rightTools: 2 }));
  assert.equal(r.status, 201);
  let j = await r.json();
  assert.deepEqual(j.mode, { id: 'algo-trading', name: 'Algo Trading' });
  assert.equal(j.top[0].displayName, 'Quant');
  assert.equal(j.top[0].rightTools, 2);
  r = await post(b, game({ mode: 'business-operations', score: 777 }));
  assert.equal(r.status, 201);

  const at = await (await fetch(base + '/api/scores?mode=algo-trading', { headers: { cookie: b } })).json();
  assert.deepEqual(at.top.map((x) => x.displayName), ['Quant']);
  assert.equal(at.me, null, 'Architect has not played this mode');
  const tr = await (await fetch(base + '/api/scores?mode=business-operations', { headers: { cookie: a } })).json();
  assert.deepEqual(tr.top.map((x) => x.displayName), ['Architect']);
  const se = await (await fetch(base + '/api/scores', { headers: { cookie: a } })).json();
  assert.equal(se.mode.id, 'software-engineering');
  assert.ok(!se.top.some((x) => x.displayName === 'Quant'));

  await new Promise((res) => setTimeout(res, 2100)); // flood guard
  r = await post(a, game({ mode: 'innovation' })); // retired mode
  assert.equal(r.status, 400);
  await new Promise((res) => setTimeout(res, 2100));
  r = await post(a, game({ mode: 'no-such-mode' }));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'unknown mode');
});

test('score rows from a retired mode stay in the DB but never surface', async () => {
  const c = await login('Old TRIZ fan');
  db.prepare(`INSERT INTO scores (user_id, display_name, mode, score, level, problems_solved, perfect_fits, best_combo, solution_rows, pieces, duration_ms)
    VALUES ('local:ghost', 'Ghost', 'innovation', 99999, 1, 0, 0, 0, 0, 10, 60000)`).run();
  assert.equal((await fetch(base + '/api/scores?mode=innovation', { headers: { cookie: c } })).status, 404);
  for (const m of ['software-engineering', 'algo-trading', 'business-operations']) {
    const r = await fetch(base + '/api/scores?mode=' + m, { headers: { cookie: c } });
    assert.equal(r.status, 200);
    assert.ok(!(await r.json()).top.some((x) => x.displayName === 'Ghost'), m);
  }
  assert.equal(db.prepare("SELECT COUNT(*) n FROM scores WHERE mode = 'innovation'").get().n, 1, 'kept, not deleted');
});

test('migration v2: existing scores become innovation-mode scores', () => {
  const { DatabaseSync } = require('node:sqlite');
  const { migrate, MIGRATIONS } = require('../src/db');
  const old = new DatabaseSync(':memory:');
  old.exec(MIGRATIONS[0]);
  old.exec('PRAGMA user_version = 1');
  old.prepare(`INSERT INTO scores (user_id, display_name, score, level, problems_solved, perfect_fits, best_combo, solution_rows, pieces, duration_ms)
    VALUES ('u1', 'Old Timer', 500, 1, 2, 0, 1, 0, 30, 60000)`).run();
  migrate(old);
  assert.equal(old.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
  const row = old.prepare('SELECT mode, right_tools, score FROM scores').get();
  assert.deepEqual({ ...row }, { mode: 'innovation', right_tools: 0, score: 500 });
  migrate(old); // idempotent
  old.close();
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
  assert.equal(r.status, 302);
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
    game({ rightTools: 7 }), // more than problems solved
    game({ rightTools: -1 }),
    game({ mode: 42 }),
    null, [], 'x',
  ];
  for (const b of bad) assert.equal(validateSubmission(b).ok, false, JSON.stringify(b));
  const isMode = (id) => id === 'software-engineering';
  assert.equal(validateSubmission(game({ mode: 'x' }), { isMode }).ok, false);
  assert.equal(validateSubmission(game(), { isMode, defaultMode: 'software-engineering' }).value.mode, 'software-engineering');
  // the Right-tool bonus raised the ceiling: a perfect + right-tool game still validates
  const g2 = E.createGame({ seed: 1, startProblemRows: 0 });
  E.drainEvents(g2);
  E.insertProblemRow(g2, { label: 'P', bestFits: ['Fix'] }, [3, 4, 5, 6]);
  g2.active = { id: 999, type: 'I', rot: 0, x: 3, y: 0, principle: { name: 'Fix', short: 'FIX', hint: '' } };
  E.hardDrop(g2);
  g2.stats.elapsedMs = 5000;
  assert.equal(g2.stats.rightTools, 1);
  assert.equal(validateSubmission(E.summary(g2)).ok, true, JSON.stringify(validateSubmission(E.summary(g2))));
  // a real (bot-played) game always validates
  const g = E.createGame({ seed: 7 });
  for (let i = 0; i < 40 && !g.over; i++) { E.hardDrop(g); E.update(g, 250); }
  assert.equal(validateSubmission(E.summary(g)).ok, true, JSON.stringify(validateSubmission(E.summary(g))));
});

test('standalone: no portal settings, no portal link', async () => {
  const views = require('../src/views');
  const user = { id: 'local:x', username: 'x', displayName: 'X', source: 'local', isAdmin: false };
  for (const extra of [{}, { portalUrl: 'https://portal.example' }, { portalName: 'Example Suite' }]) {
    const html = views.gamePage({ user, version: 'v', ...extra });
    assert.doesNotMatch(html, /portal-link/);
  }
});
