'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/js/engine.js');

const PRINCIPLES = [
  { name: 'Merging', hint: 'Combine.' },
  { name: 'Segmentation', hint: 'Divide.' },
];

function blank(opts = {}) {
  const g = E.createGame({ seed: 42, startProblemRows: 0, principles: PRINCIPLES, ...opts });
  E.drainEvents(g);
  return g;
}
function setActive(g, type, rot, x, y, principle = { name: 'Merging', short: 'MER', hint: 'Combine.' }) {
  g.active = { id: 9000 + g.stats.pieces, type, rot, x, y, principle };
  g.lockAcc = 0;
  return g.active;
}
function fillCells(g, y, xs) {
  for (const x of xs) g.grid[y].cells[x] = { kind: 'solution', type: 'O', principle: PRINCIPLES[1], pieceId: 1 };
}
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const BOTTOM = E.ROWS - 1;

test('a full row of solutions clears for low points', () => {
  const g = blank();
  fillCells(g, BOTTOM, range(0, 8));
  setActive(g, 'I', 1, 7, 0); // vertical I: column x+2 = 9
  const before = g.score;
  E.hardDrop(g);
  assert.equal(g.stats.solutionRows, 1);
  assert.equal(g.stats.solved.length, 0);
  // the 3 leftover I cells fall into the bottom rows; the cleared row is gone
  assert.equal(g.grid[BOTTOM].cells.filter(Boolean).length, 1);
  assert.equal(g.grid[BOTTOM].cells[9].kind, 'solution');
  const ev = E.drainEvents(g);
  assert.ok(ev.some((e) => e.type === 'solutionRow'));
  assert.equal(g.score - before, (E.ROWS - 4) * 2 + E.SCORE.solutionRow); // drop + row
  assert.equal(g.combo, 0, 'solution-only clears do not build a combo');
});

test('problem rows rise from the bottom and push the stack up', () => {
  const g = blank();
  fillCells(g, BOTTOM, [0]);
  assert.ok(E.insertProblemRow(g, { label: 'Data silos' }, [3, 4]));
  const row = g.grid[BOTTOM];
  assert.equal(row.problem.label, 'Data silos');
  assert.deepEqual(row.problem.gaps, [3, 4]);
  assert.equal(row.cells[3], null);
  assert.equal(row.cells[4], null);
  assert.equal(row.cells.filter(Boolean).length, 8);
  assert.ok(row.cells.filter(Boolean).every((c) => c.kind === 'problem'));
  assert.equal(g.grid[BOTTOM - 1].cells[0].kind, 'solution', 'old bottom row moved up one');
  assert.ok(E.drainEvents(g).some((e) => e.type === 'rise' && e.label === 'Data silos'));
});

test('a rising problem carries an overlapping falling piece up', () => {
  const g = blank();
  setActive(g, 'O', 0, 0, BOTTOM - 1); // resting on the floor, cols 0-1
  E.insertProblemRow(g, { label: 'X' }, [5]);
  assert.equal(g.active.y, BOTTOM - 2);
  assert.ok(!E.collides(g, g.active));
});

test('problem rows rise on a timer', () => {
  const g = blank();
  setActive(g, 'O', 0, 4, 0);
  const n = g.stats.problemsRisen;
  // no problems in the well: the next one is called in 3× faster
  for (let t = 0; t < E.riseMs(1) / 3 + 50; t += 50) E.update(g, 50);
  assert.equal(g.stats.problemsRisen, n + 1);
});

test('completing a problem row breaks it, crediting the completing principle', () => {
  const g = blank();
  E.insertProblemRow(g, { label: 'Slow approvals' }, [4]);
  setActive(g, 'I', 1, 2, 0, { name: 'Feedback', short: 'FEE', hint: 'Loop it.' }); // vertical, column 4
  E.hardDrop(g);
  assert.equal(g.stats.solved.length, 1);
  assert.equal(g.stats.solved[0].label, 'Slow approvals');
  assert.equal(g.stats.solved[0].principle, 'Feedback');
  assert.equal(g.stats.solved[0].perfect, false, '3 cells left over: not a perfect fit');
  assert.equal(g.grid[BOTTOM].problem, null);
  assert.equal(g.grid.filter((r) => r.cells.some(Boolean)).length, 3);
  const br = E.drainEvents(g).find((e) => e.type === 'break');
  assert.equal(br.label, 'Slow approvals');
  assert.equal(br.principle, 'Feedback');
  assert.equal(g.stats.principleUse.Feedback, 1);
});

test('perfect fit: the piece exactly fills the slot, scores double', () => {
  const g = blank();
  E.insertProblemRow(g, { label: 'Legacy monolith' }, [3, 4, 5, 6]);
  setActive(g, 'I', 0, 3, 0);
  E.hardDrop(g);
  const [s] = g.stats.solved;
  assert.equal(s.perfect, true);
  assert.equal(g.stats.perfectFits, 1);
  assert.equal(s.points, (E.SCORE.problemBase + 3 * E.SCORE.problemPerExtraGap) * E.SCORE.perfectMultiplier);
  assert.equal(E.stackHeight(g), 0, 'nothing left in the well');
});

