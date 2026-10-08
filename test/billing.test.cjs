const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { requestScope, BillingState } = require('../src/billing-state.cjs');
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
const fixture = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-billing-'));
  const sessions = path.join(dir, 'claude-code-sessions/account/org'); fs.mkdirSync(sessions, { recursive: true });
  for (const id of [a, b]) fs.writeFileSync(path.join(sessions, `local_${id}.json`), JSON.stringify({ sessionId: `local_${id}`, cliSessionId: id }));
  return { dir, state: new BillingState({ profile: dir, file: path.join(dir, 'billing.json') }) };
};
test('billing correlation reads only session and parent IDs, including older CLI metadata', () => {
  assert.deepEqual(requestScope({ metadata: { user_id: JSON.stringify({ device_id: 'private', account_uuid: 'private', session_id: a, parent_session_id: b }) } }), { session_id: a, parent_session_id: b });
  assert.deepEqual(requestScope({ metadata: { user_id: `user_private_account_private_session_${a}` } }), { session_id: a });
  assert.deepEqual(requestScope({ metadata: { user_id: 'unrelated' } }), {});
});
test('concurrent chats, fallback, late completions, child requests and restart stay isolated', () => {
  const { dir, state } = fixture();
  try {
    const event = (id, requestId, billing, phase = 'running') => ({ requestId, scope: { session_id: id }, billing, phase, selectedModel: 'model-' + id });
    state.update(event(a, 'api-a', 'api')); state.update(event(b, 'plan-b', 'subscription'));
    assert.deepEqual(state.snapshot().map(s => [s.chatId, s.billing, s.running]), [[`local_${a}`, 'api', true], [`local_${b}`, 'subscription', true]]);
    state.update(event(a, 'api-a', 'api', 'finished'));
    assert.equal(state.snapshot().find(s => s.chatId === `local_${b}`).running, true);
    state.update(event(b, 'fallback-b', 'api'));
    state.update(event(b, 'plan-b', 'subscription', 'finished'));
    assert.equal(state.snapshot().find(s => s.chatId === `local_${b}`).billing, 'api');
    state.update(event(b, 'fallback-b', 'api', 'finished'));
    assert.equal(state.snapshot().find(s => s.chatId === `local_${b}`).billing, 'api');
    const before = state.snapshot(); state.update({ requestId: 'startup', billing: 'api', phase: 'running' });
    assert.deepEqual(state.snapshot(), before);
    state.update({ ...event('33333333-3333-4333-8333-333333333333', 'child', 'subscription'), scope: { parent_session_id: a } });
    assert.equal(state.snapshot().find(s => s.chatId === `local_${a}`).billing, 'subscription');
    const restored = new BillingState({ profile: dir, file: path.join(dir, 'billing.json') });
    assert.equal(restored.snapshot().every(s => !s.running), true);
    assert.equal(restored.snapshot().find(s => s.chatId === `local_${b}`).billing, 'api');
  } finally { fs.rmSync(dir, { recursive: true }); }
});
test('model and sidebar billing remain scoped across split panes, switches and remounts', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('http://billing.test/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ mark: 'M0 0L10 0L0 10Z', viewBox: '0 0 10 10', sprites: {} }) }));
    await page.goto('http://billing.test/');
    await page.setContent(`<div class="dframe-sidebar" aria-label="Sidebar">
      <div data-row-key="code:local_${a}"><button id="row-a" data-row-main-button>API chat</button></div>
      <div data-row-key="code:local_${b}"><button id="row-b" data-row-main-button>Plan chat</button></div>
    </div><div class="dframe-pane"><div data-session-id="local_${a}"><button id="model-a" data-testid="epitaxy-cds-model-selector" aria-label="Model: OpenAI · GPT">GPT</button><button>Effort: High</button></div></div>
      <div class="dframe-pane"><div data-session-id="local_${b}"><button id="model-b" data-testid="epitaxy-cds-model-selector" aria-label="Model: Claude Max · Sonnet">Sonnet</button></div></div>`);
    await page.addScriptTag({ path: path.join(__dirname, '../src/recovered-branding.js') });
    await page.addScriptTag({ path: path.join(__dirname, '../src/billing-indicator.js') });
    const state = { version: 2, catalog: [ { id: 'api', name: 'OpenAI · GPT', prediction: { billing: 'api', label: 'OpenAI' } }, { id: 'sub', name: 'Claude Max · Sonnet', prediction: { billing: 'subscription', label: 'Claude Max' } } ], chats: [ { chatId: `local_${a}`, billing: 'api', label: 'OpenAI', selectedModel: 'api', running: true }, { chatId: `local_${b}`, billing: 'subscription', label: 'Claude Max', selectedModel: 'sub', running: true } ] };
    const send = () => page.evaluate(s => window.dispatchEvent(new CustomEvent('e1-billing-status', { detail: s })), state);
    await send(); await page.waitForFunction(() => document.querySelectorAll('.e1-billing-chip').length === 4);
    assert.equal(await page.locator('#model-a').getAttribute('data-e1-billing'), 'api');
    assert.equal(await page.locator('#model-b').getAttribute('data-e1-billing'), 'subscription');
    assert.equal(await page.locator('#row-a .e1-billing-chip').innerText(), 'API');
    assert.equal(await page.locator('#row-b .e1-billing-chip').innerText(), 'Plan');
    assert.equal(await page.locator('#e1-api-billing-border').count(), 0);
    Object.assign(state.chats[1],{planName:'Claude Max',accountLabel:'Personal Max',accountEmail:'first@example.test',model:'claude-sonnet-5-5'});
    await send();
    await page.waitForFunction(()=>document.querySelector('#model-b + .e1-billing-chip')?.getAttribute('aria-label').includes('first@example.test'));
    const planChip=page.locator('#model-b + .e1-billing-chip'), tooltip=page.getByRole('tooltip');
    await planChip.hover();
    assert.match(await tooltip.innerText(),/Claude Max\nUsing now\nAccount: Personal Max\nfirst@example.test\nModel: claude-sonnet-5-5/);
    Object.assign(state.chats[1],{accountLabel:'Second Max',accountEmail:'second@example.test',fallback:true});
    await send();
    await page.waitForFunction(()=>document.querySelector('#e1-billing-tooltip').textContent.includes('second@example.test'));
    assert.match(await tooltip.innerText(),/automatic fallback/);
    assert.doesNotMatch(await tooltip.innerText(),/first@example.test/);
    await page.mouse.move(900,700);
    assert.equal(await tooltip.isVisible(),false);
    await planChip.focus(); assert.equal(await tooltip.isVisible(),true);
    await page.keyboard.press('Escape'); assert.equal(await tooltip.isVisible(),false);
    state.chats[0].running = false; await send();
    await page.waitForFunction(() => !document.querySelector('#row-a .e1-billing-chip'));
    assert.equal(await page.locator('#row-b .e1-billing-chip').innerText(), 'Plan');
    await page.locator('#model-a').evaluate(el => el.setAttribute('aria-label', 'Model: Claude Max · Sonnet'));
    await page.waitForFunction(() => document.querySelector('#model-a').dataset.e1Billing === 'subscription');
    await page.locator('#model-a').evaluate(el => { el.closest('[data-session-id]').setAttribute('data-session-id', 'new-chat'); el.setAttribute('aria-label', 'Model: Unknown'); });
    await page.waitForFunction(() => !document.querySelector('#model-a').hasAttribute('data-e1-billing'));
    await page.locator('#row-b').evaluate(el => { el.outerHTML = '<button id="row-b" data-row-main-button>Plan chat remounted</button>'; });
    await page.waitForFunction(() => document.querySelector('#row-b .e1-billing-chip')?.textContent === 'Plan');
    await page.evaluate(() => { window.mutations = 0; new MutationObserver(r => window.mutations += r.length).observe(document, { subtree: true, childList: true, attributes: true, characterData: true }); });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await page.evaluate(() => window.mutations), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
