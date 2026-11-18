'use strict';
// STUB — replaced by the shared auth module (local users + TIG-SSO OIDC).
//
// Dev-only "pretend login": /login asks for a display name and keeps it in an
// in-memory session behind a cookie. No passwords, no persistence: a restart
// logs everyone out. Do not run this in prod with other users.
//
// Interface (the shared module keeps exactly this):
//   createAuth({ db, appName, config }) -> { router, attachUser, requireUser }
//     router:      express.Router mounting /login, /local, /auth/callback, /logout
//     attachUser:  middleware setting req.user (or null)
//     requireUser: middleware; HTML requests without a user -> 302 /login?next=<url>,
//                  /api/* -> 401 JSON
//   req.user = { id, username, displayName, source: 'local'|'sso', isAdmin }
//   db is the app's node:sqlite DatabaseSync (auth creates its own auth_* tables).
const crypto = require('node:crypto');
const express = require('express');

function createAuth({ db, appName = 'app', config = {} }) { // eslint-disable-line no-unused-vars
  const COOKIE = `${appName}_stub_sid`;
  const maxAgeMs = (Number(config.sessionDays) || 7) * 86400_000;
  const secure = /^https:/i.test(config.publicUrl || '');
  const sessions = new Map(); // sid -> { user, expires }

  function readCookie(req, name) {
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
    }
    return null;
  }
  function setCookie(res, value, maxAge) {
    res.append('Set-Cookie', [
      `${COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
      `Max-Age=${Math.floor(maxAge / 1000)}`, secure ? 'Secure' : '',
    ].filter(Boolean).join('; '));
  }
  function safeNext(n) {
    return typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function slug(s) {
    return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'player';
  }

  function attachUser(req, res, next) {
    const sid = readCookie(req, COOKIE);
    const s = sid && sessions.get(sid);
    if (s && s.expires > Date.now()) req.user = s.user;
    else {
      if (s) sessions.delete(sid);
      req.user = null;
    }
    next();
  }

  function requireUser(req, res, next) {
    if (req.user) return next();
    if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'login required' });
    return res.redirect(302, '/login?next=' + encodeURIComponent(req.originalUrl));
  }

  function loginPage(next, error) {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Breakthrough</title><link rel="stylesheet" href="/css/app.css"><link rel="icon" href="/favicon.svg"></head>
<body class="login-body"><main class="login-card">
<h1 class="brand">Break<span>through</span></h1>
<p class="muted">Dev sign-in (stub). Pick the name to show on the leaderboard.</p>
${error ? `<p class="error">${esc(error)}</p>` : ''}
<form method="post" action="/login">
<input type="hidden" name="next" value="${esc(next)}">
<label for="displayName">Display name</label>
<input id="displayName" name="displayName" maxlength="40" required autofocus autocomplete="nickname">
<button type="submit" class="btn primary">Start innovating</button>
</form></main></body></html>`;
  }

  const router = express.Router();
  router.use(['/login', '/local'], express.urlencoded({ extended: false, limit: '4kb' }));
  for (const p of ['/login', '/local']) {
    router.get(p, (req, res) => {
      if (req.user) return res.redirect(302, safeNext(req.query.next));
      res.type('html').send(loginPage(safeNext(req.query.next)));
    });
    router.post(p, (req, res) => {
      const name = String((req.body && req.body.displayName) || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      const next = safeNext(req.body && req.body.next);
      if (!name) return res.status(400).type('html').send(loginPage(next, 'Please enter a display name.'));
      const sid = crypto.randomBytes(24).toString('base64url');
      const username = slug(name);
      sessions.set(sid, {
        user: { id: 'stub:' + username, username, displayName: name, source: 'local', isAdmin: false },
        expires: Date.now() + maxAgeMs,
      });
      setCookie(res, sid, maxAgeMs);
      res.redirect(303, next);
    });
  }
  router.get('/auth/callback', (req, res) => res.status(404).send('SSO is not enabled (auth stub).'));
  router.all('/logout', (req, res) => {
    const sid = readCookie(req, COOKIE);
    if (sid) sessions.delete(sid);
    setCookie(res, '', 0);
    res.redirect(303, '/login');
  });

  return { router, attachUser, requireUser };
}

module.exports = { createAuth };
