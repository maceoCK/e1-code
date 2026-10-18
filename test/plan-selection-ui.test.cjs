const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright'),{nativeFixture,available}=require('./native-ui-fixture.cjs');
test('Plan opens native account rows with keyboard selection and saves the right chat; running account remains visible',{skip:!available},async t=>{
 const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const chat='local_11111111-1111-4111-8111-111111111111';
 await nativeFixture(page,`<div class="dframe-pane" data-session-id="${chat}"><button aria-label="Model: GPT-6.1-sol">GPT-6.1-sol</button></div>`);
 await page.evaluate(chat=>{
  window.saved=[];window.e1PlanUsage={read:async()=>({state:'unavailable',windows:[]}),choices:async input=>({modelId:input.modelId,selected:'one',choices:[{id:'one',accountLabel:'Personal',accountEmail:'personal@example.test',planName:'ChatGPT Pro'},{id:'two',accountLabel:'Work',accountEmail:'work@example.test',planName:'ChatGPT Business'}]}),select:async value=>{window.saved.push(value);return{};}};
  window.billing={version:2,chats:[],catalog:[{id:'model',name:'GPT-6.1-sol',prediction:{billing:'subscription',provider:'one',model:'gpt-6.1-sol'}}],planRoutes:[{billing:'subscription',provider:'two',model:'gpt-6.1-sol',accountLabel:'Work'}],planPreferences:{chats:{}}};
 },chat);
 await page.addScriptTag({path:path.resolve(__dirname,'../src/billing-indicator.js')});
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('e1-billing-status',{detail:window.billing})));
 const chip=page.locator('.e1-billing-chip');await chip.click();const dialog=page.getByRole('dialog');await dialog.waitFor();
 assert.equal(await dialog.getAttribute('data-cds'),'Dialog');assert.equal(await dialog.getByRole('combobox').count(),0);
 const personal=dialog.getByRole('radio',{name:/Personal/}),work=dialog.getByRole('radio',{name:/Work/});
 assert.match(await personal.innerText(),/personal@example.test/);await personal.focus();await page.keyboard.press('ArrowDown');assert.equal(await work.getAttribute('aria-checked'),'true');assert.equal(await work.evaluate(e=>e===document.activeElement),true);
 await dialog.getByRole('button',{name:'Use this plan',exact:true}).click();await dialog.waitFor({state:'detached'});
 assert.deepEqual(await page.evaluate(()=>window.saved),[{modelId:'model',chatId:chat,provider:'two'}]);
 await page.evaluate(chat=>{window.billing.planPreferences.chats[chat]={model:'two'};window.billing.chats=[{chatId:chat,running:true,billing:'subscription',provider:'one',accountLabel:'Personal',model:'gpt-6.1-sol'}];window.dispatchEvent(new CustomEvent('e1-billing-status',{detail:window.billing}));},chat);
 await page.waitForFunction(()=>document.querySelector('.e1-billing-chip').planProvider==='one');
 await page.evaluate(()=>{window.billing.chats[0].running=false;window.dispatchEvent(new CustomEvent('e1-billing-status',{detail:window.billing}));});
 await page.waitForFunction(()=>document.querySelector('.e1-billing-chip').planProvider==='two');assert.deepEqual(errors,[]);
});
