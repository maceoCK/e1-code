const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function authPage(status, message) {
  const nonce = crypto.randomBytes(18).toString('base64');
  const logo = fs.readFileSync(path.join(__dirname, 'ui/logo.svg')).toString('base64');
  const success = status === 200;
  return { nonce, html: `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>E1 Code · ${success ? 'Connected' : 'Sign-in incomplete'}</title><style nonce="${nonce}">
  :root{color-scheme:light dark;font-family:system-ui,sans-serif;color:#263e38;background:#f1f3ef}body{margin:0;min-height:100dvh;display:grid;place-items:center}main{box-sizing:border-box;max-width:480px;margin:24px;padding:36px;border:1px solid #d7ded6;border-radius:16px;background:#fbfcf9}img{width:42px;height:42px}header{display:flex;align-items:center;gap:14px;font-size:17px;font-weight:600}h1{font-size:24px;letter-spacing:-.4px;margin:32px 0 14px}p{font-size:14px;line-height:1.7;color:#66776d}.note{border-top:1px solid #d7ded6;padding-top:18px;margin-top:24px;font-size:12px}@media(prefers-color-scheme:dark){:root{background:#202c29;color:#e5ede5}main{background:#293732;border-color:#3b4c44}p{color:#b1c3b7}.note{border-color:#3b4c44}}
  </style><main><header><img src="data:image/svg+xml;base64,${logo}" alt="">E1 Code</header><h1>${success ? 'Your account is connected' : 'Sign-in incomplete'}</h1><p>${escape(message)}</p><p class="note">${success ? 'Close this tab and return to Accounts &amp; billing in E1 Code.' : 'Return to E1 Code and choose Continue with ChatGPT to try again.'}</p></main><script nonce="${nonce}">history.replaceState(null,'','/auth/callback');</script></html>` };
}
module.exports = { authPage };
