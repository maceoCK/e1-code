const {nativeFixture, choose, available}=require('./native-ui-fixture.cjs');
const {test}=require('node:test'), assert=require('node:assert/strict'), path=require('node:path');
const {chromium}=require('playwright');
test('workflow picker saves the correct split chat, resets effort on incompatible models and stays stable',{skip:!available},async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await nativeFixture(page,'<div class="dframe-pane" data-session-id="local_11111111-1111-4111-8111-111111111111"><button aria-label="Model: Main">Main</button></div><div class="dframe-pane" data-session-id="local_22222222-2222-4222-8222-222222222222"><button aria-label="Model: Worker">Worker</button></div>');
    await page.evaluate(()=>{
      window.saved=[];const state={preferences:{chats:{},models:{}},models:[{id:'main',name:'Main',efforts:['low','high']},{id:'worker',name:'Worker',efforts:[]}]};
      window.e1WorkflowPreferences={read:async()=>state,save:async v=>{window.saved.push(v);state.preferences.chats[v.chatId]={model:v.model,effort:v.effort};return state;}};
    });
    await page.addScriptTag({path:path.resolve(__dirname,'../src/workflow-picker.js')});
    await page.locator('.e1-subagents-button').first().click();
    await choose(page,'Subagent effort','High');
    await choose(page,'Subagent model','Worker');
    assert.equal((await page.getByRole('combobox',{name:/^Subagent effort /}).innerText()).startsWith('Inherit chat effort'),true);
    await page.getByRole('button',{name:'Save changes',exact:true}).click();
    const saved=await page.evaluate(()=>window.saved);
    assert.equal(saved[0].chatId,'local_11111111-1111-4111-8111-111111111111');
    assert.equal(saved[0].model,'worker');assert.equal(saved[0].parentModel,'main');
    await page.waitForFunction(()=>document.querySelector('.e1-subagents-button').title === 'Workflow subagents: Worker');
    await page.locator('.e1-subagents-button').last().click();
    assert.equal((await page.getByRole('combobox',{name:/^Subagent model /}).innerText()).startsWith('Same as main chat'),true);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.locator('[role=dialog]').waitFor({state:'detached'});
    await page.waitForTimeout(200);
    await page.evaluate(()=>{window.changes=0;new MutationObserver(r=>window.changes+=r.length).observe(document,{subtree:true,childList:true,attributes:true});});
    await new Promise(resolve=>setTimeout(resolve,250));
    assert.equal(await page.evaluate(()=>window.changes),0);assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
