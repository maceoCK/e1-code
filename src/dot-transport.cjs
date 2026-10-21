const { createHash } = require('node:crypto');

// Dot uses the desktop network stack. Node fetch does not behave equivalently
// on these routes. No BrowserWindow, website sign-in or borrowed cookies are used.
function createDotTransport({ app, session }, electronVersion = process.versions.electron) {
  const sessions = new Map();
  return async (accountId, url, options) => {
    const target = new URL(url);
    const backend = target.origin === 'https://chatgpt.com' && target.pathname.startsWith('/backend-api/');
    const history = target.origin === 'https://codex-cloud-backend.chatgpt.com' && (options.method || 'GET') === 'GET' && /^\/v[12]\/threads\/[\w~-]+(?:\/turns)?$/.test(target.pathname);
    const avatar = target.protocol === 'https:' && target.hostname.endsWith('.oaiusercontent.com') && (options.method || 'GET') === 'GET';
    // ChatGPT build 20770 negotiates the Dot computer stream (SDP offer) here.
    const computer = target.origin === 'https://realtime.chatgpt.com' && target.pathname === '/v1/cua' && options.method === 'POST';
    if ((!backend && !history && !avatar && !computer) || target.username || target.password)
      throw Error('Invalid Dot service URL.');
    if (typeof accountId !== 'string' || !accountId)
      throw Error('A Dot account is required.');
    await app.whenReady();
    let connection = sessions.get(accountId);
    if (!connection) {
      const key = createHash('sha256').update(accountId).digest('hex');
      connection = session.fromPartition('e1-dot-network-' + key, { cache: false });
      connection.setUserAgent(`E1Code/${app.getVersion()} Electron/${electronVersion}`);
      sessions.set(accountId, connection);
    }
    // Token-only requests keep website cookies out of subscription switching.
    return connection.fetch(target.href, { ...options, ...(avatar ? {headers:{}} : {}), credentials: 'omit', redirect: 'error' });
  };
}

module.exports = { createDotTransport };