test('perfect fit across two stacked problem rows (T-shaped slot)', () => {
  const g = blank();
  E.insertProblemRow(g, { label: 'Top' }, [3, 4, 5]);
  E.insertProblemRow(g, { label: 'Bottom' }, [4]);
  setActive(g, 'T', 2, 3, 0); // pointing down: row x 3..5, nub at x 4 below
  E.hardDrop(g);
  assert.equal(g.stats.solved.length, 2);
  assert.ok(g.stats.solved.every((s) => s.perfect));
  assert.equal(g.combo, 1);
  assert.equal(E.stackHeight(g), 0);
});

test('not perfect when an earlier piece helped fill the gap', () => {
  const g = blank();
  E.insertProblemRow(g, { label: 'Tech debt' }, [3, 4, 5, 6]);
  E.insertProblemRow(g, { label: 'Skills gap' }, [5]);
  fillCells(g, BOTTOM - 1, [3]); // an earlier piece (id 1) took one gap
  setActive(g, 'T', 2, 4, 0); // row x 4..6, nub at x 5 below
  E.hardDrop(g);
  const by = Object.fromEntries(g.stats.solved.map((s) => [s.label, s.perfect]));
  assert.deepEqual(by, { 'Tech debt': false, 'Skills gap': true });
});

test('consecutive breaks build a combo; a dry piece resets it', () => {
  const g = blank();
  E.insertProblemRow(g, { label: 'A' }, [6, 7, 8, 9]);
  setActive(g, 'I', 0, 6, 0);
  E.hardDrop(g);
  assert.equal(g.combo, 1);
  E.insertProblemRow(g, { label: 'B' }, [0, 1, 2, 3]);
  setActive(g, 'I', 0, 0, 0);
  E.hardDrop(g);
  assert.equal(g.combo, 2);
  assert.equal(g.stats.bestCombo, 2);
  setActive(g, 'O', 0, 4, 0);
  E.hardDrop(g);
  assert.equal(g.combo, 0);
  assert.equal(g.stats.bestCombo, 2);
});

test('levels follow problems solved and speed things up', () => {
  assert.equal(E.levelFor(0), 1);
  assert.equal(E.levelFor(E.PROBLEMS_PER_LEVEL), 2);
  assert.ok(E.gravityMs(5) < E.gravityMs(1));
  assert.ok(E.riseMs(5) < E.riseMs(1));
  assert.ok(E.gravityMs(99) >= 45);
});

test('rotation turns a piece clockwise and counter-clockwise', () => {
  const g = blank();
  setActive(g, 'T', 0, 4, 5);
  assert.ok(E.rotate(g, 1));
  assert.equal(g.active.rot, 1);
  assert.deepEqual(E.pieceCells(g.active).sort(), [[5, 5], [5, 6], [5, 7], [6, 6]].sort());
  assert.ok(E.rotate(g, -1));
  assert.equal(g.active.rot, 0);
});

test('rotation kicks off the left wall', () => {
  const g = blank();
  setActive(g, 'T', 1, -1, 5); // vertical bar in column 0, nub at column 1
  assert.ok(!E.collides(g, g.active));
  assert.ok(E.rotate(g, 1)); // in place it would poke through the wall
  assert.equal(g.active.rot, 2);
  assert.equal(g.active.x, 0);
  assert.ok(E.drainEvents(g).some((e) => e.type === 'rotate' && e.kicked));
});

test('I piece kicks off the right wall', () => {
  const g = blank();
  setActive(g, 'I', 1, 7, 5); // vertical in column 9
  assert.ok(E.rotate(g, 1)); // to state 2 (horizontal) must move left
  assert.ok(E.pieceCells(g.active).every(([x]) => x >= 0 && x < E.COLS));
});

test('rotation fails when every kick is blocked', () => {
  const g = blank();
  for (let y = 0; y < E.ROWS; y++) fillCells(g, y, [0, 1, 2, 3, 5, 6, 7, 8, 9]);
  setActive(g, 'I', 1, 2, 5); // vertical in the column-4 shaft
  assert.ok(!E.collides(g, g.active));
  assert.equal(E.rotate(g, 1), false);
  assert.equal(g.active.rot, 1);
});

test('moves are blocked by walls and the stack', () => {
  const g = blank();
  setActive(g, 'O', 0, 0, 5);
  assert.equal(E.move(g, -1), false);
  fillCells(g, 5, [2]);
  assert.equal(E.move(g, 1), false);
});

test('ghost piece lands on the stack', () => {
  const g = blank();
  fillCells(g, 15, [4]);
  setActive(g, 'O', 0, 4, 0);
  assert.equal(E.ghostY(g), 13);
});

