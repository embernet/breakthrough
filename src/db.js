'use strict';
// The app's SQLite database (built-in node:sqlite, no native deps).
// Scores live here; the auth module adds its own auth_* tables.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_FILE = 'breakthrough.db';

function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, DB_FILE));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

const MIGRATIONS = [
  `CREATE TABLE scores (
     id              INTEGER PRIMARY KEY,
     user_id         TEXT    NOT NULL,
     display_name    TEXT    NOT NULL,
     score           INTEGER NOT NULL,
     level           INTEGER NOT NULL,
     problems_solved INTEGER NOT NULL,
     perfect_fits    INTEGER NOT NULL,
     best_combo      INTEGER NOT NULL,
     solution_rows   INTEGER NOT NULL,
     pieces          INTEGER NOT NULL,
     duration_ms     INTEGER NOT NULL,
     top_principle   TEXT,
     created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
   );
   CREATE INDEX scores_user ON scores(user_id, score DESC);
   CREATE INDEX scores_score ON scores(score DESC);`,
  // v2: per-mode leaderboards. Games played before modes existed were TRIZ.
  `ALTER TABLE scores ADD COLUMN mode TEXT NOT NULL DEFAULT 'innovation';
   ALTER TABLE scores ADD COLUMN right_tools INTEGER NOT NULL DEFAULT 0;
   CREATE INDEX scores_mode_user ON scores(mode, user_id, score DESC);
   CREATE INDEX scores_mode_score ON scores(mode, score DESC);`,
];

function migrate(db) {
  const v = db.prepare('PRAGMA user_version').get().user_version;
  for (let i = v; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

module.exports = { openDb, migrate, MIGRATIONS, DB_FILE };
