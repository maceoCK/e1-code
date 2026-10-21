const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {installNewTab}=require('../src/new-tab.cjs');
const {chromium}=require('playwright');
const {nativeFixture,available}=require('./native-ui-fixture.cjs');

test('one app menu accelerator opens selector even with child web contents focused',()=>{
 const app=new EventEmitter(),sent=[];const win={isDestroyed:()=>false,isMinimized:()=>false,show(){},focus(){},webContents:{send(){throw Error('wrong outer shell');}},contentView:{children:[{webContents:{isDestroyed:()=>false,getURL:()=> 'app://localhost/epitaxy',send:v=>sent.push(v)}}]}};
 class MenuItem{constructor(data){Object.assign(this,data);}}
 const api=installNewTab({app,MenuItem},()=>win),items=[{label:'Old browser tab',accelerator:'CmdOrCtrl+T'}];
 const submenu={items,getMenuItemById:id=>items.find(v=>v.id===id),insert:(index,item)=>items.splice(index,0,item)};
 const menu={items:[{label:'File',submenu}]};api.menu(menu);api.menu(menu);
 assert.equal(items.filter(v=>v.accelerator).length,1);assert.equal(items.length,2);items[0].click();assert.deepEqual(sent,['e1:new-tab:show']);
 const preloads=[],session={registerPreloadScript:p=>preloads.push(p)};app.emit('web-contents-created',{}, {session,ipc:{handle(){}},on(){}});app.emit('web-contents-created',{}, {session,ipc:{handle(){}},on(){}});assert.equal(preloads.length,1);
});

test('native adapter validates capture and preserves availability and native new-tab actions',{skip:!available},()=>{
 const patch=require('../scripts/patch-tab-actions.cjs');
 const original=fs.readFileSync(path.join(process.env.E1_CAPTURE_ROOT||path.resolve(__dirname,'../../outputs/claude-desktop-decomp'),'full/original/Claude.app/Contents/Resources/ion-dist',patch.file),'utf8');
 // 3.1623.0 session-pane hook Rp: n paneEnabled, i owner, gc terminal tab store, d useEffect.
 const output=patch.patch(original);assert.ok(output.includes('e1RegisterTabs(n,{'));assert.ok(output.includes('gc.getState().addTab(i.id)'));
 assert.ok(output.includes('});Cp(n,J5($,169,'),'registration is its own statement before the native shortcut hook');
 assert.ok(/import\{[^}]*\bho as d\b[^}]*\}from"\.\/vendor-frame-/.test(original),'helper effect is the module useEffect import');
 assert.ok(output.includes('if(_&&!p)'),'a starting session only opens the terminal pane');
 assert.throws(()=>patch.patch(output));assert.throws(()=>patch.patch(original.split('{onTogglePane:ve,').join('{onTogglePane:ue,')),/changed/);
});

test('selector inherits light/dark theme, runs correct actions from any pane, and restores focus',{skip:!available},async t=>{
 const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await nativeFixture(page,'<div class="cds-root" data-mode="light"><aside aria-label="Sidebar"><a data-row-main-button="" role="button" tabindex="0"><span>New</span><span aria-hidden="true">⌘N</span></a></aside><main aria-label="Primary pane"><textarea aria-label="Prompt"></textarea></main></div>');
 await page.evaluate(()=>{
  window.calls=[];window.e1NativeTabActions=Object.fromEntries(['chat','browser','terminal','files','changes'].map(type=>[type,()=>window.calls.push(type)]));
  window.e1DotView={show:()=>window.calls.push('dot'),close(){}};
 });
 await page.addScriptTag({path:path.resolve(__dirname,'../src/new-tab-picker.js')});
 const dialog=page.getByRole('dialog');
 await page.getByRole('button',{name:'New',exact:true}).click();await dialog.waitFor();
 const light=await dialog.evaluate(el=>getComputedStyle(el).backgroundColor);assert.equal(light,'rgb(255, 255, 255)');
 await page.evaluate(()=>document.querySelector('.cds-root').dataset.mode='dark');
 await page.waitForFunction(light=>getComputedStyle(document.querySelector('[role=dialog]')).backgroundColor!==light,light);
 await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
 assert.equal(await page.getByRole('button',{name:'New',exact:true}).evaluate(el=>el===document.activeElement),true);
 for(const type of ['chat','browser','terminal','files','changes','dot']){
  await page.getByRole('textbox',{name:'Prompt'}).focus();await page.keyboard.press('Meta+t');await dialog.waitFor();
  await page.keyboard.press('Meta+t');assert.equal(await dialog.count(),1);
  await dialog.locator('[data-tab-type='+type+']').click();await dialog.waitFor({state:'detached'});
 }
 assert.deepEqual(await page.evaluate(()=>window.calls),['chat','browser','terminal','files','changes','dot']);
 await page.evaluate(()=>window.e1NativeTabActions.terminal=null);await page.keyboard.press('Meta+t');await dialog.waitFor();
 assert.equal(await dialog.locator('[data-tab-type=terminal]').isDisabled(),true);
 assert.match(await dialog.locator('[data-tab-type=terminal]').innerText(),/Select a local folder/);
 await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await page.locator('[data-e1-tab-host]').count(),0);assert.deepEqual(errors,[]);
});

