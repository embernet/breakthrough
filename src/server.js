'use strict';
const path = require('node:path');
const express = require('express');
const { loadConfig } = require('./config');
const { openDb } = require('./db');
const { createAuth } = require('./auth');
const { loadDecks } = require('./decks');
const { validateSubmission, createScores } = require('./scores');
const views = require('./views');
const pkg = require('../package.json');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createApp(config = loadConfig()) {
  const db = openDb(config.dataDir);
  const auth = createAuth({ db, appName: 'Breakthrough', config: config.auth });
  const scores = createScores(db);
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
    res.type('html').send(views.gamePage({ user: req.user, portalUrl: config.portalUrl, version: pkg.version }));
  });

  const api = express.Router();
  api.use(auth.requireUser);
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  api.get('/decks', (req, res) => {
    res.json(loadDecks(config.dataDir));
  });

  api.get('/scores', (req, res) => {
    res.json(scores.leaderboard(req.user, 20));
  });

  api.post('/scores', express.json({ limit: '8kb' }), (req, res) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'send application/json' });
    const now = Date.now();
    if (now - (lastSubmit.get(req.user.id) || 0) < 2000) return res.status(429).json({ error: 'slow down' });
    const check = validateSubmission(req.body);
    if (!check.ok) return res.status(400).json({ error: check.error });
    lastSubmit.set(req.user.id, now);
    const saved = scores.add(req.user, check.value);
    res.status(201).json({ ok: true, ...saved, ...scores.leaderboard(req.user, 20) });
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

  return { app, db, config, auth };
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
