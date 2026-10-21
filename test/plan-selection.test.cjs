const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const G=require('../src/gateway.cjs'),P=require('../src/plan-selection.cjs'),E=require('../src/claude-engine.cjs');
const chat='local_11111111-1111-4111-8111-111111111111';
function fixture(claude=false){
 const model=claude?'claude-opus-5-5':'gpt-6.1-sol';
 const providers=['one','two'].map(id=>({id,name:id,accountEmail:id+'@example.test',planType:'pro',signedIn:true,billing:'subscription',authType:claude?'claude-code':'chatgpt-subscription',protocol:claude?'claude-code':'responses',models:[{id:model}]}));
 providers.push({id:'api',name:'API',protocol:'responses',baseUrl:'https://api.openai.com/v1',models:[{id:model},{id:model+'-2026-10-01'}]});
 const store={data:{providers,routing:{enabled:true,allowApiFallback:true,order:['one','two','api']}},provider:id=>providers.find(p=>p.id===id)};
 return {store,model,routes:G.catalog(store),models:G.modelCatalog(store)};
}
test('OpenAI catalog merges plans and API but preserves versions, aliases, unrelated endpoints and stable IDs',()=>{
 const f=fixture();assert.equal(f.models.length,2);const model=f.models.find(m=>m.model===f.model);
 assert.equal(model.aliases.length,3);assert.equal(model.display_name,'GPT-6.1-sol');
 f.store.data.providers.push({id:'proxy',name:'Proxy',protocol:'responses',baseUrl:'https://example.test/v1',models:[{id:f.model}]});
 assert.equal(G.modelCatalog(f.store).length,3);
 f.store.data.providers.splice(0,2);assert.equal(G.modelCatalog(f.store)[0].id,model.id);
});
test('Plan choice is exact, scoped, supports Automatic override, and pauses unavailable plans',()=>{
 const f=fixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'e1-plan-')),p=new P.PlanSelection(dir),model=f.models[0];
 try{
  assert.deepEqual(p.snapshot({modelId:model.id},f.models,f.routes,f.store).choices.map(c=>c.id),['one','two']);
  p.save({modelId:model.id,provider:'two'},f.models,f.routes,f.store);
  assert.equal(p.choice(chat,model),'two');
  p.save({modelId:model.aliases[0],chatId:chat,provider:''},f.models,f.routes,f.store);
  assert.equal(p.choice(chat,model),'');assert.equal(p.choice(null,model),'two');
  assert.throws(()=>p.save({modelId:model.id,provider:'api'},f.models,f.routes,f.store),/no longer connected/);
  assert.throws(()=>p.snapshot({modelId:model.id,chatId:'wrong'},f.models,f.routes,f.store),/Invalid chat/);
  // A paused pinned plan is unavailable rather than silently switched; legacy indefinite pauses are bounded.
  const now=Date.now();assert.deepEqual(P.pinnedRoutes('two',model,f.routes,f.store,{two:{retryAt:null,at:now}},now),[]);
  assert.deepEqual(P.pinnedRoutes('two',model,f.routes,f.store,{two:{retryAt:now+5000}},now),[]);
  assert.deepEqual(P.pinnedRoutes('two',model,f.routes,f.store,{two:{retryAt:null,at:now}},now+60001).map(r=>r.provider),['two']);
  f.store.provider('two').signedIn=false;assert.deepEqual(P.pinnedRoutes('two',model,f.routes,f.store,{}),[]);
 }finally{fs.rmSync(dir,{recursive:true});}
});
test('gateway pins only chosen chat and switches subsequent requests without changing model or history',async()=>{
 const f=fixture(true),dir=fs.mkdtempSync(path.join(os.tmpdir(),'e1-plan-gateway-')),old=E.generate,observed=[];
 f.store.dir=dir;f.store.nativeProfile=dir;const folder=path.join(dir,'claude-code-sessions/a/o');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,chat+'.json'),JSON.stringify({sessionId:chat,cliSessionId:chat.slice(6)}));
 E.generate=async(p,b,m)=>{observed.push([p.id,m,b.messages]);return {content:[{type:'text',text:'OK'}],usage:{},stop_reason:'end_turn'};};
 const gateway=await G.startGateway({store:f.store}),plans=new P.PlanSelection(dir),model=f.models[0];
 try{
  const messages=[{role:'user',content:'Preserve history'}];
  const send=metadata=>fetch(gateway.origin+'/v1/messages',{method:'POST',headers:{Authorization:'Bearer '+gateway.token},body:JSON.stringify({model:model.aliases[0],messages,metadata})});
  plans.save({modelId:model.id,chatId:chat,provider:'two'},f.models,f.routes,f.store);
  let r=await send({session_id:chat.slice(6)});assert.equal(r.status,200,await r.text());
  r=await send({});assert.equal(r.status,200,await r.text());
  plans.save({modelId:model.id,chatId:chat,provider:'one'},f.models,f.routes,f.store);
  r=await send({session_id:chat.slice(6)});assert.equal(r.status,200,await r.text());
  const sent=f.model+'[1m]';assert.deepEqual(observed,[['two',sent,messages],['one',sent,messages],['one',sent,messages]]);
  f.store.provider('one').signedIn=false;r=await send({session_id:chat.slice(6)});assert.notEqual(r.status,200);assert.equal(observed.length,3);
 }finally{gateway.close();E.generate=old;fs.rmSync(dir,{recursive:true});}
});
test('preference migration preserves old choices with backups and never expands conflicting paid consent',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'e1-pref-migration-'));
 try{
  const models=[{id:'merged',aliases:['a','b']}];
  fs.writeFileSync(path.join(dir,'speed-preferences.json'),JSON.stringify({models:{a:{mode:'fast',confirmPaid:true},b:{mode:'standard'}},chats:{[chat]:{a:{mode:'fast',confirmPaid:true}}}}));
  fs.writeFileSync(path.join(dir,'workflow-preferences.json'),JSON.stringify({models:{a:{model:'b',effort:'high'}},chats:{[chat]:{model:'a',effort:'low'}}}));
  const {migrateModelPreferences:migrate}=require('../src/model-selection.cjs');assert.equal(migrate(dir,models).length,2);
  const speed=JSON.parse(fs.readFileSync(path.join(dir,'speed-preferences.json')));assert.equal(speed.models.merged.mode,'standard');assert.equal(speed.chats[chat].merged.mode,'fast');
  const workflow=JSON.parse(fs.readFileSync(path.join(dir,'workflow-preferences.json')));assert.equal(workflow.models.merged.model,'merged');assert.equal(workflow.chats[chat].effort,'low');
  assert.equal(fs.existsSync(path.join(dir,'model-selection-backups/speed-preferences.json')),true);assert.deepEqual(migrate(dir,models),[]);
 }finally{fs.rmSync(dir,{recursive:true});}
});
