/*
 * Breakthrough game engine: pure game logic, no DOM, no timers.
 *
 * Problems rise from the bottom of the well; the player steers falling
 * four-cell solution pieces, each carrying an innovation principle. Completing
 * a row that holds a problem breaks the problem.
 *
 * Loaded as a plain <script> in the browser (window.BreakthroughEngine) and
 * via require() in Node (tests, server-side score sanity checks).
 *
 * Coordinates: x = column (0 = left), y = row (0 = top of the well). Cells
 * with y < 0 sit in the invisible spawn buffer above the well.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BreakthroughEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLS = 10;
  const ROWS = 20;
  const QUEUE_LENGTH = 5;
  const LOCK_DELAY_MS = 500;
  const MAX_LOCK_RESETS = 15;
  const PROBLEMS_PER_LEVEL = 5;
  const START_PROBLEM_ROWS = 3;

  // ---- Scoring ---------------------------------------------------------------
  const SCORE = {
    softDropCell: 1,
    hardDropCell: 2,
    solutionRow: 10, // × level: "a solution looking for a problem"
    problemBase: 100, // × level
    problemPerExtraGap: 30, // harder (wider) slots are worth more
    perfectMultiplier: 2,
    rightToolMultiplier: 1.5, // the completing solution is one of the problem's bestFits
    comboStep: 50, // × (combo - 1) × level
  };
  // Breaking several problems with one piece multiplies the problem points.
  const MULTI_BREAK = [1, 1, 1.5, 2, 3];

  // ---- Shapes (SRS spawn orientation, y down, in an N×N box) -----------------
  const SHAPES = {
    I: { box: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
    J: { box: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
    L: { box: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
    O: { box: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    S: { box: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
    T: { box: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
    Z: { box: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  };
  const TYPES = Object.keys(SHAPES);

  // rotations[type][rot] = [[x,y] ×4]; clockwise: (x, y) -> (N-1-y, x)
  const ROTATIONS = {};
  for (const t of TYPES) {
    const { box, cells } = SHAPES[t];
    const rots = [cells];
    for (let r = 1; r < 4; r++) rots.push(rots[r - 1].map(([x, y]) => [box - 1 - y, x]));
    ROTATIONS[t] = rots;
  }

  // SRS wall kicks, written y-up as in the usual tables, converted to y-down.
  const KICKS_JLSTZ = {
    '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  };
  const KICKS_I = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  };
  function kicksFor(type, from, to) {
    if (type === 'O') return [[0, 0]];
    const table = type === 'I' ? KICKS_I : KICKS_JLSTZ;
    return table[from + '>' + to].map(([x, y]) => [x, -y]);
  }

  // ---- Speed curve ------------------------------------------------------------
  function gravityMs(level) {
    return Math.max(45, Math.round(1000 * Math.pow(0.82, level - 1)));
  }
  function riseMs(level) {
    return Math.max(3500, 12000 - (level - 1) * 1000);
  }
  function levelFor(problemsSolved) {
    return 1 + Math.floor(problemsSolved / PROBLEMS_PER_LEVEL);
  }

  // ---- Helpers ------------------------------------------------------------------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function emptyRow(cols) {
    return { cells: new Array(cols).fill(null), problem: null };
  }

  const DEFAULT_PROBLEMS = [
    'Data silos', 'Legacy monolith', 'Slow approvals', 'Tech debt', 'Skills gap',
    'Vendor lock-in', 'Manual handoffs', 'Unclear ownership', 'Alert fatigue', 'Shadow IT',
  ].map((label) => ({ label }));
  const DEFAULT_PRINCIPLES = [
    ['Segmentation', 'Divide it into independent parts.'],
    ['Merging', 'Bring identical or related things together.'],
    ['Asymmetry', 'Replace symmetry with deliberate imbalance.'],
    ['Nesting', 'Place one thing inside another.'],
    ['Prior action', 'Do the work in advance.'],
    ['Do it in reverse', 'Invert the action or the process.'],
    ['Feedback', 'Introduce or improve feedback loops.'],
    ['Dynamics', 'Let characteristics change to stay optimal.'],
    ['Universality', 'Make one part do several jobs.'],
    ['Another dimension', 'Move into a new plane or layer.'],
  ].map(([name, hint]) => ({ name, hint }));

  function normalisePrinciple(p) {
    const name = String(p.name || p.label || p);
    const short = String(p.short || p.tag || name.replace(/[^A-Za-z]/g, '').slice(0, 3)).toUpperCase().slice(0, 4);
    return { name, short, hint: p.hint ? String(p.hint) : '' };
  }

  // ---- Game creation ---------------------------------------------------------------
  /**
   * createGame(opts)
   *   problems:   [{label}] problem deck
   *   principles: [{name, short?, hint?}] principle deck
   *   seed:       number (deterministic games for tests)
   *   startProblemRows: problem rows already in the well at the start (default 3)
   *   cols/rows:  well size (default 10×20)
   */
  function createGame(opts = {}) {
    const cols = opts.cols || COLS;
    const rows = opts.rows || ROWS;
    const seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 2 ** 31);
    const problems = (opts.problems && opts.problems.length ? opts.problems : DEFAULT_PROBLEMS)
      .map((p) => ({ label: String(p.label || p), bestFits: Array.isArray(p.bestFits) ? p.bestFits.map(String) : [] }));
    const principles = (opts.principles && opts.principles.length ? opts.principles : DEFAULT_PRINCIPLES)
      .map(normalisePrinciple);

    const g = {
      cols, rows, seed,
      // shown in the report; modes rename "principle" (pattern, technique, ...)
      meta: {
        modeId: opts.modeId || null,
        modeName: opts.modeName || null,
        noun: opts.solutionNoun || 'principle',
        nounPlural: opts.solutionNounPlural || (opts.solutionNoun ? opts.solutionNoun + 's' : 'principles'),
      },
      rng: mulberry32(seed),
      grid: Array.from({ length: rows }, () => emptyRow(cols)),
      problemDeck: problems, problemBag: [],
      principleDeck: principles, principleBag: [],
      pieceBag: [], queue: [], active: null, hold: null, holdUsed: false,
      nextPieceId: 1, nextProblemId: 1, upcomingProblem: null,
      level: 1, score: 0, combo: 0,
      gravityAcc: 0, lockAcc: 0, lockResets: 0, riseAcc: 0,
      over: false, overReason: null,
      events: [],
      stats: {
        solved: [], // {label, principle, perfect, rightTool, level, points}
        principleUse: {}, // principles used to break problems
        piecePrinciples: {}, // every principle placed
        bestCombo: 0, perfectFits: 0, rightTools: 0, solutionRows: 0,
        pieces: 0, problemsRisen: 0, elapsedMs: 0,
      },
    };
    g.upcomingProblem = drawProblem(g);
    const start = opts.startProblemRows != null ? opts.startProblemRows : START_PROBLEM_ROWS;
    for (let i = 0; i < start; i++) insertProblemRow(g);
    fillQueue(g);
    spawn(g);
    g.events.length = 0; // setup noise is not gameplay
    return g;
  }

  function drawProblem(g) {
    if (!g.problemBag.length) g.problemBag = shuffle(g.problemDeck.slice(), g.rng);
    return g.problemBag.pop();
  }
  function drawPrinciple(g) {
    if (!g.principleBag.length) g.principleBag = shuffle(g.principleDeck.slice(), g.rng);
    return g.principleBag.pop();
  }
  function fillQueue(g) {
    while (g.queue.length < QUEUE_LENGTH) {
      if (!g.pieceBag.length) g.pieceBag = shuffle(TYPES.slice(), g.rng); // 7-bag
      g.queue.push({ type: g.pieceBag.pop(), principle: drawPrinciple(g) });
    }
  }

  // ---- Geometry ------------------------------------------------------------------------
  function pieceCells(p) {
    return ROTATIONS[p.type][p.rot].map(([cx, cy]) => [p.x + cx, p.y + cy]);
  }
  function collides(g, p) {
    for (const [x, y] of pieceCells(p)) {
      if (x < 0 || x >= g.cols || y >= g.rows) return true;
      if (y >= 0 && g.grid[y].cells[x]) return true;
    }
    return false;
  }
  function grounded(g) {
    return !!g.active && collides(g, { ...g.active, y: g.active.y + 1 });
  }
  function ghostY(g) {
    if (!g.active) return null;
    let y = g.active.y;
    while (!collides(g, { ...g.active, y: y + 1 })) y++;
    return y;
  }
  /** Labels of problems in the well for which `name` is a best-fit solution. */
  function rightToolFor(g, name) {
    if (!name) return [];
    return g.grid.filter((r) => r.problem && (r.problem.bestFits || []).includes(name)).map((r) => r.problem.label);
  }
  function stackHeight(g) {
    for (let y = 0; y < g.rows; y++) if (g.grid[y].cells.some(Boolean)) return g.rows - y;
    return 0;
  }

  // ---- Spawning --------------------------------------------------------------------------
  function makePiece(g, spec) {
    const box = SHAPES[spec.type].box;
    return {
      id: g.nextPieceId++,
      type: spec.type,
      principle: spec.principle,
      rot: 0,
      x: Math.floor((g.cols - box) / 2),
      y: spec.type === 'I' ? -1 : 0,
    };
  }
  function placeNew(g, piece) {
    g.gravityAcc = 0; g.lockAcc = 0; g.lockResets = 0;
    if (collides(g, piece)) {
      piece.y -= 1; // nudge into the spawn buffer
      if (collides(g, piece)) { g.active = piece; return gameOver(g, 'overwhelmed'); }
    }
    g.active = piece;
    g.events.push({ type: 'spawn', piece: { type: piece.type, principle: piece.principle } });
    return true;
  }
  function spawn(g) {
    const spec = g.queue.shift();
    fillQueue(g);
    g.holdUsed = false;
    return placeNew(g, makePiece(g, spec));
  }

  function gameOver(g, reason) {
    if (g.over) return false;
    g.over = true; g.overReason = reason;
    g.events.push({ type: 'gameOver', reason });
    return false;
  }

  // ---- Problem rows ---------------------------------------------------------------------
  /**
   * Pick the gap columns for a new problem row. Usually a contiguous slot of
   * 1–4 cells; sometimes a slot that completes the problem row above it into a
   * droppable tetromino-shaped pocket (so a single piece can fit it exactly).
   */
  function chooseGaps(g) {
    const cols = g.cols;
    const above = g.grid[g.rows - 1];
    if (above.problem && g.rng() < 0.4) {
      const ag = above.problem.gaps;
      const open = ag.every((c) => !above.cells[c]);
      if (open && ag.length === 3) { const c = ag[Math.floor(g.rng() * 3)]; return [c]; }
      if (open && ag.length === 2) return ag.slice();
    }
    const r = g.rng();
    const n = r < 0.2 ? 1 : r < 0.55 ? 2 : r < 0.85 ? 3 : 4;
    const start = Math.floor(g.rng() * (cols - n + 1));
    return Array.from({ length: n }, (_, i) => start + i);
  }

  /** Push a problem row in at the bottom. Returns false if that overwhelms the player. */
  function insertProblemRow(g, problem, gaps) {
    if (g.over) return false;
    problem = problem || g.upcomingProblem || drawProblem(g);
    if (problem === g.upcomingProblem) g.upcomingProblem = drawProblem(g);
    gaps = (gaps || chooseGaps(g)).slice().sort((a, b) => a - b);
    const top = g.grid[0];
    const row = emptyRow(g.cols);
    const id = g.nextProblemId++;
    row.problem = { id, label: problem.label, gaps, bestFits: problem.bestFits || [], bornLevel: g.level };
    for (let x = 0; x < g.cols; x++) if (!gaps.includes(x)) row.cells[x] = { kind: 'problem', problemId: id };
    g.grid.shift();
    g.grid.push(row);
    g.stats.problemsRisen++;
    g.events.push({ type: 'rise', label: problem.label, gaps });
    if (top.cells.some(Boolean)) return gameOver(g, 'overwhelmed');
    if (g.active && collides(g, g.active)) {
      g.active.y -= 1; // the stack rose under the piece: carry it up with it
    }
    return true;
  }

  // ---- Player actions --------------------------------------------------------------------
  function afterMove(g) {
    if (grounded(g) && g.lockResets < MAX_LOCK_RESETS) { g.lockAcc = 0; g.lockResets++; }
  }
  function move(g, dx) {
    if (g.over || !g.active) return false;
    const p = { ...g.active, x: g.active.x + dx };
    if (collides(g, p)) return false;
    g.active = p;
    afterMove(g);
    g.events.push({ type: 'move' });
    return true;
  }
  function rotate(g, dir) {
    if (g.over || !g.active) return false;
    const from = g.active.rot;
    const to = (from + (dir > 0 ? 1 : 3)) % 4;
    for (const [kx, ky] of kicksFor(g.active.type, from, to)) {
      const p = { ...g.active, rot: to, x: g.active.x + kx, y: g.active.y + ky };
      if (!collides(g, p)) {
        g.active = p;
        afterMove(g);
        g.events.push({ type: 'rotate', kicked: kx !== 0 || ky !== 0 });
        return true;
      }
    }
    return false;
  }
  function softDrop(g) {
    if (g.over || !g.active) return false;
    const p = { ...g.active, y: g.active.y + 1 };
    if (collides(g, p)) return false;
    g.active = p;
    g.gravityAcc = 0;
    g.score += SCORE.softDropCell;
    return true;
  }
  function hardDrop(g) {
    if (g.over || !g.active) return 0;
    const target = ghostY(g);
    const dist = target - g.active.y;
    g.active = { ...g.active, y: target };
    g.score += dist * SCORE.hardDropCell;
    g.events.push({ type: 'hardDrop', distance: dist, cells: pieceCells(g.active), pieceType: g.active.type });
    lockPiece(g);
    return dist;
  }
  function hold(g) {
    if (g.over || !g.active || g.holdUsed) return false;
    const parked = { type: g.active.type, principle: g.active.principle };
    const out = g.hold;
    g.hold = parked;
    g.events.push({ type: 'hold', parked: parked.principle.name });
    if (out) placeNew(g, makePiece(g, out));
    else spawn(g);
    g.holdUsed = true;
    return true;
  }

  // ---- Locking and clearing -------------------------------------------------------------
  function lockPiece(g) {
    const p = g.active;
    if (!p || g.over) return null;
    const cells = pieceCells(p);
    g.active = null;
    g.stats.pieces++;
    const pname = p.principle.name;
    g.stats.piecePrinciples[pname] = (g.stats.piecePrinciples[pname] || 0) + 1;

    let outside = false;
    for (const [x, y] of cells) {
      if (y < 0) { outside = true; continue; }
      g.grid[y].cells[x] = { kind: 'solution', type: p.type, principle: p.principle, pieceId: p.id };
    }
    g.events.push({ type: 'lock', cells, piece: { type: p.type, principle: p.principle } });
    if (outside) { gameOver(g, 'overwhelmed'); return null; }

    const result = clearRows(g, p, cells);
    if (!g.over) spawn(g);
    return result;
  }

  /** Clear full rows after piece `p` locked into `cells`. Returns a summary. */
  function clearRows(g, p, cells) {
    const full = [];
    for (let y = 0; y < g.rows; y++) if (g.grid[y].cells.every(Boolean)) full.push(y);
    const result = { rows: full, breaks: [], solutionRows: 0, points: 0, combo: g.combo };
    if (!full.length) { g.combo = 0; return result; }

    const fullSet = new Set(full);
    const pieceAllCleared = cells.every(([, y]) => fullSet.has(y));
    const cleared = [];
    for (const y of full) {
      const row = g.grid[y];
      cleared.push({ y, cells: row.cells.slice(), problem: row.problem });
      if (row.problem) {
        // Perfect fit: this piece alone filled every gap of the problem, and
        // none of the piece is left over (all its cells cleared with it).
        const byPiece = row.problem.gaps.every((c) => row.cells[c] && row.cells[c].pieceId === p.id);
        const rightTool = (row.problem.bestFits || []).includes(p.principle.name);
        result.breaks.push({ label: row.problem.label, gaps: row.problem.gaps.length, perfect: byPiece && pieceAllCleared, rightTool, bestFits: row.problem.bestFits || [] });
      } else {
        result.solutionRows++;
      }
    }

    const lvl = g.level;
    let problemPoints = 0;
    for (const b of result.breaks) {
      b.points = Math.round((SCORE.problemBase + SCORE.problemPerExtraGap * (b.gaps - 1)) * lvl *
        (b.perfect ? SCORE.perfectMultiplier : 1) * (b.rightTool ? SCORE.rightToolMultiplier : 1));
      problemPoints += b.points;
    }
    const nb = result.breaks.length;
    const multi = MULTI_BREAK[Math.min(nb, MULTI_BREAK.length - 1)];
    problemPoints = Math.round(problemPoints * multi);
    const solutionPoints = result.solutionRows * SCORE.solutionRow * lvl;

    let comboPoints = 0;
    if (nb > 0) {
      g.combo++;
      comboPoints = SCORE.comboStep * (g.combo - 1) * lvl;
      g.stats.bestCombo = Math.max(g.stats.bestCombo, g.combo);
    } else {
      g.combo = 0;
    }
    result.combo = g.combo;
    result.multi = multi;
    result.points = problemPoints + solutionPoints + comboPoints;
    g.score += result.points;

    // Remove the rows (bottom-up indices stay valid if we splice from the end).
    for (let i = full.length - 1; i >= 0; i--) g.grid.splice(full[i], 1);
    while (g.grid.length < g.rows) g.grid.unshift(emptyRow(g.cols));

    g.events.push({ type: 'clear', rows: cleared, solutionRows: result.solutionRows, points: result.points });
    for (const b of result.breaks) {
      g.stats.solved.push({ label: b.label, principle: pn(p), perfect: b.perfect, rightTool: b.rightTool, level: lvl, points: b.points });
      if (b.rightTool) g.stats.rightTools++;
      g.stats.principleUse[pn(p)] = (g.stats.principleUse[pn(p)] || 0) + 1;
      if (b.perfect) g.stats.perfectFits++;
      g.events.push({ type: 'break', label: b.label, principle: pn(p), hint: p.principle.hint, perfect: b.perfect, rightTool: b.rightTool, bestFits: b.bestFits, points: b.points, combo: g.combo });
    }
    if (result.solutionRows) {
      g.stats.solutionRows += result.solutionRows;
      g.events.push({ type: 'solutionRow', count: result.solutionRows, points: solutionPoints });
    }
    if (g.combo >= 2) g.events.push({ type: 'combo', combo: g.combo, points: comboPoints });

    const newLevel = levelFor(g.stats.solved.length);
    if (newLevel > g.level) {
      g.level = newLevel;
      g.events.push({ type: 'levelUp', level: newLevel });
    }
    return result;
  }
  function pn(p) { return p.principle.name; }

  // ---- Time -------------------------------------------------------------------------------
  /** Advance the game by dt milliseconds (gravity, lock delay, rising problems). */
  function update(g, dt) {
    if (g.over) return;
    dt = Math.min(dt, 250); // never simulate a huge jump (tab sleep etc.)
    g.stats.elapsedMs += dt;

    // Problems rise. An empty-of-problems well calls the next one in faster.
    const hasProblem = g.grid.some((r) => r.problem);
    g.riseAcc += hasProblem ? dt : dt * 3;
    if (g.riseAcc >= riseMs(g.level)) {
      g.riseAcc = 0;
      if (!insertProblemRow(g)) return;
    }

    if (!g.active) return;
    if (grounded(g)) {
      g.lockAcc += dt;
      if (g.lockAcc >= LOCK_DELAY_MS) lockPiece(g);
      return;
    }
    g.lockAcc = 0;
    g.gravityAcc += dt;
    const step = gravityMs(g.level);
    while (g.gravityAcc >= step && g.active && !g.over) {
      g.gravityAcc -= step;
      if (collides(g, { ...g.active, y: g.active.y + 1 })) break;
      g.active = { ...g.active, y: g.active.y + 1 };
    }
  }

  function drainEvents(g) {
    const ev = g.events;
    g.events = [];
    return ev;
  }

  // ---- Report & submission --------------------------------------------------------------
  function topPrinciples(g, n = 5) {
    const use = Object.keys(g.stats.principleUse).length ? g.stats.principleUse : g.stats.piecePrinciples;
    return Object.entries(use).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
      .map(([name, count]) => ({ name, count }));
  }

  /** The numbers sent to the server at game over. */
  function summary(g) {
    const top = topPrinciples(g, 1)[0];
    return {
      score: g.score,
      level: g.level,
      problemsSolved: g.stats.solved.length,
      perfectFits: g.stats.perfectFits,
      rightTools: g.stats.rightTools,
      bestCombo: g.stats.bestCombo,
      solutionRows: g.stats.solutionRows,
      pieces: g.stats.pieces,
      durationMs: Math.round(g.stats.elapsedMs),
      topPrinciple: top ? top.name : null,
      mode: g.meta.modeId,
    };
  }

  function fmtDuration(ms) {
    const s = Math.round(ms / 1000);
    return Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's';
  }

  /** Plain-text Innovation report (for the "Copy report" button). */
  function reportText(g, player) {
    const s = summary(g);
    const lines = [];
    const m = g.meta || { noun: 'principle', nounPlural: 'principles' };
    lines.push('BREAKTHROUGH: Innovation report');
    if (m.modeName) lines.push('Mode: ' + m.modeName);
    if (player) lines.push('Innovator: ' + player);
    lines.push('Score ' + s.score.toLocaleString('en-GB') + ' | Level ' + s.level + ' | ' + fmtDuration(s.durationMs));
    lines.push('Problems solved: ' + s.problemsSolved + ' | Perfect fits: ' + s.perfectFits + ' | Right tool: ' + s.rightTools + ' | Best combo: x' + s.bestCombo);
    lines.push('');
    if (g.stats.solved.length) {
      lines.push('Problems solved:');
      for (const x of g.stats.solved) lines.push('  - ' + x.label + ': solved with ' + x.principle + (x.perfect ? ' (perfect fit)' : '') + (x.rightTool ? ' (right tool)' : ''));
    } else {
      lines.push('No problems solved this time. The problems won.');
    }
    const top = topPrinciples(g);
    if (top.length) {
      lines.push('');
      lines.push('Most-used ' + m.nounPlural + ':');
      top.forEach((t, i) => lines.push('  ' + (i + 1) + '. ' + t.name + ' x' + t.count));
    }
    if (s.solutionRows) {
      lines.push('');
      lines.push('Solutions looking for a problem: ' + s.solutionRows + ' row' + (s.solutionRows === 1 ? '' : 's'));
    }
    lines.push('');
    lines.push(g.over ? 'Outcome: Overwhelmed at level ' + s.level + '.' : 'Outcome: still going.');
    return lines.join('\n');
  }

  /**
   * A generous upper bound on the score a game with these stats could reach.
   * Used server-side to reject obviously impossible submissions.
   */
  function maxPlausibleScore(s) {
    const lvl = Math.max(1, s.level);
    const perPieceDrop = (ROWS + 2) * SCORE.hardDropCell;
    const perProblem = (SCORE.problemBase + SCORE.problemPerExtraGap * 3) * lvl * SCORE.perfectMultiplier *
      SCORE.rightToolMultiplier * MULTI_BREAK[4];
    const perCombo = SCORE.comboStep * Math.max(0, s.bestCombo) * lvl;
    return s.pieces * perPieceDrop + s.problemsSolved * (perProblem + perCombo) + s.solutionRows * SCORE.solutionRow * lvl + 1000;
  }

  return {
    COLS, ROWS, SHAPES, TYPES, ROTATIONS, SCORE, PROBLEMS_PER_LEVEL, LOCK_DELAY_MS,
    createGame, update, move, rotate, softDrop, hardDrop, hold, lockPiece, insertProblemRow,
    pieceCells, collides, ghostY, grounded, stackHeight, rightToolFor, drainEvents, kicksFor,
    gravityMs, riseMs, levelFor, summary, reportText, topPrinciples, maxPlausibleScore, mulberry32,
  };
});
