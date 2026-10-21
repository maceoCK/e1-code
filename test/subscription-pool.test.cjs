const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const G=require('../src/gateway.cjs'),R=require('../src/routing.cjs');
const {SubscriptionPool,allowance}=require('../src/subscription-pool.cjs');
const {claudeWindows,codexWindows}=require('../src/plan-usage.cjs');
function fixture(extra={}){
 const providers=['one','two','api'].map(id=>({id,name:id,protocol:'responses',baseUrl:'https://api.openai.com/v1',models:[{id:'gpt-6.1-sol'}],...(id==='api'?{}:{authType:'chatgpt-subscription',signedIn:true,accountId:id})}));
 return {data:{providers,routing:{enabled:true,order:['one','two','api'],...extra}},provider:id=>{const p=providers.find(p=>p.id===id);if(!p)throw Error('missing');return p;},key:p=>p.id};
}
const scope={session_id:'10000000-0000-0000-0000-000000000001'};
const wire=(...events)=>new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
const complete=()=>wire({type:'response.output_text.delta',output_index:0,content_index:0,delta:'RESULT'},{type:'response.completed',response:{usage:{input_tokens:5,output_tokens:2}}});
async function request(gateway,body={}){return fetch(gateway.origin+'/v1/messages',{method:'POST',headers:{Authorization:'Bearer '+gateway.token},body:JSON.stringify({model:gateway.catalog()[0].id,messages:[{role:'user',content:'hello'}],metadata:scope,...body})});}
function setupPool({strategy='reset-first',now=1000,dir}={}){const store=fixture({strategy}),routes=G.catalog(store).slice(0,2),pool=new SubscriptionPool(dir,{now:()=>now});return {pool,routes,args:{selected:routes[0],store,policy:R.policyFor(store.data.routing),scope}};}
const usage=(reset,used=20)=>({state:'live',checkedAt:1000,windows:[{scope:'account',usedPercent:used,resetsAt:reset,windowDurationMins:10080}]});
test('weekly reset ranking is sticky, persistent, and shared by child agents',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'e1-affinity-'));
 try {const {pool,routes,args}=setupPool({dir});
  let chosen=pool.select(routes,{...args,usage:{one:usage(90000),two:usage(80000)}});assert.equal(chosen.routes[0].provider,'two');
  const afterRestart=new SubscriptionPool(dir,{now:()=>1000});
  chosen=afterRestart.select(routes,{...args,scope:{session_id:'child',parent_session_id:scope.session_id},usage:{one:usage(20000),two:usage(80000)}});
  assert.equal(chosen.routes[0].provider,'two');assert.equal(chosen.reason,'session');
  assert.ok(!fs.readFileSync(path.join(dir,'subscription-affinity.json'),'utf8').includes(scope.session_id));
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('fresh applicable limits exclude accounts; stale and unrelated buckets do not',()=>{
 const {pool,routes,args}=setupPool();assert.equal(pool.select(routes,{...args,usage:{one:usage(80000,100)}}).routes[0].provider,'two');
 assert.equal(allowance({...usage(80000,100),checkedAt:-200000},'gpt-6.1-sol',1000).blocked,false);
 assert.equal(allowance({...usage(80000,100),windows:[{scope:'model',models:['other'],usedPercent:100,resetsAt:80000}]},'gpt-6.1-sol',1000).blocked,false);
 const windows=claudeWindows({five_hour:{utilization:80,resets_at:999},seven_day_opus:{utilization:100,resets_at:999}});
 assert.equal(allowance({state:'live',checkedAt:1000,windows},'claude-sonnet-5',1000).blocked,false);
 assert.equal(allowance({state:'live',checkedAt:1000,windows},'claude-opus-5',1000).blocked,true);
 assert.equal(codexWindows({rateLimits:{primary:{usedPercent:100,resetsAt:999,windowDurationMins:300}}})[0].scope,'account');
});
test('round robin only rotates new chats, unknown reset breaks ties in configured order',()=>{
 const {pool,routes,args}=setupPool({strategy:'round-robin'});
 assert.equal(pool.select(routes,args).routes[0].provider,'one');assert.equal(pool.select(routes,args).routes[0].provider,'one');
 assert.equal(pool.select(routes,{...args,scope:{session_id:'new'}}).routes[0].provider,'two');
 const next=setupPool();assert.equal(next.pool.select(next.routes,next.args).routes[0].provider,'one');
});
test('temporary failure retains affinity while quota rebinds',()=>{
 for(const status of [503,429]){const {pool,routes,args}=setupPool();const first=pool.select(routes,args);pool.failed(first.key,'one',{status});pool.succeeded(first.key,'two',args.policy);assert.equal(pool.select(routes,args).routes[0].provider,status===503?'one':'two');}
});
test('quota parsing and legacy null cooldowns recover without manual reset',()=>{
 assert.equal(R.quotaError(429,{error:{type:'rate_limit_error',resets_in_seconds:30}},new Headers(),1000).retryAt,31000);
 assert.equal(R.quotaError(429,{error:{resets_at:99}},new Headers(),1000).retryAt,99000);
 assert.equal(R.failureHealth({status:429},null,1000).retryAt,61000);
 assert.equal(R.routeHealth({provider:'one',model:'m'},{one:{retryAt:null,at:0}},60001),undefined);
 assert.equal(R.failureHealth({status:400},null,1000),null);
});
test('deleted connections and unrelated or paid models are excluded safely',()=>{
 const store=fixture();store.data.routing.order.unshift('deleted');const routes=G.catalog(store);assert.deepEqual(R.candidateRoutes(routes[0],routes,store,R.policyFor(store.data.routing),{}).map(r=>r.provider),['one','two']);
 store.data.providers[1].models=[{id:'other'}];assert.deepEqual(R.candidateRoutes(routes[0],G.catalog(store),store,R.policyFor(store.data.routing),{}).map(r=>r.provider),['one']);
});
test('credential failure falls back, reports finite cooldown, and keeps original history',async()=>{
 const store=fixture(),statuses=[],calls=[];store.key=p=>{if(p.id==='one')throw Object.assign(Error('expired'),{status:401,code:'sign_in_required'});return p.id;};
 const gateway=await G.startGateway({store,onStatus:s=>statuses.push(s),transport:async(url,options)=>{calls.push({account:options.headers.Authorization,body:JSON.parse(options.body)});return complete();}});
 try{const response=await request(gateway);assert.equal(response.status,200);assert.equal((await response.json()).content[0].text,'RESULT');assert.equal(calls[0].account,'Bearer two');assert.ok(JSON.stringify(calls[0].body).includes('hello'));assert.ok(statuses.some(s=>s.health?.one?.retryAt>Date.now()));}finally{gateway.close();}
});
test('a fresh exhausted account is skipped and an empty pool reports next reset',async()=>{
 const store=fixture(),calls=[];let all=false;store.planUsage={read:async id=>({state:'live',checkedAt:Date.now(),windows:[{scope:'account',usedPercent:id==='one'||all?100:10,resetsAt:Date.now()+60000,windowDurationMins:10080}]})};
 const gateway=await G.startGateway({store,transport:async(url,options)=>{calls.push(options.headers.Authorization);return complete();}});
 try{assert.equal((await request(gateway)).status,200);assert.deepEqual(calls,['Bearer two']);all=true;const response=await request(gateway);assert.equal(response.status,429);const data=await response.json();assert.equal(data.error.code,'pool_cooldown');assert.ok(data.error.retry_at>Date.now());assert.equal(calls.length,1);}finally{gateway.close();}
});
test('stream failures can retry before output but never replay an exposed tool call',async()=>{
 for(const exposed of [false,true]){const store=fixture(),calls=[];const gateway=await G.startGateway({store,transport:async(url,options)=>{calls.push(options.headers.Authorization);if(calls.length>1)return complete();return wire({type:'response.created',response:{}},...(exposed?[{type:'response.output_item.added',output_index:0,item:{type:'function_call',call_id:'action',name:'Write',arguments:'{}'}}]:[]),{type:'response.failed',response:{error:{code:'server_error',message:'temporary'}}});}});
 try{const text=await (await request(gateway,{stream:true})).text();assert.equal(calls.length,exposed?1:2);assert.equal(text.includes('RESULT'),!exposed);assert.equal((text.match(/event: message_start/g)||[]).length,1);}finally{gateway.close();}}
});
test('pins prohibit fallback; automatic routing never spends API funds without consent',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'e1-pin-'));const store=fixture();store.dir=dir;const calls=[];const gateway=await G.startGateway({store,transport:async(url,options)=>{calls.push(options.headers.Authorization);return new Response('{"error":{"code":"rate_limit_exceeded"}}',{status:429});}});
 try{fs.writeFileSync(path.join(dir,'plan-selection.json'),JSON.stringify({models:{[gateway.catalog()[0].id]:'one'}}));assert.equal((await request(gateway)).status,429);assert.deepEqual(calls,['Bearer one']);}finally{gateway.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('authentication refresh is single-flight across aliases and forced refresh cannot reuse a stale lookup',async()=>{
 const {CodexSubscriptions}=require('../src/codex-subscriptions.cjs');
 const manager=Object.create(CodexSubscriptions.prototype),account={id:'one',mode:'codex',profileId:'profile',codexConnected:true};
 manager.data={accountAliases:{alias:'one'},accounts:[account]};manager.authRequests=new Map();manager.save=()=>{};manager.onChange=()=>{};
 let completeNormal,refreshes=0;
 manager.helper=async()=>({request:async(_method,p)=>{if(p.refreshToken){refreshes++;return{authToken:'fresh'};}return new Promise(resolve=>completeNormal=()=>resolve({authToken:'old'}));}});
 const ordinary=manager.token('alias');await new Promise(r=>setImmediate(r));const forced1=manager.token('one',true),forced2=manager.token('alias',true);completeNormal();
 assert.equal(await ordinary,'old');assert.equal(await forced1,'fresh');assert.equal(await forced2,'fresh');assert.equal(refreshes,1);
});
test('a token response racing logout cannot revive the connection',async()=>{
 const {CodexSubscriptions}=require('../src/codex-subscriptions.cjs');const manager=Object.create(CodexSubscriptions.prototype),account={id:'one',mode:'codex',profileId:'profile',codexConnected:true};
 manager.data={accounts:[account]};manager.authRequests=new Map();let release;
 manager.helper=async()=>({request:()=>new Promise(resolve=>release=()=>resolve({authToken:'old'}))});
 const work=manager.token('one');const assertion=assert.rejects(work,e=>e.code==='sign_in_required');await new Promise(r=>setImmediate(r));account.codexConnected=false;release();await assertion;
});
test('Claude sign-in errors are authentication failures rather than generic bad requests',()=>{
 const {normalizeResult}=require('../src/claude-engine.cjs');assert.throws(()=>normalizeResult({is_error:true,result:'Not logged in. Please run /login'},{}),e=>e.status===401&&R.failureKind(e)==='authentication');
});
test('a failed affinity write does not discard a completed response',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'e1-full-'));try{fs.mkdirSync(path.join(dir,'subscription-affinity.json'));const {pool,routes,args}=setupPool({dir});assert.doesNotThrow(()=>pool.select(routes,args));assert.equal(pool.persistenceError,true);assert.equal(pool.select(routes,args).routes[0].provider,'one');}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
