const fs = require('node:fs');
const path = require('node:path');
const capture = process.env.E1_CAPTURE_ROOT || path.resolve(__dirname, '../../outputs/claude-desktop-decomp');
const ion = path.join(capture, 'full/original/Claude.app/Contents/Resources/ion-dist');
const available = fs.existsSync(path.join(ion, 'assets/v1/shared-frame-mKeNK6Hi.js'));

// Native integration tests use the user's local capture, never distributed assets.
async function nativeFixture(page, body) {
  await page.route('https://native.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html data-theme="claude" data-mode="light"><head></head><body></body></html>' });
    const injected={'/assets/v1/e1-model-browser.js':'native-model-browser.js','/assets/v1/e1-model-list.js':'model-list.js'};
    if(injected[pathname]) return route.fulfill({path:path.resolve(__dirname,'../src',injected[pathname]),contentType:'text/javascript'});
    const file = path.join(ion, pathname);
    if (!file.startsWith(ion + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    await route.fulfill({ path: file, contentType: pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : undefined });
  });
  await page.goto('https://native.test/');
  const html = fs.readFileSync(path.join(ion, 'index.html'), 'utf8');
  for (const match of html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)) await page.addStyleTag({ url: match[1] });
  await page.addStyleTag({ path: path.resolve(__dirname, '../src/recovered-theme.css') });
  await page.evaluate(body => document.body.innerHTML = body, body);
  await page.addScriptTag({ path: path.resolve(__dirname, '../src/model-list.js') });
  await page.addScriptTag({ path: path.resolve(__dirname, '../src/native-preferences-dialog.js') });
}
async function choose(page, label, option) {
  await page.getByRole('combobox', { name: new RegExp('^' + label + ' ') }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
module.exports = { nativeFixture, choose, available };
