const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const S=require('../src/speed-preferences.cjs'),G=require('../src/gateway.cjs'),E=require('../src/claude-engine.cjs');
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
function fixture(claude=false){
  const model=claude?'claude-opus-5-5':'gpt-6-astra';
  const providers=[{id:'plan',name:'Plan',authType:claude?'claude-code':'chatgpt-subscription',protocol:claude?'claude-code':'responses',billing:'subscription',billingMethod:'claudeai',signedIn:true,models:[{id:model}]},
    {id:'api',name:'Paid API',protocol:claude?'anthropic':'responses',baseUrl:claude?'https://api.anthropic.com/v1':'https://api.openai.com/v1',models:[{id:model}]},
    {id:'different',name:'Different model',protocol:'responses',baseUrl:'https://api.openai.com/v1',models:[{id:'gpt-6.1-sol'}]}];
  const store={data:{providers,routing:{enabled:true,allowApiFallback:false,order:['plan','api']}},provider:id=>providers.find(p=>p.id===id),key:()=> 'fixture-key'};
  const routes=G.catalog(store),models=G.modelCatalog(store,routes);return{store,routes,models,selected:models[0]};
}
test('paid speed requires explicit confirmation and the same model on an API connection',()=>{
  const f=fixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'e1-speed-')),prefs=new S.SpeedPreferences(dir);
  try{
    const value={parentModel:f.selected.id,chatId:'local_'+id,mode:'ultrafast',apiProvider:'api'};
    assert.throws(()=>prefs.save(value,f.models,f.routes,f.store),/Confirm paid/);
    assert.throws(()=>prefs.save({...value,confirmPaid:true,apiProvider:'plan'},f.models,f.routes,f.store),/eligible API/);
    assert.throws(()=>prefs.save({...value,confirmPaid:true,apiProvider:'different'},f.models,f.routes,f.store),/eligible API/);
    prefs.save({...value,confirmPaid:true},f.models,f.routes,f.store);
    assert.equal(S.preferenceFor(prefs.read(),'local_'+id,f.selected.id).mode,'ultrafast');
    assert.equal(S.preferenceFor(prefs.read(),'local_'+other,f.selected.id).mode,'standard');
    prefs.save({...value,mode:'standard'},f.models,f.routes,f.store);
    assert.equal(S.preferenceFor(prefs.read(),'local_'+id,f.selected.id).mode,'standard');
    assert.deepEqual(S.modesFor('claude-sonnet-5-5'),['standard']);
    assert.deepEqual(S.modesFor('claude-opus-4-7'),['standard']);
  }finally{fs.rmSync(dir,{recursive:true});}
});
test('gateway switches only the opted-in chat to paid speed and reports delivered tier',async()=>{
  for(const claude of [false,true]){
    const f=fixture(claude),dir=fs.mkdtempSync(path.join(os.tmpdir(),'e1-speed-gateway-'));
    f.store.nativeProfile=dir;const sessions=path.join(dir,'claude-code-sessions/a/o');fs.mkdirSync(sessions,{recursive:true});
    for(const n of [id,other])fs.writeFileSync(path.join(sessions,'local_'+n+'.json'),JSON.stringify({sessionId:'local_'+n,cliSessionId:n}));
    f.store.data.speedPreferences={chats:{['local_'+id]:{[f.selected.id]:{mode:claude?'fast':'ultrafast',apiProvider:'api',confirmPaid:true}}}};
    const calls=[],statuses=[];
    const gateway=await G.startGateway({store:f.store,onStatus:s=>statuses.push({...s}),transport:async(url,opts)=>{
      const body=JSON.parse(opts.body);calls.push({url,headers:opts.headers,body});
      return new Response(JSON.stringify(claude?{content:[{type:'text',text:'OK'}],usage:{input_tokens:1,output_tokens:1,speed:'fast'},stop_reason:'end_turn'}:{output:[{type:'message',content:[{type:'output_text',text:'OK'}]}],service_tier:'ultrafast',usage:{input_tokens:1,output_tokens:1}}),{headers:{'content-type':'application/json'}});
    }});
    try{
      const history=[{role:'user',content:'KEEP_HISTORY'}];
      const response=await fetch(gateway.origin+'/v1/messages',{method:'POST',headers:{Authorization:'Bearer '+gateway.token},body:JSON.stringify({model:f.selected.id,metadata:{user_id:JSON.stringify({session_id:id})},messages:history})});
      assert.equal(response.status,200,await response.text());
      assert.equal(calls[0].body.model,f.selected.model);assert.match(JSON.stringify(calls[0].body),/KEEP_HISTORY/);
      assert.equal(statuses.at(-1).billing,'api');assert.equal(statuses.at(-1).paidSpeedOverride,true);
      assert.equal(statuses.at(-1).actualSpeed,claude?'fast':'ultrafast');
      if(claude){assert.equal(calls[0].body.speed,'fast');assert.equal(calls[0].headers['anthropic-beta'],'fast-mode-2026-02-01');}
      else assert.equal(calls[0].body.service_tier,'ultrafast');
      const router=new S.SpeedRouter(dir);
      assert.equal(router.select({metadata:{user_id:JSON.stringify({session_id:other})}},f.selected,f.store.data.speedPreferences,f.routes,f.store,{}).route,null);
    }finally{gateway.close();fs.rmSync(dir,{recursive:true});}
  }
});
test('speed limits do not pause standard routing, and stale/unconfirmed preferences never fall through to paid requests',()=>{
  const f=fixture(),pref={mode:'fast',apiProvider:'api',confirmPaid:true};
  const health={[S.healthKey('api',f.selected.model,'fast')]:{retryAt:null}};
  assert.throws(()=>S.paidRoute(f.selected,pref,f.routes,f.store,health),/paused/);
  assert.equal(S.paidRoute(f.selected,{mode:'standard'},f.routes,f.store,health),null);
  assert.throws(()=>S.paidRoute(f.selected,{...pref,confirmPaid:false},f.routes,f.store),/confirm/);
  assert.throws(()=>S.paidRoute(f.selected,{...pref,apiProvider:'removed'},f.routes,f.store),/unavailable/);
  const out=S.applySpeed({body:{speed:'fast',service_tier:'ultrafast'}},f.store.provider('api'),'standard');
  assert.equal(out.body.service_tier,'default');assert.equal(out.body.speed,undefined);
});
test('Claude Console receives per-request Fast setting without changing the selected model or shared settings',async()=>{
  let args;
  const launch=(_file,a)=>{
    args=a;const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.stdin=new PassThrough();c.kill=()=>{};
    c.stdin.on('finish',()=>{c.stdout.write(JSON.stringify({type:'assistant',message:{usage:{speed:'fast'}}})+'\n');c.stdout.write(JSON.stringify({type:'result',subtype:'success',structured_output:{text:'OK',tool_calls:[]},usage:{input_tokens:1,output_tokens:1},modelUsage:{'claude-opus-5-5':{}}})+'\n');c.emit('close',0);});return c;
  };
  const p={signedIn:true,billingMethod:'console',billing:'api',executable:'/fixture',configDir:'/fixture'};
  const result=await E.generate(p,{messages:[],speed:'fast'},'claude-opus-5-5',undefined,()=>{},launch);
  assert.deepEqual(JSON.parse(args[args.indexOf('--settings')+1]),{fastMode:true});
  assert.equal(args[args.indexOf('--model')+1],'claude-opus-5-5');assert.equal(result.claudeCode.speed,'fast');
  await assert.rejects(E.generate({...p,billingMethod:'claudeai'},{messages:[],speed:'fast'},'claude-opus-5-5'),/Console API/);
});
test('Claude organization Fast restriction stops the request instead of silently buying standard inference',async()=>{
  let killed=false;
  const launch=()=>{const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.stdin=new PassThrough();c.kill=()=>{killed=true;queueMicrotask(()=>c.emit('close',null));};c.stdin.on('finish',()=>c.stdout.write(JSON.stringify({type:'system',subtype:'init',fast_mode_state:'off',fast_mode_disabled_reason:'preference'})+'\n'));return c;};
  await assert.rejects(E.generate({signedIn:true,billingMethod:'console',executable:'/fixture',configDir:'/fixture'},{messages:[],speed:'fast'},'claude-opus-5-5',undefined,()=>{},launch),/organization has disabled Fast mode/);
  assert.equal(killed,true);
});
