'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createModes, validateMode, LIMITS } = require('../src/modes');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'breakthrough-modes-'));
}
const sols = (n = 5) => Array.from({ length: n }, (_, i) => ({ name: `Fix ${i}`, tag: `F${i}`, hint: `Hint ${i}.` }));
const probs = (n = 5) => Array.from({ length: n }, (_, i) => ({ label: `Problem ${i}`, bestFits: [`Fix ${i % 5}`] }));
const doc = (over = {}) => ({ id: 'test-mode', name: 'Test mode', description: 'd', solutionNoun: 'fix', problems: probs(), solutions: sols(), ...over });
const yaml = (o) => JSON.stringify(o); // JSON is valid YAML

test('the built-in modes are all valid', () => {
  const logs = [];
  const reg = createModes({ dataDir: tmp(), log: (m) => logs.push(m) });
  const { modes, errors } = reg.all();
  assert.deepEqual(errors, [], JSON.stringify(errors));
  assert.deepEqual(logs, []);
  assert.deepEqual([...modes.keys()].sort(), ['algo-trading', 'innovation', 'software-engineering']);
  assert.equal(reg.defaultId(), 'software-engineering');
  assert.equal(reg.list()[0].id, 'software-engineering', 'default listed first');

  const se = reg.get('software-engineering');
  assert.equal(se.name, 'Software Engineering');
  assert.equal(se.solutionNoun, 'pattern');
  for (const label of ['N+1 queries', 'God class', 'Cache stampede', 'Thundering herd', 'Single point fail']) {
    assert.ok(se.problems.some((p) => p.label === label), label);
  }
  for (const name of ['Strategy', 'Circuit breaker', 'Strangler fig', 'Idempotency keys', 'Dependency injection']) {
    assert.ok(se.solutions.some((s) => s.name === name), name);
  }
  assert.deepEqual(se.problems.find((p) => p.label === 'Cache stampede').bestFits, ['Request coalescing', 'Jittered TTLs']);

  const at = reg.get('algo-trading');
  assert.equal(at.name, 'Algo Trading');
  assert.deepEqual(at.problems.find((p) => p.label === 'Overfitted alpha').bestFits, ['Walk-forward test', 'Purged k-fold CV', 'Regularisation']);
  for (const name of ['Mean reversion', 'Pairs trading', 'VWAP', 'Kelly sizing', 'Kill switch', 'Smart order routing']) {
    assert.ok(at.solutions.some((s) => s.name === name), name);
  }

  const tr = reg.get('innovation');
  assert.equal(tr.name, 'General innovation (TRIZ)');
  assert.equal(tr.solutions.length, 40);
  assert.equal(tr.solutionNoun, 'principle');

  for (const m of modes.values()) {
    assert.ok(m.problems.length >= 30, m.id + ' problems');
    assert.ok(m.problems.every((p) => p.label.length <= LIMITS.label));
    assert.ok(m.solutions.every((s) => s.name.length <= LIMITS.solution && /^[A-Z0-9]{2,4}$/.test(s.short) && s.hint));
  }
  // SE and trading problems all have best fits
  for (const id of ['software-engineering', 'algo-trading']) {
    assert.ok(reg.get(id).problems.every((p) => p.bestFits.length >= 1 && p.bestFits.length <= 3), id);
  }
});

