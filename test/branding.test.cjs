const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
test('branding follows each pane model, preserves messages, and remains stable', async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('http://branding.test/**', route => route.fulfill({contentType:'application/json', body:JSON.stringify({mark:'M0 0 L10 0 L0 10Z',viewBox:'0 0 10 10',sprites:{}})}));
    await page.goto('http://branding.test/');
    await page.setContent(`<title>Example - Claude Code</title>
      <div aria-label="Sidebar"><span id="sidebar">Claude is working</span></div>
      <section id="one"><button data-testid="epitaxy-cds-model-selector" aria-label="Model: OpenAI · gpt-5.4-mini">gpt-5.4-mini</button>
      <div aria-label="Chat messages"><div data-turn-working="true" id="wait">12s · Waiting for Claude…</div><p id="user">Claude is working</p><pre>Claude is working</pre></div>
      <div id="work" role="status">Claude is working</div><button id="aria" aria-label="Claude is responding"></button>
      <textarea>Claude is working</textarea></section>
      <section id="two"><button data-testid="model-selector-dropdown" aria-label="Model: Ollama · qwen3.5:9b">qwen3.5:9b</button><div id="second" role="status">Claude is working</div></section>
      <svg data-cds="ClaudeLogo"><path d="M0 0"/><path d="M0 0"/></svg>`);
    await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../src/recovered-branding.js'),'utf8')});
    await page.waitForFunction(() => document.querySelector('#work').textContent === 'OpenAI · gpt-5.4-mini is working');
    assert.equal(await page.title(), 'Example - E1 Code');
    assert.equal(await page.locator('#wait').textContent(), '12s · Waiting for OpenAI · gpt-5.4-mini…');
    assert.equal(await page.locator('#second').textContent(), 'Ollama · qwen3.5:9b is working');
    assert.equal(await page.locator('#sidebar').textContent(), 'The model is working');
    assert.equal(await page.locator('#user').textContent(), 'Claude is working');
    assert.equal(await page.locator('textarea').inputValue(), 'Claude is working');
    assert.equal(await page.locator('[data-aster-wordmark]').textContent(), 'E1 Code');
    await page.locator('#one button').first().evaluate(el => el.setAttribute('aria-label','Model: Anthropic · Claude Sonnet'));
    await page.waitForFunction(() => document.querySelector('#work').textContent === 'Anthropic · Claude Sonnet is working');
    assert.equal(await page.locator('#aria').getAttribute('aria-label'), 'Anthropic · Claude Sonnet is responding');
    await page.locator('#one button').first().evaluate(el => el.remove());
    await page.waitForFunction(() => document.querySelector('#work').textContent === 'The model is working');
    assert.equal(await page.locator('#aria').getAttribute('aria-label'), 'The model is responding');
    // A missing picker in one pane must not borrow the sibling pane model.
    assert.equal(await page.locator('#user').textContent(), 'Claude is working');
    await page.evaluate(() => { window.mutations=0; new MutationObserver(r => window.mutations += r.length).observe(document,{subtree:true,attributes:true,childList:true,characterData:true}); });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await page.evaluate(() => window.mutations), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
