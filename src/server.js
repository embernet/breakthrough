'use strict';
const path = require('node:path');
const express = require('express');
const { loadConfig } = require('./config');
const { openDb } = require('./db');
const { createAuth } = require('./auth');
const { createModes } = require('./modes');
const { validateSubmission, createScores } = require('./scores');
const views = require('./views');
const pkg = require('../package.json');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createApp(config = loadConfig()) {
  const db = openDb(config.dataDir);
  const auth = createAuth({ db, appName: 'Breakthrough', config: config.auth });
  const scores = createScores(db);
  const modes = createModes({ dataDir: config.dataDir, defaultMode: config.defaultMode, log: config.log || console.error });
  if (config.defaultMode && modes.defaultId() !== config.defaultMode) {
    (config.log || console.error)(`modes: DEFAULT_MODE "${config.defaultMode}" is not a loaded mode; using "${modes.defaultId()}"`);
  }
  const lastSubmit = new Map(); // user id -> ms, a light flood guard

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });

  app.get('/healthz', (req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ ok: true, app: config.appName, version: pkg.version });
    } catch (e) {
      res.status(503).json({ ok: false, error: e.message });
    }
  });

  app.use(express.static(PUBLIC_DIR, { index: false, maxAge: '1h' }));
  app.use(auth.attachUser);
  app.use(auth.router);

  app.get('/', auth.requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const list = modes.list();
    const asked = typeof req.query.mode === 'string' ? req.query.mode : '';
    res.type('html').send(views.gamePage({
      user: req.user, portalUrl: config.portalUrl, version: pkg.version,
      modes: list, defaultMode: modes.defaultId(), selectedMode: list.some((m) => m.id === asked) ? asked : '',
    }));
  });

  const api = express.Router();
  api.use(auth.requireUser);
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  // ?mode=<id> picks a mode; missing means the default. Unknown -> 404.
  function modeFrom(req, res) {
    const id = typeof req.query.mode === 'string' && req.query.mode ? req.query.mode : modes.defaultId();
    const mode = modes.get(id);
    if (!mode) res.status(404).json({ error: `unknown mode "${id}"` });
    return mode;
  }
  function modeJson(m) {
    const { id, name, description, solutionNoun, solutionNounPlural, problems, solutions, source } = m;
    return { id, name, description, solutionNoun, solutionNounPlural, source, problems, solutions };
  }

  api.get('/modes', (req, res) => {
    res.json({ default: modes.defaultId(), modes: modes.list() });
  });
  api.get('/modes/:id', (req, res) => {
    const m = modes.get(req.params.id);
    if (!m) return res.status(404).json({ error: `unknown mode "${req.params.id}"` });
    res.json(modeJson(m));
  });
  // older name for the same thing: the active problem + solution decks
  api.get('/decks', (req, res) => {
    const m = modeFrom(req, res);
    if (m) res.json(modeJson(m));
  });

  api.get('/scores', (req, res) => {
    const m = modeFrom(req, res);
    if (m) res.json({ mode: { id: m.id, name: m.name }, ...scores.leaderboard(m.id, req.user, 20) });
  });

  api.post('/scores', express.json({ limit: '8kb' }), (req, res) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'send application/json' });
    const now = Date.now();
    if (now - (lastSubmit.get(req.user.id) || 0) < 2000) return res.status(429).json({ error: 'slow down' });
    const check = validateSubmission(req.body, { isMode: (id) => !!modes.get(id), defaultMode: modes.defaultId() });
    if (!check.ok) return res.status(400).json({ error: check.error });
    if (!check.value.mode) return res.status(400).json({ error: 'unknown mode' });
    lastSubmit.set(req.user.id, now);
    const saved = scores.add(req.user, check.value);
    const m = modes.get(check.value.mode);
    res.status(201).json({ ok: true, ...saved, mode: { id: m.id, name: m.name }, ...scores.leaderboard(m.id, req.user, 20) });
  });

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

  app.use((req, res) => res.status(404).type('text').send('Not found'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    const msg = status >= 500 ? 'internal error' : err.message;
    if (req.originalUrl.startsWith('/api/')) return res.status(status).json({ error: msg });
    res.status(status).type('text').send(msg);
  });

  return { app, db, config, auth, modes };
}

if (require.main === module) {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`FATAL: settings: ${err.message}`);
    process.exit(1);
  }
  const { app, db } = createApp(config);
  const server = app.listen(config.port, config.host, () => {
    const a = config.auth;
    console.log(`breakthrough ${pkg.version} on http://${config.host}:${config.port} (data ${config.dataDir}; login: local=${a.local ? 'on' : 'off'}, sso=${a.sso ? 'on' : 'off'})`);
  });
  const stop = () => server.close(() => { db.close(); process.exit(0); });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = { createApp };
