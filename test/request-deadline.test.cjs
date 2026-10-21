const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {createDeadline,timeoutPolicy}=require('../src/request-deadline.cjs');
const {generate}=require('../src/claude-engine.cjs');
const G=require('../src/gateway.cjs');
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
test('active responses survive five minutes while the total bound remains enforced',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const d=createDeadline();
 for(let i=0;i<12;i++){t.mock.timers.tick(299000);d.touch();assert.equal(d.signal.aborted,false);}
 t.mock.timers.tick(12000);assert.equal(d.signal.reason.timeoutPhase,'total');assert.equal(d.signal.reason.status,504);
});
test('silence distinguishes waiting for a response from a stalled response',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const first=createDeadline();t.mock.timers.tick(300000);assert.equal(first.signal.reason.timeoutPhase,'first_byte');
 const idle=createDeadline();idle.touch();t.mock.timers.tick(300000);assert.equal(idle.signal.reason.timeoutPhase,'idle');
});
test('response bytes refresh idle time and cancellation reaches the underlying reader',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let upstream,cancelled=false;
 const d=createDeadline(),response=d.observe(new Response(new ReadableStream({start(c){upstream=c;},cancel(){cancelled=true;}})));
 const reader=response.body.getReader();let read=reader.read();upstream.enqueue(new TextEncoder().encode('one'));await read;
 t.mock.timers.tick(299000);read=reader.read();upstream.enqueue(new TextEncoder().encode('two'));await read;
 t.mock.timers.tick(299000);assert.equal(d.signal.aborted,false);
 const failed=assert.rejects(reader.read(),e=>e.status===504&&e.timeoutPhase==='idle');t.mock.timers.tick(1001);await failed;await flush();assert.equal(cancelled,true);
});
test('caller cancellation retains its identity and completed deadlines are inert',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const parent=new AbortController(),reason=Error('user stopped'),d=createDeadline(parent.signal);parent.abort(reason);assert.equal(d.signal.reason,reason);
 const complete=createDeadline();complete.close();t.mock.timers.tick(4000000);assert.equal(complete.signal.aborted,false);
 assert.deepEqual(timeoutPolicy({firstByteMs:NaN,idleMs:-1,totalMs:Infinity}),{firstByteMs:300000,idleMs:1000,totalMs:3600000});
});
function fakeChild(){const child=new EventEmitter();for(const name of ['stdin','stdout','stderr'])child[name]=new PassThrough();child.kills=0;child.kill=()=>{child.kills++;};return child;}
const provider={signedIn:true,executable:'fixture',configDir:'/tmp/e1-timeout-fixture'};
test('Claude partial output keeps long inference alive and a result completes normally',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const child=fakeChild();
 const work=generate(provider,{messages:[]},'sonnet',undefined,undefined,(_exe,args)=>{assert.ok(args.includes('--include-partial-messages'));return child;});
 for(let i=0;i<3;i++){t.mock.timers.tick(200000);child.stdout.write('{"type":"stream_event"}\n');}
 child.stdout.write(JSON.stringify({type:'result',subtype:'success',structured_output:{text:'OK',tool_calls:[]}})+'\n');child.emit('close',0);
 assert.equal((await work).content[0].text,'OK');assert.equal(child.kills,0);
});
test('a silent Claude process is killed and reports a timeout even before its close event',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const child=fakeChild();const work=generate(provider,{messages:[]},'sonnet',undefined,undefined,()=>child);
 const failed=assert.rejects(work,e=>e.status===504&&e.code==='provider_timeout');t.mock.timers.tick(300000);await failed;assert.equal(child.kills,1);
});
function fixture(enabled=true){const providers=['one','two'].map(id=>({id,name:id,authType:'chatgpt-subscription',signedIn:true,accountId:id,protocol:'responses',baseUrl:'https://api.openai.com/v1',models:[{id:'gpt-6.1-sol'}]}));return{data:{providers,routing:{enabled,order:['one','two'],requestTimeouts:{firstByteMs:1000,idleMs:1000}}},provider:id=>providers.find(p=>p.id===id),key:p=>p.id};}
const textEvent={type:'response.output_text.delta',output_index:0,content_index:0,delta:'OK'};
const complete={type:'response.completed',response:{usage:{}}};
const wire=e=>'data: '+JSON.stringify(e)+'\n\n';
const ok=()=>new Response(wire(textEvent)+wire(complete),{headers:{'content-type':'text/event-stream'}});
const request=(g,stream=false)=>fetch(g.origin+'/v1/messages',{method:'POST',headers:{Authorization:'Bearer '+g.token},body:JSON.stringify({model:g.catalog()[0].id,stream,messages:[{role:'user',content:'hello'}]})});
test('gateway retries a first-byte timeout on the next subscription and classifies health',async()=>{
 const calls=[],statuses=[];const g=await G.startGateway({store:fixture(),onStatus:s=>statuses.push(s),transport:async(_url,o)=>{calls.push(o.headers.Authorization);if(calls.length>1)return ok();return new Promise((_r,reject)=>o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true}));}});
 try{const r=await request(g);assert.equal(r.status,200);assert.equal((await r.json()).content[0].text,'OK');assert.deepEqual(calls,['Bearer one','Bearer two']);assert.ok(statuses.some(s=>s.health?.one?.code==='provider_timeout'));}finally{g.close();}
});
test('gateway returns HTTP 504 rather than invalid request when no fallback is enabled',async()=>{
 const g=await G.startGateway({store:fixture(false),transport:async(_url,o)=>new Promise((_r,reject)=>o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true}))});
 try{const r=await request(g);assert.equal(r.status,504);assert.equal((await r.json()).error.code,'provider_timeout');}finally{g.close();}
});
test('a timeout after exposing a tool call never retries that action on another account',async()=>{
 let calls=0,cancelled=false;const g=await G.startGateway({store:fixture(),transport:async()=>{calls++;return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(wire({type:'response.output_item.added',output_index:0,item:{type:'function_call',call_id:'action',name:'Write',arguments:'{}'}})));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}});}});
 try{const r=await request(g,true),body=await r.text();assert.equal(calls,1);assert.equal(cancelled,true);assert.match(body,/provider_timeout/);assert.equal((body.match(/"id":"action"/g)||[]).length,1);}finally{g.close();}
});
