'use strict';
// Problem and principle decks (YAML). Defaults ship in ./decks; a file of the
// same name in DATA_DIR/decks/ overrides it. Files are re-read on each request,
// so a workshop deck can be dropped in without a restart.
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const DEFAULT_DIR = path.join(__dirname, '..', 'decks');
const MAX_LABEL = 18;
const MAX_ITEMS = 500;

function clip(s, n) {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

function readYaml(file) {
  return yaml.load(fs.readFileSync(file, 'utf8'), { schema: yaml.CORE_SCHEMA });
}

function pickFile(dataDir, name) {
  const override = dataDir && path.join(dataDir, 'decks', name);
  if (override && fs.existsSync(override)) return { file: override, source: 'data' };
  return { file: path.join(DEFAULT_DIR, name), source: 'default' };
}

function parseProblems(doc) {
  const list = Array.isArray(doc) ? doc : doc && doc.problems;
  if (!Array.isArray(list)) throw new Error('expected a `problems:` list');
  const items = list.slice(0, MAX_ITEMS).map((p) => {
    const o = typeof p === 'object' && p ? p : { label: p };
    return { label: clip(o.label, MAX_LABEL), note: o.note ? clip(o.note, 140) : '' };
  }).filter((p) => p.label);
  if (!items.length) throw new Error('deck has no problems');
  return { name: clip((doc && doc.name) || 'Problems', 60), items };
}

function parsePrinciples(doc) {
  const list = Array.isArray(doc) ? doc : doc && doc.principles;
  if (!Array.isArray(list)) throw new Error('expected a `principles:` list');
  const items = list.slice(0, MAX_ITEMS).map((p) => {
    const o = typeof p === 'object' && p ? p : { name: p };
    const name = clip(o.name, MAX_LABEL);
    return {
      name,
      short: clip(o.short || name.replace(/[^A-Za-z]/g, '').slice(0, 3), 4).toUpperCase(),
      hint: o.hint ? clip(o.hint, 140) : '',
      number: Number.isInteger(o.number) ? o.number : null,
    };
  }).filter((p) => p.name);
  if (!items.length) throw new Error('deck has no principles');
  return { name: clip((doc && doc.name) || 'Principles', 60), items };
}

function loadOne(dataDir, fileName, parse, log) {
  const pick = pickFile(dataDir, fileName);
  try {
    return { ...parse(readYaml(pick.file)), source: pick.source };
  } catch (e) {
    if (pick.source === 'default') throw e;
    log(`decks: ignoring ${pick.file}: ${e.message}; using the default deck`);
    return { ...parse(readYaml(path.join(DEFAULT_DIR, fileName))), source: 'default' };
  }
}

function loadDecks(dataDir, log = console.warn) {
  return {
    problems: loadOne(dataDir, 'problems.yaml', parseProblems, log),
    principles: loadOne(dataDir, 'principles.yaml', parsePrinciples, log),
  };
}

module.exports = { loadDecks, parseProblems, parsePrinciples, MAX_LABEL };
