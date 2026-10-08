const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright');
const {nativeFixture,available}=require('./native-ui-fixture.cjs');
const patch=require('../scripts/patch-model-browser.cjs');
const {startServer}=require('../src/server.cjs');
const models=[
  {id:'claude-aster-old',name:'Personal · GPT-5.6 Sol',model:'gpt-5.6-sol',providerName:'Personal'},
  {id:'claude-aster-luna',name:'Personal · GPT-6 Luna',model:'gpt-6-luna',providerName:'Personal'},
  {id:'claude-aster-astra',name:'Work · GPT-6 Astra',model:'gpt-6-astra',providerName:'Work'},
  {id:'claude-aster-sol',name:'Personal · GPT-6.1 Sol',model:'gpt-6.1-sol',providerName:'Personal'},
  {id:'claude-aster-sonnet',name:'Claude Sonnet 4.6',model:'claude-sonnet-4-6',providerName:'Claude'},
];
test('native model menu searches versions, groups models, persists legacy visibility and preserves native selection', {skip:!available},async t=>{
  const browser=await chromium.launch();t.after(()=>browser.close());
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await nativeFixture(page,'<div id="root"></div>');
  const capture=process.env.E1_CAPTURE_ROOT||path.resolve(__dirname,'../../outputs/claude-desktop-decomp');
  const source=fs.readFileSync(path.join(capture,'full/original/Claude.app/Contents/Resources/ion-dist',patch.file),'utf8');
  await page.route('https://native.test/'+patch.file,route=>route.fulfill({body:patch.patch(source),contentType:'text/javascript'}));
  await page.evaluate(async models=>{
    window.changes=[];window.pref={showLegacy:false};window.listeners=new Set();window.saves=[];
    window.e1ModelBrowser={read:async()=>({models,preferences:window.pref}),save:async pref=>{window.saves.push(pref);window.pref=pref;return {models,preferences:pref};},onChange:fn=>{window.listeners.add(fn);return ()=>window.listeners.delete(fn);}};
    const {aa:h,sa:createRoot,Ha:useState}=await import('/assets/v1/vendor-frame-Bk3oL3Qp.js');
    const {zc:Provider}=await import('/assets/v1/shared-frame-mKeNK6Hi.js');
    const {oi:ModelSelector}=await import('/assets/v1/shared-16-Coak3mnx.js');
    function Picker(){
      const [state,setState]=useState({model:'claude-aster-luna'});
      return h(ModelSelector,{catalog:{id:'test',models:models.map((m,i)=>({...m,section:i%2?'main':'overflow'}))},state,
        config:{shortcuts:true},onStateChange:next=>{window.changes.push(next);setState(next);}});
    }
    createRoot(document.getElementById('root')).render(h(Provider,{theme:'claude',mode:'light',children:h(Picker,{})}));
  },models);
  const trigger=page.getByRole('button',{name:/Model:/});await trigger.click();
  const search=page.getByRole('textbox',{name:'Search models'});await search.waitFor();
  await page.getByRole('menuitemradio',{name:/GPT-6.1 Sol/}).waitFor();
  assert.equal(await page.getByRole('menuitemradio',{name:/GPT-5.6 Sol/}).count(),0);
  assert.deepEqual(await page.locator('[data-model-id]').evaluateAll(els=>els.map(e=>e.dataset.modelId)),['claude-aster-sonnet','claude-aster-sol','claude-aster-astra','claude-aster-luna']);
  await search.pressSequentially('6.1 sol');
  assert.equal(await search.inputValue(),'6.1 sol','native numeric shortcuts must not eat search digits');
  assert.deepEqual(await page.locator('[data-model-id]').evaluateAll(els=>els.map(e=>e.dataset.modelId)),['claude-aster-sol']);
  await search.fill('openai work astra');await page.getByRole('menuitemradio',{name:/GPT-6 Astra/}).click();
  await search.waitFor({state:'detached'});await page.waitForFunction(()=>window.changes.length===1);
  assert.equal(await page.evaluate(()=>window.changes[0].model),'claude-aster-astra');
  await trigger.click();await search.waitFor();assert.equal(await search.inputValue(),'');
  await page.getByRole('menuitemcheckbox',{name:'Show legacy models'}).click();
  await page.getByRole('menuitemradio',{name:/GPT-5.6 Sol/}).click();
  await trigger.click();await search.waitFor();
  await page.getByRole('menuitemcheckbox',{name:'Show legacy models'}).click();
  await page.waitForFunction(()=>window.pref.showLegacy===false);
  assert.equal(await page.getByRole('menuitemradio',{name:/GPT-5.6 Sol/}).count(),1,'current legacy selection remains visible');
  await search.fill('nothingmatches');await page.getByRole('status').filter({hasText:'No matching models'}).waitFor();
  await search.press('Escape');await search.waitFor({state:'detached'});
  await page.waitForFunction(()=>window.listeners.size===0);assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
  for(let i=0;i<4;i++){
    await trigger.click();await search.waitFor();
    await page.waitForFunction(()=>window.listeners.size===1);
    await search.press('Escape');await search.waitFor({state:'detached'});
    await page.waitForFunction(()=>window.listeners.size===0);
  }
  assert.deepEqual(errors,[]);
});

test('legacy preference is shared by settings and workspace without writing chat/account data',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'e1-model-browser-'));
  const app=await startServer({dataDir:dir,settingsOnly:true});t.after(()=>{app.close();fs.rmSync(dir,{recursive:true,force:true});});
  const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin},body:JSON.stringify({token:app.url.split('#')[1]})});
  const headers={Cookie:session.headers.get('set-cookie').split(';')[0],Origin:app.origin};
  const before=JSON.stringify(app.store.data);
  const state=await (await fetch(app.origin+'/api/state',{headers})).json();assert.deepEqual(state.modelBrowser,{showLegacy:false});
  const save=await fetch(app.origin+'/api/model-browser',{method:'POST',headers,body:JSON.stringify({showLegacy:true})});assert.equal(save.status,200);
  const {ModelBrowserPreferences}=require('../src/model-browser-preferences.cjs');assert.deepEqual(new ModelBrowserPreferences(dir).read(),{showLegacy:true});
  assert.equal(JSON.stringify(app.store.data),before);
  assert.equal((await fetch(app.origin+'/api/model-browser',{method:'POST',headers,body:'{"showLegacy":"yes"}'})).status,400);
  assert.equal((await fetch(app.origin+'/api/model-browser',{method:'DELETE',headers})).status,405);
  assert.deepEqual(await (await fetch(app.origin+'/api/model-browser',{headers})).json(),{showLegacy:true});
  const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage();
  await page.goto(app.url);await page.getByRole('tab',{name:'Models & connections'}).click();
  const setting=page.getByRole('checkbox',{name:/Show legacy models/});await setting.waitFor();
  assert.equal(await setting.isChecked(),true);await setting.uncheck();
  await page.getByRole('status').filter({hasText:'Model pickers update automatically'}).waitFor();
  await page.reload();await page.getByRole('tab',{name:'Models & connections'}).click();assert.equal(await setting.isChecked(),false);
});
