'use strict';
// Game modes: one YAML file per mode, each defining its problems and solutions.
//
// Built-in modes ship in ./modes. Files in DATA_DIR/modes/ add new modes or
// replace a built-in one with the same `id`. Files are re-checked on each call
// (cheap: re-parsed only when a file's size or mtime changes), so a new mode
// appears without a restart. A file that fails validation is skipped with a
// logged error; it never takes the app down.
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const BUILTIN_DIR = path.join(__dirname, '..', 'modes');
const LIMITS = {
  id: 40,
  name: 40,
  description: 240,
  noun: 24,
  label: 18, // problem label: must fit on a 10-cell row
  note: 140,
  solution: 20, // solution name: shown on the falling piece
  hint: 140,
  minProblems: 5,
  minSolutions: 5,
  maxItems: 500,
  maxBestFits: 3,
};
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const TAG_RE = /^[A-Za-z0-9]{2,4}$/;

const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : typeof v === 'number' ? String(v) : null);

/**
 * Validate one parsed mode document. Returns the normalised mode, or throws
 * an Error whose message lists every problem found.
 */
function validateMode(doc) {
  const errs = [];
  const err = (m) => errs.push(m);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('the file must be a YAML mapping (id:, name:, problems:, solutions:)');

  const need = (key, max) => {
    const v = str(doc[key]);
    if (!v) { err(`\`${key}\` is required`); return ''; }
    if (v.length > max) err(`\`${key}\` is ${v.length} characters (max ${max})`);
    return v;
  };
  const id = need('id', LIMITS.id);
  if (id && !ID_RE.test(id)) err(`\`id\` "${id}" must be lower-case letters, digits and dashes (e.g. my-mode)`);
  const name = need('name', LIMITS.name);
  const description = str(doc.description) || '';
  if (description.length > LIMITS.description) err(`\`description\` is ${description.length} characters (max ${LIMITS.description})`);
  const noun = str(doc.solutionNoun) || 'solution';
  const nounPlural = str(doc.solutionNounPlural) || noun + 's';
  if (noun.length > LIMITS.noun || nounPlural.length > LIMITS.noun) err(`\`solutionNoun\` / \`solutionNounPlural\` max ${LIMITS.noun} characters`);

  // solutions first, so bestFits can be checked against them
  const solutions = [];
  const solNames = new Map(); // lower-case -> canonical
  if (!Array.isArray(doc.solutions)) err('`solutions:` must be a list');
  else {
    if (doc.solutions.length < LIMITS.minSolutions) err(`needs at least ${LIMITS.minSolutions} solutions (has ${doc.solutions.length})`);
    if (doc.solutions.length > LIMITS.maxItems) err(`at most ${LIMITS.maxItems} solutions`);
    doc.solutions.slice(0, LIMITS.maxItems).forEach((s, i) => {
      const at = `solutions[${i}]`;
      if (!s || typeof s !== 'object') return err(`${at} must be a mapping with name, tag and hint`);
      const n = str(s.name);
      if (!n) return err(`${at}: \`name\` is required`);
      const where = `${at} "${n}"`;
      if (n.length > LIMITS.solution) err(`${where}: name is ${n.length} characters (max ${LIMITS.solution})`);
      if (solNames.has(n.toLowerCase())) err(`${where}: duplicate solution name`);
      const tag = str(s.tag);
      if (!tag) err(`${where}: \`tag\` is required (2-4 letters, e.g. STR)`);
      else if (!TAG_RE.test(tag)) err(`${where}: tag "${tag}" must be 2-4 letters or digits`);
      const hint = str(s.hint) || '';
      if (!hint) err(`${where}: \`hint\` is required (one line)`);
      if (hint.length > LIMITS.hint) err(`${where}: hint is ${hint.length} characters (max ${LIMITS.hint})`);
      solNames.set(n.toLowerCase(), n);
      solutions.push({ name: n, short: (tag || '').toUpperCase(), hint });
    });
  }

  const problems = [];
  const labels = new Set();
  if (!Array.isArray(doc.problems)) err('`problems:` must be a list');
  else {
    if (doc.problems.length < LIMITS.minProblems) err(`needs at least ${LIMITS.minProblems} problems (has ${doc.problems.length})`);
    if (doc.problems.length > LIMITS.maxItems) err(`at most ${LIMITS.maxItems} problems`);
    doc.problems.slice(0, LIMITS.maxItems).forEach((p, i) => {
      const at = `problems[${i}]`;
      const o = typeof p === 'string' ? { label: p } : p;
      if (!o || typeof o !== 'object') return err(`${at} must be a label or a mapping with label:`);
      const label = str(o.label);
      if (!label) return err(`${at}: \`label\` is required`);
      const where = `${at} "${label}"`;
      if (label.length > LIMITS.label) err(`${where}: label is ${label.length} characters (max ${LIMITS.label})`);
      if (labels.has(label.toLowerCase())) err(`${where}: duplicate problem label`);
      labels.add(label.toLowerCase());
      const note = str(o.note) || '';
      if (note.length > LIMITS.note) err(`${where}: note is ${note.length} characters (max ${LIMITS.note})`);
      let bestFits = [];
      if (o.bestFits != null) {
        if (!Array.isArray(o.bestFits)) err(`${where}: \`bestFits\` must be a list of solution names`);
        else {
          if (o.bestFits.length < 1 || o.bestFits.length > LIMITS.maxBestFits) err(`${where}: bestFits needs 1-${LIMITS.maxBestFits} names (has ${o.bestFits.length})`);
          for (const b of o.bestFits) {
            const canon = solNames.get(String(str(b) || '').toLowerCase());
            if (!canon) err(`${where}: bestFits "${b}" is not one of this mode's solutions`);
            else if (!bestFits.includes(canon)) bestFits.push(canon);
          }
        }
      }
      problems.push({ label, note, bestFits });
    });
  }

  if (errs.length) {
    const e = new Error(errs.length + ' problem' + (errs.length === 1 ? '' : 's') + ':\n  - ' + errs.join('\n  - '));
    e.issues = errs;
    throw e;
  }
  return { id, name, description, solutionNoun: noun, solutionNounPlural: nounPlural, problems, solutions };
}