test('hold parks the idea once per piece', () => {
  const g = blank();
  const first = g.active.type;
  assert.ok(E.hold(g));
  assert.equal(g.hold.type, first);
  assert.equal(E.hold(g), false, 'only once per drop');
  E.hardDrop(g);
  const now = g.active.type;
  assert.ok(E.hold(g));
  assert.equal(g.active.type, first, 'swapped the parked idea back in');
  assert.equal(g.hold.type, now);
});

test('7-bag gives every shape once per seven pieces', () => {
  const g = blank();
  const types = new Set();
  for (let i = 0; i < 7; i++) { types.add(g.active.type); E.hardDrop(g); }
  assert.equal(g.over, false);
  assert.equal(types.size, 7);
});

test('game over (Overwhelmed) when a problem pushes the stack out of the top', () => {
  const g = blank();
  fillCells(g, 0, [2]);
  setActive(g, 'O', 0, 6, 3);
  assert.equal(E.insertProblemRow(g, { label: 'Too much' }, [0]), false);
  assert.equal(g.over, true);
  assert.equal(g.overReason, 'overwhelmed');
  assert.ok(E.drainEvents(g).some((e) => e.type === 'gameOver'));
  E.update(g, 100); // no-ops once over
  assert.equal(E.move(g, 1), false);
});

test('game over when pieces can no longer enter the well', () => {
  const g = blank();
  for (let y = 0; y < E.ROWS; y++) fillCells(g, y, [3, 4, 5, 6]);
  for (let i = 0; i < 6 && !g.over; i++) E.hardDrop(g);
  assert.equal(g.over, true);
  assert.equal(g.overReason, 'overwhelmed');
});

test('game over via the rise timer', () => {
  const g = blank();
  fillCells(g, 0, [9]);
  setActive(g, 'O', 0, 0, 3);
  g.riseAcc = E.riseMs(1);
  E.update(g, 16);
  assert.equal(g.over, true);
});

test('starts with problem rows in the well', () => {
  const g = E.createGame({ seed: 1 });
  assert.equal(g.grid.filter((r) => r.problem).length, 3);
  assert.ok(g.active);
  assert.equal(g.queue.length, 5);
  assert.ok(g.upcomingProblem.label);
});

// A greedy bot plays real games end to end: checks the game is playable,
// that problems get solved, and that the server's plausibility bound holds.
function evalRows(rows) {
  // rows: remaining (uncleared) rows' cells, top to bottom, bottom-aligned
  let holes = 0, bump = 0, agg = 0, prev = null;
  const off = E.ROWS - rows.length;
  for (let x = 0; x < E.COLS; x++) {
    let top = E.ROWS;
    rows.forEach((cells, i) => {
      if (cells[x]) { if (top === E.ROWS) top = i + off; } else if (top < i + off) holes++;
    });
    const h = E.ROWS - top;
    agg += h;
    if (prev != null) bump += Math.abs(h - prev);
    prev = h;
  }
  return { holes, bump, agg };
}
function botMove(g) {
  let best = null;
  const p0 = g.active;
  for (let rot = 0; rot < 4; rot++) {
    for (let x = -3; x < E.COLS + 1; x++) {
      const p = { ...p0, rot, x };
      if (E.collides(g, p)) continue;
      const y = E.ghostY({ ...g, active: p });
      const cells = E.pieceCells({ ...p, y });
      if (cells.some(([, cy]) => cy < 0)) continue;
      const filled = new Set(cells.map(([cx, cy]) => cx + ',' + cy));
      let full = 0, problems = 0;
      const keep = [];
      g.grid.forEach((row, ry) => {
        const cellsNow = row.cells.map((c, cx) => c || (filled.has(cx + ',' + ry) ? 1 : null));
        if (cellsNow.every(Boolean)) { full++; if (row.problem) problems++; } else keep.push(cellsNow);
      });
      const b = evalRows(keep);
      const score = problems * 8 + full * 2 - b.holes * 7 - b.bump - b.agg * 0.5;
      if (!best || score > best.score) best = { score, rot, x };
    }
  }
  return best;
}

test('a greedy bot can play: solves problems, scores stay plausible', () => {
  let solved = 0;
  for (const seed of [2, 3, 4]) {
    const g = E.createGame({ seed });
    for (let i = 0; i < 600 && !g.over; i++) {
      const m = botMove(g);
      if (m) g.active = { ...g.active, rot: m.rot, x: m.x };
      E.hardDrop(g);
      for (let k = 0; k < 3; k++) E.update(g, 250); // time passes: problems keep rising
    }
    const s = E.summary(g);
    solved += s.problemsSolved;
    assert.ok(s.score <= E.maxPlausibleScore(s), `seed ${seed}: ${s.score} > bound`);
    assert.equal(s.level, E.levelFor(s.problemsSolved));
    const text = E.reportText(g, 'Ada');
    assert.match(text, /Innovation report/);
    assert.match(text, /Innovator: Ada/);
  }
  assert.ok(solved >= 20, 'bot solved ' + solved);
});
