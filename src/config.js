'use strict';
// Configuration from the environment. The login settings (AUTH_* / SSO_* /
// SESSION_DAYS / LOCAL_ADMIN_USERS) are parsed by src/auth/config.js.
const path = require('node:path');
const { loadAuthConfig } = require('./auth/config');

function trimSlash(u) {
  return u ? String(u).replace(/\/+$/, '') : '';
}

function loadConfig(env = process.env) {
  const port = Number(env.PORT || 8195);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('PORT must be a TCP port, got ' + env.PORT);
  return {
    appName: 'breakthrough',
    port,
    host: env.HOST || '0.0.0.0',
    dataDir: path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data')),
    publicUrl: trimSlash(env.PUBLIC_URL),
    // Optional suite portal link (suite-integration standard): shown only when both are set.
    portalUrl: trimSlash(env.PORTAL_URL),
    portalName: String(env.PORTAL_NAME || '').trim().slice(0, 40),
    trustProxy: env.TRUST_PROXY || '',
    // Game mode shown first and used when the viewer hasn't picked one (modes/*.yaml id).
    defaultMode: (env.DEFAULT_MODE || 'software-engineering').trim(),
    // Login settings, read by the shared auth module (src/auth/README.md).
    // Throws on impossible settings (both modes off, SSO without a client ID, ...).
    auth: loadAuthConfig(env),
  };
}

module.exports = { loadConfig };
