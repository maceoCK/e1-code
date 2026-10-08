const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');
const { patch } = require('../scripts/patch-title-renderer.cjs');

// The recovered secondary-pane behavior, isolated from the rest of the client.
const guard = `window.pinTitle = () => {
  let t=document.title,r=document.head,i=new(Me(r))(() => {
    if (document.title !== t) document.title = t;
  });
  i.observe(r, { childList: true, subtree: true, characterData: true });
  return () => i.disconnect();
};`;

test('title patch rejects missing or ambiguous native guards', () => {
  assert.throws(() => patch('different client'), /title guard changed/);
  assert.throws(() => patch(guard + guard), /title guard changed/);
});

test('secondary-pane title pinning settles with branding and leaves input responsive', { timeout: 15000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const fixed of [false, true]) {
      const page = await browser.newPage();
      await page.route('http://title.test/**', route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ mark: 'M0 0 L10 0 L0 10Z', viewBox: '0 0 10 10', sprites: {} }),
      }));
      await page.goto('http://title.test/');
      await page.setContent('<title>E1 Code</title><input aria-label="Prompt"><button>Switch chat</button>');
      await page.evaluate(() => {
        window.guardCallbacks = 0;
        window.runaway = false;
        // Bound the old failure so this regression test cannot hang Chromium.
        window.Me = () => class extends MutationObserver {
          constructor(callback) {
            super((...args) => {
              if (++window.guardCallbacks > 100) { window.runaway = true; this.disconnect(); return; }
              callback(...args);
            });
          }
        };
      });
      await page.addScriptTag({ path: path.resolve(__dirname, '../src/recovered-branding.js') });
      await page.addScriptTag({ content: fixed ? patch(guard) : guard });
      for (const title of fixed
        ? ['Account check JSON summary - Claude Code', 'Account check JSON file - Claude Code', 'Different chat - Aster', 'Account check JSON summary - Claude Code']
        : ['Account check JSON summary - Claude Code']) {
        await page.evaluate(title => {
          window.unpin?.();
          document.title = title;
          window.unpin = window.pinTitle();
        }, title);
        await page.waitForFunction(() => document.title.endsWith('E1 Code'));
        await page.getByRole('textbox', { name: 'Prompt' }).fill('still responsive');
        await page.getByRole('button', { name: 'Switch chat' }).click();
        const settled = await page.evaluate(async () => {
          const before = window.guardCallbacks;
          await new Promise(resolve => setTimeout(resolve, 100));
          return { before, after: window.guardCallbacks, runaway: window.runaway, title: document.title };
        });
        assert.equal(settled.runaway, !fixed, 'the fixture must reproduce the old loop and reject it after the fix');
        assert.equal(settled.before, settled.after, 'title observers must stop generating work');
        if (fixed) assert.equal(settled.title, title.replace(/\b(?:Claude|Aster)(?: Code)?(?=$| [—–-])/g, 'E1 Code'));
      }
      await page.close();
    }
  } finally { await browser.close(); }
});