function listYaml(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((f) => /\.ya?ml$/i.test(f))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return []; // dir missing: fine
  }
}

function signature(files) {
  return files.map((f) => {
    try { const s = fs.statSync(f); return `${f}:${s.size}:${s.mtimeMs}`; } catch { return f + ':gone'; }
  }).join('|');
}

/**
 * createModes({ dataDir, defaultMode, log }) -> registry
 *   registry.all()       -> { modes: Map(id -> mode), errors: [{file, message}] }
 *   registry.list()      -> [{id, name, description, ...}] in display order
 *   registry.get(id)     -> mode | null
 *   registry.defaultId() -> the configured default if loaded, else a fallback
 */
function createModes({ dataDir, defaultMode = 'software-engineering', log = console.error, builtinDir = BUILTIN_DIR } = {}) {
  let cache = { sig: null, value: null };
  const dataModes = dataDir ? path.join(dataDir, 'modes') : null;

  function load() {
    const builtin = listYaml(builtinDir);
    const extra = dataModes ? listYaml(dataModes) : [];
    const sig = signature(builtin) + '#' + signature(extra);
    if (cache.sig === sig) return cache.value;

    const modes = new Map();
    const errors = [];
    const read = (file, source) => {
      const rel = source === 'data' ? path.join('DATA_DIR/modes', path.basename(file)) : path.join('modes', path.basename(file));
      try {
        const doc = yaml.load(fs.readFileSync(file, 'utf8'), { schema: yaml.CORE_SCHEMA, filename: rel });
        const mode = validateMode(doc);
        const prev = modes.get(mode.id);
        if (prev && prev.source === source) {
          errors.push({ file: rel, message: `duplicate id "${mode.id}" (also in ${prev.file}); skipped` });
          return;
        }
        modes.set(mode.id, { ...mode, source, file: rel });
      } catch (e) {
        errors.push({ file: rel, message: e.message });
      }
    };
    for (const f of builtin) read(f, 'built-in');
    for (const f of extra) read(f, 'data');
    for (const e of errors) log(`modes: skipping ${e.file}: ${e.message}`);
    if (!modes.size) log('modes: no valid mode files found; the game falls back to its tiny built-in deck');
    cache = { sig, value: { modes, errors } };
    return cache.value;
  }

  // Display order: the default first, then the others by name.
  function list() {
    const { modes } = load();
    const def = defaultId();
    return [...modes.values()]
      .sort((a, b) => (a.id === def ? -1 : b.id === def ? 1 : a.name.localeCompare(b.name)))
      .map(({ id, name, description, solutionNoun, solutionNounPlural, source, problems, solutions }) =>
        ({ id, name, description, solutionNoun, solutionNounPlural, source, problems: problems.length, solutions: solutions.length }));
  }
  function get(id) {
    return load().modes.get(String(id || '')) || null;
  }
  function defaultId() {
    const { modes } = load();
    if (modes.has(defaultMode)) return defaultMode;
    if (modes.has('software-engineering')) return 'software-engineering';
    return modes.size ? [...modes.keys()].sort()[0] : null;
  }
  return { all: load, list, get, defaultId };
}

module.exports = { createModes, validateMode, LIMITS };