test('validation reports every problem clearly', () => {
  assert.equal(validateMode(doc()).id, 'test-mode');
  const bad = doc({
    id: 'Bad Id',
    problems: [
      { label: 'A label that is far too long' },
      { label: 'Ok', bestFits: ['Nope'] },
      { label: 'ok' }, // duplicate of "Ok", case-insensitive
      { label: 'Four', bestFits: ['Fix 0', 'Fix 1', 'Fix 2', 'Fix 3'] },
      { label: 'Five' },
    ],
    solutions: [...sols(), { name: 'Fix 0', tag: 'TOOLONG', hint: '' }],
  });
  assert.throws(() => validateMode(bad), (e) => {
    const m = e.message;
    assert.match(m, /`id` "Bad Id" must be lower-case/);
    assert.match(m, /problems\[0\] "A label that is far too long": label is 28 characters \(max 18\)/);
    assert.match(m, /bestFits "Nope" is not one of this mode's solutions/);
    assert.match(m, /duplicate problem label/);
    assert.match(m, /bestFits needs 1-3 names \(has 4\)/);
    assert.match(m, /solutions\[5\] "Fix 0": duplicate solution name/);
    assert.match(m, /tag "TOOLONG" must be 2-4 letters/);
    assert.match(m, /`hint` is required/);
    assert.ok(e.issues.length >= 8);
    return true;
  });
  assert.throws(() => validateMode(doc({ solutions: sols(2) })), /at least 5 solutions/);
  assert.throws(() => validateMode(doc({ name: undefined })), /`name` is required/);
  assert.throws(() => validateMode('just a string'), /YAML mapping/);
  // bestFits match case-insensitively and are stored by the canonical name
  const v = validateMode(doc({ problems: [...probs(4), { label: 'Case', bestFits: ['fix 3'] }] }));
  assert.deepEqual(v.problems[4].bestFits, ['Fix 3']);
});

test('DATA_DIR/modes adds modes, overrides by id, skips bad files, re-reads without restart', () => {
  const dataDir = tmp();
  const dir = path.join(dataDir, 'modes');
  fs.mkdirSync(dir);
  const logs = [];
  const reg = createModes({ dataDir, log: (m) => logs.push(m) });
  assert.equal(reg.all().modes.size, 3);

  // a new mode appears on the next call
  fs.writeFileSync(path.join(dir, 'workshop.yaml'), yaml(doc({ id: 'workshop', name: 'Workshop' })));
  assert.equal(reg.get('workshop').name, 'Workshop');
  assert.equal(reg.get('workshop').source, 'data');

  // override a built-in by id
  fs.writeFileSync(path.join(dir, 'my-se.yaml'), yaml(doc({ id: 'software-engineering', name: 'SE (ours)' })));
  assert.equal(reg.get('software-engineering').name, 'SE (ours)');
  assert.equal(reg.get('software-engineering').problems.length, 5);

  // a broken file is skipped with a logged error; everything else still loads
  fs.writeFileSync(path.join(dir, 'broken.yaml'), 'id: broken\nname: [unclosed\n');
  fs.writeFileSync(path.join(dir, 'invalid.yaml'), yaml(doc({ id: 'invalid', problems: [{ label: 'x'.repeat(30) }] })));
  const { modes, errors } = reg.all();
  assert.equal(modes.size, 4); // 3 built-in (one overridden) + workshop
  assert.ok(!modes.has('broken') && !modes.has('invalid'));
  assert.equal(errors.length, 2);
  assert.ok(logs.some((l) => /skipping DATA_DIR\/modes\/broken\.yaml/.test(l)));
  assert.ok(logs.some((l) => /skipping DATA_DIR\/modes\/invalid\.yaml: [\s\S]*max 18/.test(l)));

  // unchanged files are not re-parsed (so errors aren't logged again)
  const n = logs.length;
  reg.all();
  assert.equal(logs.length, n);

  // removing the override restores the built-in
  fs.rmSync(path.join(dir, 'my-se.yaml'));
  assert.equal(reg.get('software-engineering').name, 'Software Engineering');
});

test('DEFAULT_MODE picks the default, with a fallback when it is missing', () => {
  assert.equal(createModes({ dataDir: tmp(), defaultMode: 'algo-trading' }).defaultId(), 'algo-trading');
  assert.equal(createModes({ dataDir: tmp(), defaultMode: 'algo-trading' }).list()[0].id, 'algo-trading');
  assert.equal(createModes({ dataDir: tmp(), defaultMode: 'nope' }).defaultId(), 'software-engineering');
  // no valid modes at all: null default, and it says so
  const logs = [];
  const empty = createModes({ dataDir: tmp(), builtinDir: tmp(), log: (m) => logs.push(m) });
  assert.equal(empty.defaultId(), null);
  assert.ok(logs.some((l) => /no valid mode files/.test(l)));
});
