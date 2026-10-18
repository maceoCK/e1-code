const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
const {nativeFixture,available}=require('./native-ui-fixture.cjs');
const {DotService}=require('../src/dot-service.cjs');
const {createDotTransport}=require('../src/dot-transport.cjs');
function service(transport){const account={mode:'codex',codexConnected:true,workspaceAccountId:'one',email:'one@example.test'};return {account,api:new DotService({account:()=>account,token:async()=> 'token',transport})};}
test('Dot rejects data returned after a connection changes identity',async()=>{
 let finish;const {account,api}=service(async()=>new Promise(r=>finish=r));
 const pending=api.request('one','/tbo/primary');await new Promise(r=>setImmediate(r));account.workspaceAccountId='two';finish(Response.json({private:'old-account'}));await assert.rejects(pending,/connection changed/);
});
test('Dot lists follow opaque cursors and stop repeated cursors',async()=>{
 const calls=[];const {api}=service(async url=>{calls.push(url);if(url.endsWith('/primary'))return Response.json({selection:null});return Response.json({items:[{id:url.includes('cursor=')?'second':'first'}],cursor:url.includes('cursor=')?null:'opaque+/=?'});});
 assert.deepEqual((await api.list('one')).items.map(p=>p.id),['first','second']);assert.ok(calls.some(u=>u.includes('cursor=opaque%2B%2F%3D%3F')));
 api.subscriptions.transport=async()=>Response.json({items:[],cursor:'same'});await assert.rejects(api.pages('one','/tbo?limit=25'),/could not finish/);
});
test('Cloud task reads require attached task membership and matching response identity',async()=>{
 const {api}=service(async()=>Response.json({thread:{id:'wrong'}}));api.profiles.set('one',new Map([['dot',{id:'dot'}]]));api.tasks.set('one\0dot',new Set(['thread']));
 await assert.rejects(api.task('one','dot','other'),/attached/);await assert.rejects(api.task('one','dot','thread'),/unexpected task/);
});
test('Cloud transport allows only recovered read routes',async()=>{
 const calls=[];const transport=createDotTransport({app:{whenReady:async()=>{},getVersion:()=> 'test'},session:{fromPartition:()=>({setUserAgent(){},fetch:async(...a)=>calls.push(a)})}});
 await transport('one','https://codex-cloud-backend.chatgpt.com/v1/threads/thread',{method:'GET'});
 for(const [url,method] of [['https://codex-cloud-backend.chatgpt.com/v1/threads/thread','POST'],['https://codex-cloud-backend.chatgpt.com/v1/admin','GET'],['https://evil.test/v1/threads/thread','GET']])await assert.rejects(transport('one',url,{method}),/Invalid Dot/);
 assert.equal(calls.length,1);
});
test('Avatar fetches omit credentials and only return bounded raster data',async()=>{
 const calls=[];const transport=createDotTransport({app:{whenReady:async()=>{},getVersion:()=> 'test'},session:{fromPartition:()=>({setUserAgent(){},fetch:async(...a)=>{calls.push(a);return Response.json({});}})}});
 await transport('one','https://files.oaiusercontent.com/avatar.png',{method:'GET',headers:{Authorization:'Bearer private'},credentials:'include'});assert.deepEqual(calls[0][1].headers,{});assert.equal(calls[0][1].credentials,'omit');
 const {api}=service();api.profiles.set('one',new Map([['dot',{id:'dot',avatar_url:'https://files.oaiusercontent.com/avatar.png'}]]));
 api.transport=async()=>new Response('pixels',{headers:{'content-type':'image/png'}});assert.match(await api.avatar('one','dot'),/^data:image\/png;base64,/);
 api.avatars.clear();api.transport=async()=>new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}});await assert.rejects(api.avatar('one','dot'),/Unsupported/);
 api.transport=async()=>new Response(new Uint8Array(4*1024*1024+1),{headers:{'content-type':'image/png'}});await assert.rejects(api.avatar('one','dot'),/too large/);
 api.profiles.get('one').get('dot').avatar_url='https://evil.test/a.png';await assert.rejects(api.avatar('one','dot'),/host/);
});
