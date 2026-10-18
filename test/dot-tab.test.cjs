const {test}=require('node:test'),assert=require('node:assert/strict');
const {DotService,BASE}=require('../src/dot-service.cjs');
function fixture(){const calls=[],accounts=[{id:'one',mode:'codex',codexConnected:true,connected:true,workspaceAccountId:'workspace-one'},{id:'two',mode:'codex',codexConnected:true,connected:true,workspaceAccountId:'workspace-two'}];const manager={snapshot:()=>({accounts}),account:id=>{const a=accounts.find(a=>a.id===id);if(!a)throw Error('Unknown account');return a;},token:async(id,refresh)=>id+(refresh?'-refreshed':'-token'),transport:async(url,options)=>{calls.push({url,...options});if(url.endsWith('/primary'))return Response.json({selection:{thread_id:'root'}});if(url.includes('/tbo?'))return Response.json({items:[{id:'dot-'+options.headers['ChatGPT-Account-ID'],messaging_room_id:'room-one',active_root_thread_id:'root'}]});if(url.includes('/threads?'))return Response.json({items:[]});if(url.includes('/messages?'))return Response.json({items:[{id:'m1',content:{text:'Fixture'}}]});if(url.endsWith('/room-one'))return Response.json({id:'room-one',type:'DM',app_source:'chatgpt:messaging'});return Response.json({status:'applied'});}};return{api:new DotService(manager),manager,calls};}
test('Dot requests stay on recovered backend and account boundaries',async()=>{const f=fixture();await f.api.list('one');await f.api.list('two');const d=await f.api.detail('one','dot-workspace-one');assert.equal(d.messages[0].content.text,'Fixture');assert.ok(f.calls.every(c=>c.url.startsWith(BASE+'/')&&c.redirect==='error'));assert.equal(f.calls.at(-1).headers.Authorization,'Bearer one-token');await assert.rejects(f.api.detail('two','dot-workspace-one'),/select its Dot/);await assert.rejects(f.api.runtime('one','../bad','pause'),/identifier/);await assert.rejects(f.api.runtime('one','dot-workspace-one','delete'),/Unknown/);});
test('Dot reports denied scope without exposing server payload; refreshes once on 401',async()=>{const f=fixture();let count=0;f.manager.transport=async()=>{count++;return new Response('do not surface server secrets',{status:count===1?401:403});};await assert.rejects(f.api.request('one','/tbo/primary'),error=>error.message.includes('HTTP 403')&&!error.message.includes('secrets'));assert.equal(count,2);});
test('Dot disconnection prevents use of cached profile and returned results',async()=>{const f=fixture();await f.api.list('one');f.manager.account('one').codexConnected=false;await assert.rejects(f.api.detail('one','dot-workspace-one'),/Reconnect this subscription/);});

test('browser challenges have a stable code and never expose challenge HTML',async()=>{const f=fixture();f.manager.transport=async()=>new Response('sensitive challenge HTML',{status:403,headers:{'cf-mitigated':'challenge'}});await assert.rejects(f.api.list('one'),error=>error.code==='browser_verification'&&!error.message.includes('sensitive'));});

test('compound Dot identifiers from the real service are accepted without allowing path injection',async()=>{
 const f=fixture(),profile={id:'dot-one~workspace-one',messaging_room_id:null};
 f.api.profiles.set('one',new Map([[profile.id,profile]]));
 await f.api.detail('one',profile.id);
 assert.equal(f.calls.at(-1).url,BASE+'/tbo/dot-one~workspace-one/threads?limit=100&include_hidden=true');
 for(const value of ['../bad','one/two','one?query','one%2Ftwo','one#fragment'])await assert.rejects(f.api.detail('one',value),/Invalid Dot identifier/);
});

test('message reads and pagination stay within the server page limit',async()=>{
 const f=fixture();await f.api.list('one');await f.api.detail('one','dot-workspace-one');await f.api.older('one','dot-workspace-one','cursor-one');
 const requests=f.calls.filter(c=>c.url.includes('/messages?'));
 assert.equal(requests.length,2);
 for(const call of requests)assert.equal(new URL(call.url).searchParams.get('limit'),'20');
 assert.equal(new URL(requests[1].url).searchParams.get('before'),'cursor-one');
});
