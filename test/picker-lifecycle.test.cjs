const {nativeFixture, choose, available}=require('./native-ui-fixture.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

for (const kind of ['workflow', 'speed']) {
  async function fixture(t) {
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await nativeFixture(page,'<div class="dframe-pane" data-session-id="chat-a"><button aria-label="Model: Main">Main</button></div><div class="dframe-pane" data-session-id="chat-b"><button aria-label="Model: Worker">Worker</button></div>');
    await page.evaluate(kind => {
      window.settings = { preferences: { chats: {}, models: {} }, models: ['Main', 'Worker'].map(name => ({
        id: name.toLowerCase(), name, efforts: ['low', 'high'], modes: ['standard', 'fast'], connections: [{ id: 'api', name: 'Test API' }],
      })) };
      window.reads = []; window.saves = []; window.deferReads = false;
      window[kind === 'workflow' ? 'e1WorkflowPreferences' : 'e1SpeedPreferences'] = {
        read: () => window.deferReads ? new Promise(resolve => window.reads.push(resolve)) : Promise.resolve(structuredClone(window.settings)),
        save: value => new Promise((resolve, reject) => window.saves.push({ value, resolve, reject })),
      };
    }, kind);
    await page.addScriptTag({ path: path.resolve(__dirname, `../src/${kind}-picker.js`) });
    const controls = page.locator(kind === 'workflow' ? '.e1-subagents-button' : '.e1-speed-button');
    await controls.first().waitFor();
    return { page, controls, errors, submit: page.locator('[role=dialog] [type=submit]') };
  }

  test(`${kind}: an old save cannot close a newer dialog or throw after cancellation`, {skip:!available}, async t => {
    const { page, controls, errors, submit } = await fixture(t);
    await controls.first().click();
    await submit.click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await controls.last().click();
    await page.evaluate(() => window.saves[0].resolve(structuredClone(window.settings)));
    await page.waitForTimeout(50);
    assert.equal(await page.locator('[role=dialog]:not([data-ending-style])').count(), 1, 'old completion must not close the new dialog');
    await submit.click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => window.saves[1].reject(new Error('Delayed save failure')));
    await page.waitForTimeout(50);
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => window.saves.map(s => s.value.chatId)), ['chat-a', 'chat-b']);
  });

  test(`${kind}: newest open request wins and removed chat cannot open a stale dialog`, {skip:!available}, async t => {
    const { page, controls, errors } = await fixture(t);
    await page.evaluate(() => window.deferReads = true);
    await controls.first().click();
    await controls.last().click();
    await page.evaluate(() => window.reads[1](structuredClone(window.settings)));
    await page.locator('[role=dialog]:not([data-ending-style])').waitFor();
    await page.evaluate(() => window.reads[0](structuredClone(window.settings)));
    await page.waitForTimeout(50);
    await page.locator('[role=dialog] [type=submit]').click();
    assert.equal(await page.evaluate(() => window.saves[0].value.chatId), 'chat-b');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await controls.first().click();
    await page.evaluate(() => {
      document.querySelector('[data-session-id="chat-a"]').remove();
      window.reads[2](structuredClone(window.settings));
    });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('[role=dialog]:not([data-ending-style])').count(), 0);
    assert.deepEqual(errors, []);
  });
}
