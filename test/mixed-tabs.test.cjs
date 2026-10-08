const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require('playwright');
const {nativeFixture,available}=require('./native-ui-fixture.cjs');
const adapter=require('../scripts/patch-mixed-tabs.cjs');
const capture=path.join(process.env.E1_CAPTURE_ROOT||path.resolve(__dirname,'../../outputs/claude-desktop-decomp'),'full/original/Claude.app/Contents/Resources/ion-dist');
const stateModule=()=>import('data:text/javascript;base64,'+fs.readFileSync(path.resolve(__dirname,'../src/mixed-tab-state.js')).toString('base64'));
test('mixed tabs preserve order, select adjacent panes on close and retain native confirmations',async()=>{
  const {MixedTabs}=await stateModule(),calls=[],storage=new Map();storage.getItem=storage.get.bind(storage);storage.setItem=storage.set.bind(storage);
  const tabs=new MixedTabs({getState:()=>({closeSidePane:id=>calls.push(['close',id])})},'one',storage);
  tabs.sync(['chat','preview','file','terminal'],new Map([['file','Files']]));
  tabs.register('preview',{tabs:[{id:'page1',label:'Example'},{id:'page2',label:'New tab'}],activeId:'page1',onActivate:id=>calls.push(['select',id]),onClose:id=>calls.push(['confirm-browser-close',id])});
  tabs.activate('preview');const entries=tabs.entries();
  tabs.reorder(entries.find(e=>e.pane==='file').id,0);
  assert.deepEqual(tabs.entries().map(e=>e.pane),['file','preview','preview','terminal']);
  tabs.call(entries[0].id,'onClose');assert.deepEqual(calls.at(-1),['confirm-browser-close','page1']);
  assert.equal(tabs.entries().filter(e=>e.pane==='preview').length,2,'requested close is not treated as confirmed');
  let updates=0;tabs.subscribe(()=>updates++);
  tabs.register('preview',{...tabs.records.get('preview').props,onClose:()=>{}});
  assert.equal(updates,0,'new callback identity must not trigger a render loop');
  tabs.sync(['chat','file','terminal'],new Map());assert.equal(tabs.active,'terminal');
  const other=new MixedTabs(null,'two',storage);other.sync(['chat','file'],new Map());
  assert.equal(other.active,'file');assert.equal(tabs.active,'terminal');
  const restored=new MixedTabs(null,'one',storage);restored.sync(['chat','file','terminal'],new Map());assert.equal(restored.active,'terminal');
});

test('mixed tab patches reject source drift and compose with title protection',{skip:!available},()=>{
  const source=fs.readFileSync(path.join(capture,adapter.file),'utf8');
  const patched=adapter.patch(require('../scripts/patch-title-renderer.cjs').patch(source));
  assert.ok(patched.includes('hiddenTileIds:e1Tabs.hiddenIds'));
  assert.ok(patched.includes('layout:e1Tabs.layout'));
  assert.ok(patched.includes('value:i?.has("chat")===!0'));
  assert.ok(adapter.patchBrowser(fs.readFileSync(path.join(capture,adapter.browserFile),'utf8')).includes('e1MixedHidden=e1UseMixedHidden(),gt=m&&!e1MixedHidden'));
  assert.throws(()=>adapter.patch(patched));
  assert.throws(()=>adapter.patch(source.replace('tiles:xe,layout:ke','tiles:xe,layout:changed')));
});

