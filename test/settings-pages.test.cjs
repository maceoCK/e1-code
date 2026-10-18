const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{nativeFixture,available}=require('./native-ui-fixture.cjs');
const patcher=require('../scripts/patch-settings-pages.cjs');
test('Settings pages are registered in native route parsing, navigation/search and panel loading',{skip:!available},()=>{
 const root=path.join(process.env.E1_CAPTURE_ROOT||path.resolve(__dirname,'../../outputs/claude-desktop-decomp'),'full/original/Claude.app/Contents/Resources/ion-dist');
 for(const file of patcher.files){const original=fs.readFileSync(path.join(root,file),'utf8'),result=patcher.patch(file,original);for(const {id}of patcher.sections)assert.ok(result.includes(id));assert.throws(()=>patcher.patch(file,result),/changed/);}
});
test('native Settings panes mount one page, switch cleanly and retain account actions',{skip:!available},async t=>{
 const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1100,height:900}});page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await nativeFixture(page,'<div class="cds-root" data-mode="dark"><main id="fixture"></main></div>');
 await page.route('https://native.test/assets/v1/e1-settings-pages.js',r=>r.fulfill({path:path.resolve(__dirname,'../src/native-settings-pages.js'),contentType:'text/javascript'}));
 const state={providers:[{id:'chatgpt-one',name:'Personal',models:[],protocol:'responses',signedIn:true}],selection:{provider:'chatgpt-one',model:'',profile:'auto'},routing:{order:['chatgpt-one']},subscriptions:{available:true,welcomeAcknowledged:true,accounts:[{id:'one',label:'Personal',email:'person@example.test',connected:true,planEnabled:true,mode:'codex'}],pending:[]},claudeAccounts:{available:true,accounts:[],pending:[]},modelBrowser:{}};
 await page.exposeFunction('settingsRequest',async(operation,args)=>{
  if(operation==='assets')return{html:fs.readFileSync(path.resolve(__dirname,'../src/ui/settings/index.html'),'utf8'),css:fs.readFileSync(path.resolve(__dirname,'../src/ui/settings/modal.css'),'utf8')};
  if(operation==='api'&&args.route==='state')return state;
  if(operation==='api'&&args.route==='provider'){state.subscriptions.accounts[0].label=args.data.name;return{};}
  throw Error('Unexpected fixture request '+operation+' '+args?.route);
 });
 await page.evaluate(()=>window.e1Settings={request:window.settingsRequest});
 await page.addScriptTag({path:path.resolve(__dirname,'../src/ui/settings/app.js')});
 await page.evaluate(async()=>{const {aa:h,sa:createRoot}=await import('/assets/v1/vendor-frame-Bk3oL3Qp.js'),panels=await import('/assets/v1/e1-settings-pages.js');const root=createRoot(document.querySelector('#fixture'));window.showPage=name=>root.render(h(panels[name],{}));window.showPage('Accounts');});
 await page.getByRole('button',{name:'Rename Personal',exact:true}).waitFor();assert.equal(await page.getByRole('tab').count(),0);assert.equal(await page.getByRole('dialog').count(),0);
 await page.getByLabel('Manage Personal',{exact:true}).click();await page.getByRole('button',{name:'Rename',exact:true}).click();await page.getByRole('textbox',{name:'Account label'}).fill('Work');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByLabel('Manage Work',{exact:true}).waitFor();
 await page.evaluate(()=>window.showPage('Usage'));await page.getByText('When a limit is reached',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Add ChatGPT account'}).isVisible(),false);
 await page.evaluate(()=>window.showPage('Models'));await page.getByLabel('Connection name').waitFor();
 await page.evaluate(()=>window.showPage('Accounts'));await page.getByLabel('Manage Work',{exact:true}).waitFor();assert.deepEqual(errors,[]);
 await page.screenshot({animations:'disabled',path:path.resolve(__dirname,'../evidence/settings-pages-fixture.png')});
});
test('all shortcut targets use the native Settings store and update an already-open page',async t=>{
 const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage();
 await page.route('https://settings.test/**',route=>route.fulfill({contentType:route.request().url().endsWith('.js')?'text/javascript':'text/html',body:route.request().url().endsWith('.js')?`const listeners=[];const state={section:null,open(section){state.section=section;window.nativeSettingsCalls.push(section);listeners.forEach(fn=>fn(state));}};export const Eg={subscribe(fn){listeners.push(fn)},getState(){return state}};`:'<!doctype html><body></body>'}));
 await page.goto('https://settings.test/');await page.evaluate(()=>{window.nativeSettingsCalls=[];window.overlays=[];window.e1Settings={onShow:fn=>window.openFromMain=fn};window.e1NewTab={overlay:(...args)=>window.overlays.push(args)};});
 await page.addScriptTag({path:path.resolve(__dirname,'../src/native-settings-navigation.js')});
 await page.evaluate(async()=>{await window.e1SettingsNavigation.open('accounts');await window.e1SettingsNavigation.open('usage');await window.e1SettingsModal.open('models');});
 assert.deepEqual(await page.evaluate(()=>window.nativeSettingsCalls),['e1-accounts','e1-usage','e1-models']);assert.equal(await page.locator('[role=dialog]').count(),0);
 await page.evaluate(()=>window.openFromMain('accounts'));await page.waitForFunction(()=>window.nativeSettingsCalls.length===4);assert.equal(await page.evaluate(()=>window.nativeSettingsCalls[3]),'e1-accounts');
});
