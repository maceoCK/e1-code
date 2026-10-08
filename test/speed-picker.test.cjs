const {nativeFixture, choose, available}=require('./native-ui-fixture.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require('playwright');
test('speed picker warns before paid opt-in, supports cancelling, and blocks unavailable API connections',{skip:!available},async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await nativeFixture(page,'<div class="dframe-pane" data-session-id="local_11111111-1111-4111-8111-111111111111"><button aria-label="Model: Opus">Opus</button></div><div class="dframe-pane" data-session-id="local_22222222-2222-4222-8222-222222222222"><button aria-label="Model: Astra">Astra</button></div>');
    await page.evaluate(()=>{
      const state={preferences:{chats:{},models:{}},models:[{id:'opus',name:'Opus',modes:['standard','fast'],connections:[{id:'api',name:'Console 1'}]},{id:'astra',name:'Astra',modes:['standard','fast','ultrafast'],connections:[]}]};
      window.saved=[];window.e1SpeedPreferences={read:async()=>state,save:async v=>{window.saved.push(v);state.preferences.chats[v.chatId]={[v.parentModel]:v};return state;}};
    });
    await page.addScriptTag({path:path.resolve(__dirname,'../src/speed-picker.js')});
    await page.locator('.e1-speed-button').first().click();await choose(page,'Speed','Fast');
    assert.match(await page.locator('[data-warning]').innerText(),/paid API billing through Console 1/);
    assert.equal((await page.evaluate(()=>window.saved)).length,0);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await page.evaluate(()=>window.saved)).length,0);
    await page.locator('.e1-speed-button').first().click();await choose(page,'Speed','Fast');
    await page.getByRole('button',{name:'Enable Fast · use paid API',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.saved[0]),{parentModel:'opus',chatId:'local_11111111-1111-4111-8111-111111111111',mode:'fast',apiProvider:'api',confirmPaid:true});
    await page.locator('.e1-speed-button').last().click();await choose(page,'Speed','Ultrafast');
    assert.match(await page.locator('[data-warning]').innerText(),/No configured API connection/);
    assert.equal(await page.getByRole('button',{name:'Enable Ultrafast · use paid API',exact:true}).isDisabled(),true);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
