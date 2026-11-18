'use strict';
// Scores: validation of submitted games and the leaderboard.
const engine = require('../public/js/engine.js');

const LIMITS = {
  score: [0, 100_000_000],
  level: [1, 999],
  problemsSolved: [0, 100_000],
  perfectFits: [0, 100_000],
  bestCombo: [0, 100_000],
  solutionRows: [0, 1_000_000],
  pieces: [0, 1_000_000],
  durationMs: [0, 24 * 3600 * 1000],
};

/**
 * Check a submitted game for sanity. It's a game, not a bank: the aim is to
 * keep junk and obvious fabrications off the leaderboard, not to stop a
 * determined cheat. Returns { ok: true, value } or { ok: false, error }.
 */
function validateSubmission(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('expected a JSON object');
  const v = {};
  for (const [k, [min, max]] of Object.entries(LIMITS)) {
    const n = body[k];
    if (!Number.isSafeInteger(n)) return fail(`${k} must be an integer`);
    if (n < min || n > max) return fail(`${k} out of range`);
    v[k] = n;
  }
  if (v.perfectFits > v.problemsSolved) return fail('more perfect fits than problems solved');
  if (v.bestCombo > v.problemsSolved) return fail('combo longer than problems solved');
  if (v.problemsSolved > v.pieces * 4) return fail('too many problems for the pieces placed');
  if (v.solutionRows > v.pieces * 4) return fail('too many rows for the pieces placed');
  if (v.level !== engine.levelFor(v.problemsSolved)) return fail('level does not match problems solved');
  // nobody places more than ~20 pieces a second for a whole game
  if (v.pieces > 20 + v.durationMs / 50) return fail('too many pieces for the time played');
  if (v.score > engine.maxPlausibleScore(v)) return fail('score is not plausible for this game');
  const tp = body.topPrinciple;
  if (tp != null && typeof tp !== 'string') return fail('topPrinciple must be a string');
  v.topPrinciple = tp ? tp.trim().slice(0, 40) || null : null;
  return { ok: true, value: v };
}
function fail(error) {
  return { ok: false, error };
}

function createScores(db) {
  const insert = db.prepare(`INSERT INTO scores
    (user_id, display_name, score, level, problems_solved, perfect_fits, best_combo, solution_rows, pieces, duration_ms, top_principle)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  // One row per player: their best game (SQLite returns the max row's columns).
  const top = db.prepare(`SELECT user_id, display_name, MAX(score) AS score, level, problems_solved,
      perfect_fits, best_combo, top_principle, created_at
    FROM scores GROUP BY user_id ORDER BY score DESC, MIN(id) ASC LIMIT ?`);
  const best = db.prepare(`SELECT score, level, problems_solved, perfect_fits, best_combo, top_principle, created_at
    FROM scores WHERE user_id = ? ORDER BY score DESC, id ASC LIMIT 1`);
  const rankOf = db.prepare(`SELECT COUNT(*) AS n FROM
    (SELECT MAX(score) AS s FROM scores GROUP BY user_id) WHERE s > ?`);
  const games = db.prepare('SELECT COUNT(*) AS n FROM scores WHERE user_id = ?');

  function shape(r) {
    return r && {
      displayName: r.display_name,
      score: r.score,
      level: r.level,
      problemsSolved: r.problems_solved,
      perfectFits: r.perfect_fits,
      bestCombo: r.best_combo,
      topPrinciple: r.top_principle,
      at: r.created_at,
    };
  }

  function myBest(user) {
    const r = best.get(user.id);
    if (!r) return null;
    return { ...shape({ ...r, display_name: user.displayName }), rank: rankOf.get(r.score).n + 1, games: games.get(user.id).n };
  }

  return {
    add(user, v) {
      const prev = best.get(user.id);
      const info = insert.run(user.id, String(user.displayName || user.username).slice(0, 60), v.score, v.level,
        v.problemsSolved, v.perfectFits, v.bestCombo, v.solutionRows, v.pieces, v.durationMs, v.topPrinciple);
      return {
        id: Number(info.lastInsertRowid),
        personalBest: !prev || v.score > prev.score,
        rank: rankOf.get(v.score).n + 1,
      };
    },
    leaderboard(user, limit = 20) {
      const rows = top.all(limit).map((r, i) => ({ rank: i + 1, ...shape(r), isMe: !!user && r.user_id === user.id }));
      return { top: rows, me: user ? myBest(user) : null };
    },
  };
}

module.exports = { validateSubmission, createScores, LIMITS };
