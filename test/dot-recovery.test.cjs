const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {chromium}=require('playwright');
const {nativeFixture,available}=require('./native-ui-fixture.cjs');

test('recovery opens E1 connections, rejects external launch actions, and preserves error codes',async()=>{
 const calls=[],handlers={},app=new EventEmitter();app.getPath=()=>'/fixture';
 class DotService{accounts(){return[{id:'one'}];}async list(){throw Object.assign(new Error('redacted challenge'),{code:'browser_verification'});}}
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/dot-tab.cjs'),'utf8'),{module,require:name=>name==='node:path'?path:name==='./dot-service.cjs'?{DotService}:name==='./dot-transport.cjs'?{createDotTransport:()=>()=>{}}:{subscriptionsFor:()=>({})},__dirname:'/fixture'});
 module.exports.installDotTab({app,shell:{openExternal:async url=>calls.push(url)}},()=>null,{openConnections:async()=>calls.push('connections')});
 const contents=Object.assign(new EventEmitter(),{session:{registerPreloadScript(){}},ipc:{handle:(key,fn)=>handlers[key]=fn},mainFrame:{url:'app://localhost/epitaxy'}});app.emit('web-contents-created',{},contents);
 const request=(op,args={},senderFrame=contents.mainFrame)=>handlers['e1:dot:request']({senderFrame},op,args);
 await assert.rejects(request('open-chatgpt',{accountId:'one'}),/Unknown Dot request/);assert.deepEqual(calls,[]);
 await assert.rejects(request('open-chatgpt',{accountId:'one'},{url:'https://chatgpt.com/'}),/Invalid Dot sender/);
 await request('connections');assert.equal(calls.at(-1),'connections');
 const error=await request('list',{accountId:'one'});assert.equal(error.dotError.code,'browser_verification');
 let api;vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/dot-preload.cjs'),'utf8'),{location:{protocol:'app:',hostname:'localhost'},require:()=>({contextBridge:{exposeInMainWorld:(_,value)=>api=value},ipcRenderer:{invoke:async()=>error}})});
 const transferred=await api.request('list');assert.equal(transferred.dotError.code,'browser_verification');assert.equal(transferred.dotError.message,'redacted challenge');
});

test('Dot shell discards stale account reads and replaces the native frame on account switches',{skip:!available},async t=>{
 const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage();
 await nativeFixture(page,'<div class="cds-root"><aside aria-label="Sidebar"><button aria-label="Customize">Customize</button></aside><main aria-label="Primary pane"></main></div>');
 await page.evaluate(()=>{window.calls=[];window.pending=[];window.e1Dot={onShow(){},request:async(op,args)=>{window.calls.push({op,args});if(op==='accounts')return[{id:'one',email:'one@test'},{id:'two',email:'two@test'}];if(op==='list')return new Promise((resolve,reject)=>window.pending.push({resolve,reject}));return{};}};});
 await page.addScriptTag({path:path.resolve(__dirname,'../src/dot-sidebar.js')});await page.getByRole('button',{name:'Your dot',exact:true}).click();await page.waitForFunction(()=>window.pending.length===1);
 await page.getByRole('combobox',{name:'Subscription'}).selectOption('two');await page.waitForFunction(()=>window.pending.length===2);
 await page.evaluate(()=>{window.pending[0].reject(Error('old account secret'));window.pending[1].reject(Error('second challenge'));});await page.getByText('second challenge').waitFor();assert.equal(await page.getByText('old account secret').count(),0);
 await page.getByRole('button',{name:'Manage connection',exact:true}).click();assert.equal(await page.evaluate(()=>window.calls.at(-1).args.accountId),'two');
 await page.getByRole('button',{name:'Retry',exact:true}).click();await page.waitForFunction(()=>window.pending.length===3);await page.evaluate(()=>window.pending[2].resolve({items:[{id:'dot2',display_name:'Dot two'}]}));await page.locator('iframe[title="Your dot"]').waitFor();assert.match(await page.locator('iframe').getAttribute('src'),/account=two&dot=dot2/);
 await page.getByRole('combobox',{name:'Subscription'}).selectOption('one');assert.equal(await page.locator('iframe').count(),0);await page.getByRole('button',{name:'Close Dot'}).click();assert.equal(await page.locator('#e1-dot-panel').count(),0);
});