test('native mixed tab strip switches types without unmounting contents or duplicating inner strips',{skip:!available},async t=>{
  const browser=await chromium.launch();t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1100,height:720}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await nativeFixture(page,'<main id="fixture" style="height:640px"></main>');
  await page.route('https://native.test/assets/v1/e1-mixed-*.js',route=>route.fulfill({path:path.resolve(__dirname,'../src',new URL(route.request().url()).pathname.split('/').at(-1).replace(/^e1-/,'')),contentType:'text/javascript'}));
  await page.route('https://native.test/assets/v1/cfe7c4b3b-GwJAekXp.js',route=>route.fulfill({body:adapter.patchTabs(fs.readFileSync(path.join(capture,adapter.tabsFile),'utf8')),contentType:'text/javascript'}));
  await page.evaluate(async()=>{
    const {aa:h,sa:createRoot,Ha:useState,Na:useEffect}=await import('/assets/v1/vendor-frame-Bk3oL3Qp.js');
    const {zc:Provider}=await import('/assets/v1/shared-frame-mKeNK6Hi.js');
    const {useMixedTabs,MixedTabFrame}=await import('/assets/v1/e1-mixed-tabs.js');
    const {t:NativeTabs}=await import('/assets/v1/cfe7c4b3b-GwJAekXp.js');
    const {useMixedPaneHidden,useMixedPreviewVisibility}=await import('/assets/v1/e1-mixed-tab-context.js');
    window.mounts={};window.closes=[];window.nativeHides=[];window.hidePreview=(...args)=>{window.nativeHides.push(args);return Promise.resolve(true)};window.newTabs=0;window.e1TabPicker={open:()=>window.newTabs++};
    const makeLayout=ids=>({root:{kind:'stack',children:ids.map(tileId=>({kind:'tile',tileId}))}});
    let state={currentSessionId:'one',tileLayout:makeLayout(['chat','preview','file','terminal']),sidePane:'terminal',focusedTile:'terminal'};
    const subscriptions=new Set();const store={getState:()=>state,setState:update=>{const previous=state;state={...state,...update};for(const cb of subscriptions)cb(state,previous)},subscribe:cb=>{subscriptions.add(cb);return()=>subscriptions.delete(cb)}};
    state.setSidePane=id=>store.setState({sidePane:id});state.toggleSidePane=id=>state.closeSidePane(id);state.setFocusedTile=id=>store.setState({focusedTile:id});state.collapseExpandedTile=()=>{};
    state.closeSidePane=id=>store.setState({tileLayout:makeLayout(state.tileLayout.root.children.filter(n=>n.tileId!==id).map(n=>n.tileId))});
    window.store=store;
    function Content({pane}){
      const [active,setActive]=useState(pane+'1');
      const [tabs,setTabs]=useState([{id:pane+'1',label:pane==='preview'?'Example domain':pane==='file'?'draft.txt':'Terminal 1'},...(pane==='preview'?[{id:'preview2',label:'New tab'}]:[])]);
      useEffect(()=>{window.mounts[pane]=(window.mounts[pane]||0)+1;return()=>window.mounts[pane]--;},[]);
      const hidden=useMixedPaneHidden();
      useMixedPreviewVisibility(pane==='preview'?'preview-server':null,'owner-1','main',window.hidePreview);
      if(pane==='preview')window.addBrowserTab=()=>{setTabs([...tabs,{id:'preview3',label:'Another page'}]);setActive('preview3');};
      return h('div',{'data-surface':pane,'data-hidden':String(hidden),children:[h(NativeTabs,{tabs,activeId:active,onActivate:setActive,onClose:id=>{window.closes.push(id);if(pane==='file')return;setTabs(tabs.filter(t=>t.id!==id));setActive(tabs.find(t=>t.id!==id)?.id);},'aria-label':pane+' tabs'}),h('label',{children:[pane+' content',h('input',{'aria-label':pane+' content',defaultValue:pane==='preview'?'https://example.com/':''})]})]});
    }
    function App(){
      const [s,set]=useState(store.getState());useEffect(()=>store.subscribe(set),[]);
      const tiles=s.tileLayout.root.children.map(n=>({id:n.tileId,name:n.tileId}));
      const model=useMixedTabs(store,s.currentSessionId,tiles,null,null);window.model=model;
      return h(Provider,{mode:'dark',children:h('div',{style:{height:'100%',background:'var(--cds-surface-1)'},children:tiles.filter(t=>t.id!=='chat').map(tile=>h('div',{style:{height:'100%',display:model.hiddenIds.has(tile.id)?'none':'block'},children:h(MixedTabFrame,{model,tile,children:h(Content,{pane:tile.id})})},tile.id))})});
    }
    window.root=createRoot(document.querySelector('#fixture'));window.root.render(h(App,{}));
  });
  const visibleTabs=()=>page.getByRole('tablist',{name:'Workspace tabs'});
  await visibleTabs().getByRole('tab',{name:/Terminal 1/}).waitFor({timeout:5000});
  assert.equal(await visibleTabs().count(),1);
  await page.getByRole('textbox',{name:'terminal content'}).fill('unsent terminal input');
  await visibleTabs().getByRole('tab',{name:/Example domain/}).click();
  assert.equal(await page.getByRole('textbox',{name:'preview content'}).inputValue(),'https://example.com/');
  await visibleTabs().getByRole('tab',{name:/draft.txt/}).click();
  await page.getByRole('textbox',{name:'file content'}).fill('unsaved draft');
  await visibleTabs().getByRole('tab',{name:/Terminal 1/}).click();
  assert.equal(await page.getByRole('textbox',{name:'terminal content'}).inputValue(),'unsent terminal input');
  assert.equal(await page.locator('[data-surface=preview]').getAttribute('data-hidden'),'true');
  await visibleTabs().getByRole('tab',{name:/draft.txt/}).click();
  assert.equal(await page.getByRole('textbox',{name:'file content'}).inputValue(),'unsaved draft');
  await visibleTabs().getByRole('tab',{name:/draft.txt/}).press('Delete');
  assert.equal(await page.getByRole('textbox',{name:'file content'}).count(),1,'native pending discard must retain file');
  assert.deepEqual(await page.evaluate(()=>window.closes),['file1']);
  await page.evaluate(()=>window.store.getState().toggleSidePane('preview'));
  await page.getByRole('textbox',{name:'preview content'}).waitFor();
  await page.screenshot({path:path.resolve(__dirname,'../evidence/mixed-tabs-fixture.png')});
  assert.equal(await visibleTabs().getByRole('tab').count(),4,'tool shortcut selects an existing tab');
  await page.getByRole('button',{name:'New tab',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.newTabs),1);
  await page.screenshot({path:path.resolve(__dirname,'../evidence/mixed-tabs-fixture.png')});
  assert.deepEqual(await page.evaluate(()=>window.mounts),{preview:1,file:1,terminal:1});
  assert.deepEqual(await page.evaluate(()=>window.nativeHides.at(-1)),['preview-server','owner-1','main']);
  await visibleTabs().getByRole('tab',{name:/Terminal 1/}).click();
  await page.evaluate(()=>window.addBrowserTab());
  await page.getByRole('textbox',{name:'preview content'}).waitFor();
  assert.equal(await page.evaluate(()=>window.model.controller.active),'preview');
  assert.equal(await visibleTabs().getByRole('tab',{name:/Another page/}).getAttribute('aria-selected'),'true');
  await page.evaluate(()=>window.root.unmount());
  assert.deepEqual(errors,[]);
});
