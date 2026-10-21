const test=require('node:test'),assert=require('node:assert/strict');
const {convertCredential,CLIProxy}=require('../src/cliproxy.cjs');
const {requestFor}=require('../src/gateway.cjs');
const {Store}=require('../src/store.cjs');
const id='11111111-1111-4111-8111-111111111111';
const jwt=c=>'e30.'+Buffer.from(JSON.stringify(c)).toString('base64url')+'.signature';
test('credential migration preserves account identity, expiry, and strict private prefix',()=>{
 const a={id,email:'a@example.com',orgId:'org'};
 const c=convertCredential('claude',a,{claudeAiOauth:{accessToken:'access',refreshToken:'refresh',expiresAt:2000000000000}});
 assert.equal(c.prefix,'claude-code-'+id);assert.equal(c.organization_uuid,'org');assert.equal(c.expired,'2033-05-18T03:33:20.000Z');
 assert.throws(()=>convertCredential('claude',a,{claudeAiOauth:{accessToken:'access'}}),/incomplete/);
 const raw={tokens:{access_token:jwt({exp:2000000000}),id_token:jwt({exp:1900000000,email:'a@example.com'}),refresh_token:'refresh',account_id:'workspace'}};
 assert.equal(convertCredential('codex',{...a,workspaceAccountId:'workspace'},raw).expired,'2033-05-18T03:33:20.000Z');
 assert.throws(()=>convertCredential('codex',{...a,workspaceAccountId:'wrong'},raw),/workspace/);
 assert.throws(()=>convertCredential('codex',{...a,email:'b@example.com'},raw),/identity/);
});
test('CPA route retains native tools/images and pins the exact model without credentials in provider metadata',()=>{
 const proxy=new CLIProxy('/tmp/not-started');proxy.origin='http://127.0.0.1:1';
 const p={authType:'chatgpt-subscription',protocol:'responses',proxy:proxy.route('codex',{id,mode:'codex'})};
 assert.equal(p.proxy.key,undefined);
 const body={max_tokens:1024,output_config:{effort:'high'},tools:[{name:'inspect',input_schema:{type:'object'},defer_loading:true}],messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:'image/png',data:'image'}}]}]};
 const r=requestFor(body,p,{model:'gpt-6.1-sol',meta:{}},{});
 assert.equal(r.url,'http://127.0.0.1:1/v1/messages');assert.equal(r.body.model,'chatgpt-'+id+'/gpt-6.1-sol');
 assert.deepEqual(r.body.messages,body.messages);assert.deepEqual(r.body.tools,body.tools);assert.deepEqual(r.body.output_config,body.output_config);
});
test('renderer snapshots never disclose helper credentials or private connection metadata',()=>{
 const fake={data:{providers:[]},normalizeSubscriptionReferences(){},subscriptions:{providers:()=>[{id,proxy:{key:'secret',origin:'private'},name:'account'}]},memoryKeys:new Map()};
 const snapshot=Store.prototype.snapshot.call(fake);
 assert.deepEqual(snapshot.providers,[{id,name:'account'}]);assert.ok(!JSON.stringify(snapshot).includes('secret'));
});
test('unsupported Console and non-Codex connections remain outside migrated credential ownership',()=>{
 const p=new CLIProxy('/tmp/not-started');assert.equal(p.route('claude',{id,method:'console'}),undefined);assert.equal(p.route('codex',{id,mode:'api'}),undefined);
});
test('Anthropic SSE is both forwarded and assembled, including fragmented tool JSON and thinking signatures',async()=>{
 const events=[{type:'message_start',message:{id:'m',usage:{input_tokens:3}}},{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'',signature:''}},{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'Think'}},{type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'sig'}},{type:'content_block_stop',index:0},{type:'content_block_start',index:1,content_block:{type:'tool_use',id:'t',name:'inspect',input:{}}},{type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:'{"key":'}},{type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:'"value"}'}},{type:'content_block_stop',index:1},{type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:4}},{type:'message_stop'}];
 let wire='';const result=await require('../src/gateway-stream.cjs').relay(new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')),'anthropic','model',{write:s=>wire+=s,end(){}});
 assert.deepEqual(result.content[1].input,{key:'value'});assert.equal(result.content[0].thinking,'Think');assert.equal(result.content[0].signature,'sig');assert.equal(result.usage.output_tokens,4);assert.ok(wire.includes('input_json_delta'));
});
test('cold launch rechecks connection refusal after the bundled helper is ready',async()=>{
 const handlers=new Map(),ipc={handle:(c,h)=>handlers.set(c,h)};let ready,rechecked=0;
 require('../src/startup-health.cjs').installStartupHealthRetry(ipc,'http://127.0.0.1:1',()=>{},new Promise(r=>ready=r));
 ipc.handle('x_$_Custom3pSetup_$_recheckConfigHealth',async()=>{rechecked++;return {state:'healthy'};});
 ipc.handle('x_$_Custom3pSetup_$_getConfigHealth',async()=>({endpoint:'http://127.0.0.1:1',state:'unreachable',message:'Connection refused'}));
 const work=handlers.get('x_$_Custom3pSetup_$_getConfigHealth')();await Promise.resolve();assert.equal(rechecked,0);ready();assert.equal((await work).state,'healthy');assert.equal(rechecked,1);
});