test('Dot follows its app theme including live mode changes',{skip:!available},async t=>{
 const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage();
 await nativeFixture(page,'<div class="cds-root" data-mode="light"><aside aria-label="Sidebar"><button aria-label="Customize">Customize</button></aside><main aria-label="Primary pane"></main></div>');
 await page.evaluate(()=>window.e1Dot={onShow(){},request:async()=>[]});
 await page.addScriptTag({path:path.resolve(__dirname,'../src/dot-sidebar.js')});
 await page.getByRole('button',{name:'Your dot',exact:true}).click();const panel=page.locator('#e1-dot-panel');await panel.waitFor();
 const light=await panel.evaluate(el=>getComputedStyle(el).backgroundColor);assert.equal(light,'rgb(248, 249, 246)');
 await page.evaluate(()=>document.querySelector('.cds-root').dataset.mode='dark');
 await page.waitForFunction(light=>getComputedStyle(document.querySelector('#e1-dot-panel')).backgroundColor!==light,light);
 assert.equal(await panel.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(29, 35, 32)');
});

test('native browser occlusion stays hidden across nested picker/Dot and restores latest state',async()=>{
 const app=new EventEmitter(),handlers={},contents=new EventEmitter();contents.session={registerPreloadScript(){}};contents.ipc={handle:(key,callback)=>handlers[key]=callback};contents.mainFrame={url:'app://localhost/epitaxy'};
 let visible=true;const view={webContents:{isDestroyed:()=>false,getURL:()=> 'https://example.com'},getVisible:()=>visible,setVisible:value=>visible=value};
 const win={contentView:{children:[view]},webContents:{}};installNewTab({app,MenuItem:class{}},()=>win);app.emit('web-contents-created',{},contents);
 const event={senderFrame:contents.mainFrame};
 await assert.rejects(handlers['e1:overlay']({senderFrame:{url:'https://example.com'}},'dot',true));
 await handlers['e1:overlay'](event,'new-tab',true);assert.equal(visible,false);
 view.setVisible(true);assert.equal(visible,false);
 await handlers['e1:overlay'](event,'dot',true);await handlers['e1:overlay'](event,'new-tab',false);assert.equal(visible,false);
 await handlers['e1:overlay'](event,'dot',false);assert.equal(visible,true);
 await handlers['e1:overlay'](event,'new-tab',true);view.setVisible(false);contents.emit('destroyed');assert.equal(visible,false);
});


test('Cmd+T has priority over the native browser handler',()=>{
 const app=new EventEmitter(),contents=new EventEmitter(),sent=[];contents.session={registerPreloadScript(){}};contents.ipc={handle(){}};
 installNewTab({app,MenuItem:class{}},()=>({isDestroyed:()=>false,isMinimized:()=>false,show(){},focus(){},webContents:{send:()=>sent.push('picker')}}));
 app.emit('web-contents-created',{},contents);contents.on('before-input-event',()=>sent.push('native'));
 let prevented=false;contents.emit('before-input-event',{preventDefault:()=>prevented=true},{type:'keyDown',key:'t',meta:true,control:true});
 assert.equal(prevented,true);assert.deepEqual(sent,['picker']);
 contents.emit('before-input-event',{}, {type:'keyDown',key:'w',meta:true});assert.deepEqual(sent,['picker','native']);
});
