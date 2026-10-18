const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
test('Plan hover shows usage, reset countdowns, native theme, and discards another account response',async()=>{
 const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage({colorScheme:'dark'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<div class="cds-root" style="transform:translateX(288px);--cds-surface-2:rgb(240,244,241);--cds-text-primary:rgb(20,30,25)"><div class="dframe-pane" data-session-id="chat"><button data-testid="epitaxy-cds-model-selector" aria-label="Model: Test">Test</button></div></div>');
 await page.evaluate(()=>{window.calls=[];window.readers={};window.e1PlanUsage={read:provider=>{window.calls.push(provider);return new Promise(resolve=>window.readers[provider]=resolve);}};});
 await page.addScriptTag({path:path.join(__dirname,'../src/billing-indicator.js')});
 const send=provider=>page.evaluate(provider=>window.dispatchEvent(new CustomEvent('e1-billing-status',{detail:{version:2,catalog:[],chats:[{chatId:'chat',billing:provider==='api'?'api':'subscription',provider,accountLabel:provider,accountEmail:provider+'@test',model:'test',running:true}]}})),provider);
 await send('one');const chip=page.locator('.e1-billing-chip'),tip=page.getByRole('tooltip');await chip.hover();await page.waitForFunction(()=>window.calls.includes('one'));assert.match(await tip.innerText(),/Loading plan usage/);
 await send('two');await page.waitForFunction(()=>window.calls.includes('two'));
 await page.evaluate(()=>window.readers.one({state:'live',checkedAt:Date.now(),windows:[{label:'Wrong account window',usedPercent:87,resetsAt:Date.now()+50000}]}));
 await page.evaluate(()=>window.readers.two({state:'live',checkedAt:Date.now(),windows:[{label:'5-hour limit',usedPercent:27,resetsAt:Date.now()+7200000},{label:'Weekly limit',usedPercent:95,resetsAt:Date.now()-1000}]}));
 await page.waitForFunction(()=>document.querySelector('[role="tooltip"]').textContent.includes('27% used'));
 const text=await tip.innerText();assert.match(text,/73% left · Resets in 2h/);assert.match(text,/Reset passed · waiting for updated usage/);assert.doesNotMatch(text,/Wrong account|95% used/);assert.equal(await tip.getByRole('meter').count(),1);const box=await tip.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=1280);assert.equal(await tip.evaluate(e=>e.parentElement.tagName),'BODY');
 assert.equal(await tip.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(240, 244, 241)');assert.equal(await tip.evaluate(e=>getComputedStyle(e).color),'rgb(20, 30, 25)');
 await page.mouse.move(900,700);await tip.waitFor({state:'hidden'});assert.equal(await tip.isVisible(),false);await chip.focus();assert.equal(await tip.isVisible(),true);await page.keyboard.press('Escape');await tip.waitFor({state:'hidden'});assert.equal(await tip.isVisible(),false);
 await send('api');await chip.focus();assert.equal(await tip.locator('.e1-usage').count(),0);assert.deepEqual(await page.evaluate(()=>window.calls),['one','two']);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
test('model and API hovers show actual pricing, subscription reference and clean up on remount',async()=>{
 const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<div class="dframe-pane" data-session-id="chat"><button aria-label="Model: Test">Test</button></div>');
 await page.addScriptTag({path:path.join(__dirname,'../src/billing-indicator.js')});
 const {enrichPricing}=require('../src/model-pricing.cjs');
 const send=billing=>page.evaluate(status=>window.dispatchEvent(new CustomEvent('e1-billing-status',{detail:{version:2,catalog:[],chats:[status]}})),enrichPricing({chatId:'chat',billing,provider:'p',model:'gpt-6.1-sol',running:true},{baseUrl:'https://api.openai.com/v1'}));
 await send('api');const model=page.getByRole('button',{name:'Model: Test'}),tip=page.getByRole('tooltip');await page.waitForSelector('.e1-billing-chip');await model.hover();await tip.waitFor({state:'visible'});
 assert.match(await tip.innerText(),/USD per 1M tokens/);assert.match(await tip.innerText(),/Input\n\$2.00/);assert.match(await tip.innerText(),/Cached input\n\$0.10/);assert.match(await tip.innerText(),/Over 272K/);
 await page.getByRole('link',{name:'Provider pricing'}).hover();assert.equal(await tip.isVisible(),true);
 await page.mouse.move(900,700);await tip.waitFor({state:'hidden'});await page.locator('.e1-billing-chip').hover();await tip.waitFor({state:'visible'});assert.match(await tip.innerText(),/Model pricing/);
 await send('subscription');await page.waitForTimeout(150);assert.equal(await tip.locator('[aria-label="Model pricing"]').count(),0);
 await model.hover();await page.waitForFunction(()=>document.querySelector('[role="tooltip"]').textContent.includes('API price for reference'));assert.match(await tip.innerText(),/Using subscription allowance/);
 await model.click();await tip.waitFor({state:'hidden'}); // Hover must not obscure the picker.
 await model.evaluate(e=>e.outerHTML=e.outerHTML);await page.mouse.move(900,700);await page.waitForTimeout(150);await model.hover();await tip.waitFor({state:'visible'});assert.equal(await page.locator('.e1-billing-chip').count(),1);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
