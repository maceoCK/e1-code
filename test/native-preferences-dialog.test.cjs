const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');
const {nativeFixture,available}=require('./native-ui-fixture.cjs');

test('native preferences retain theme, trap focus, dismiss nested menus first, and clean up after repeated opens', {skip:!available}, async t=>{
  const browser=await chromium.launch();t.after(()=>browser.close());
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.emulateMedia({colorScheme:'dark'});
  await nativeFixture(page,'<div class="dframe-pane" data-session-id="a"><button aria-label="Model: Main">Main</button></div>');
  await page.evaluate(()=>{
    const state={preferences:{chats:{},models:{}},models:[{id:'main',name:'Main',efforts:['low','high']}]};
    window.saves=[];window.e1WorkflowPreferences={read:async()=>state,save:value=>new Promise(resolve=>window.saves.push({value,resolve}))};
  });
  await page.addScriptTag({path:path.resolve(__dirname,'../src/workflow-picker.js')});
  const trigger=page.locator('.e1-subagents-button'),dialog=page.getByRole('dialog');
  await trigger.click();await dialog.waitFor();
  assert.equal(await dialog.getAttribute('data-cds'),'Dialog');
  const light=await dialog.evaluate(el=>getComputedStyle(el).backgroundColor);
  assert.equal(light,'rgb(255, 255, 255)', 'explicit app theme must override the OS theme');
  await page.evaluate(()=>document.documentElement.dataset.mode='dark');
  await page.waitForFunction(light=>getComputedStyle(document.querySelector('[role=dialog]')).backgroundColor!==light,light);
  for(let i=0;i<10;i++){
    await page.keyboard.press('Tab');
    await page.waitForFunction(()=>document.querySelector('[data-e1-preferences]')?.contains(document.activeElement), null, {timeout:1500});
    assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true);
  }
  await page.getByRole('combobox',{name:/^Subagent model /}).click();
  await page.getByRole('option',{name:'Main',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('option',{name:'Main',exact:true}).waitFor({state:'detached'});
  await dialog.waitFor();
  assert.equal(await dialog.count(),1);
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  await page.waitForFunction(()=>document.activeElement?.matches('.e1-subagents-button'));
  assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
  await page.emulateMedia({reducedMotion:'reduce'});
  for(let i=0;i<6;i++){
    await trigger.click();await dialog.waitFor();
    assert.equal(await dialog.evaluate(el=>getComputedStyle(el).transitionProperty),'none');
    if(i%2) await page.getByRole('button',{name:'Close',exact:true}).click();
    else await page.mouse.click(10,10);
    await dialog.waitFor({state:'detached'});
    assert.equal(await page.locator('[data-e1-preferences-host]').count(),0);
  }
  await trigger.click();await dialog.waitFor();
  await page.setViewportSize({width:390,height:600});
  const bounds=await dialog.boundingBox();
  assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390&&bounds.y>=0&&bounds.y+bounds.height<=600);
  await page.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
  assert.equal(await page.evaluate(()=>window.saves.length),1);
  assert.equal(await page.getByRole('button',{name:'Reset',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await dialog.waitFor({state:'detached'});
  assert.deepEqual(errors,[]);
});
