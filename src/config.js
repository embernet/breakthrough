'use strict';
// Configuration from the environment. Everything (including the login
// standard's AUTH_* / SSO_* / SESSION_DAYS settings) is passed to createAuth as
// `config`, so the shared auth module can read what it needs from here.
const path = require('node:path');

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
    portalUrl: trimSlash(env.PORTAL_URL),
    trustProxy: env.TRUST_PROXY || '',
    // Login standard (see horizon-infra design, section 2). The stub ignores
    // these; the shared auth module uses them.
    authLocal: (env.AUTH_LOCAL || 'on').toLowerCase() !== 'off',
    authSso: (env.AUTH_SSO || 'off').toLowerCase() === 'on',
    ssoIssuer: env.SSO_ISSUER || 'https://tig-sso.grlab.co.uk/realms/tig',
    ssoClientId: env.SSO_CLIENT_ID || '',
    ssoClientSecret: env.SSO_CLIENT_SECRET || '',
    ssoAdminGroup: env.SSO_ADMIN_GROUP || '',
    sessionDays: Number(env.SESSION_DAYS || 7),
    env: { ...env },
  };
}

module.exports = { loadConfig };
