const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {CLIProxy}=require('../src/cliproxy.cjs');
const {Store}=require('../src/store.cjs');
const {entryFor,prefix,protocolFor}=require('../src/proxy-providers.cjs');
const {startGatewayWorker}=require('../src/gateway-host.cjs');
const {relay}=require('../src/gateway-stream.cjs');
const {requestFor,responseFor}=require('../src/gateway.cjs');
const P=require('../src/providers.cjs');
test('API config uses stable private prefixes, preserves model IDs, and excludes native Ollama',()=>{
 const p={id:'custom',protocol:'chat',baseUrl:'https://example.invalid/v1',models:[{id:'org/model',compat:{maxTokensField:'max_completion_tokens'}}]};
 const {entry,group}=entryFor(p,'fixture-key');assert.equal(group,'openai-compatibility');assert.equal(entry.prefix,prefix('custom'));assert.equal(entry.models[0].name,'org/model');assert.equal(entry.models[0]['use-max-completion-tokens'],true);
 assert.equal(protocolFor({protocol:'ollama'}),null);assert.equal(protocolFor({protocol:'responses'}),null);assert.equal(protocolFor({authType:'chatgpt-subscription',protocol:'responses'}),null);
 assert.equal(protocolFor({authType:'claude-code',billingMethod:'console'}),'anthropic');
});
// The pinned helper is fetched by third_party/cliproxyapi/fetch.py and is not committed.
const binary=path.resolve(__dirname,'../third_party/cliproxyapi/cli-proxy-api');
// 1x1 PNG generated inline so the fixture needs no binary test asset.
const fixtureImage='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
test('real bundled CPA handles API protocols, native tools, images, settings changes and errors',{timeout:90000,skip:!fs.existsSync(binary)&&'bundled CLIProxyAPI binary not present; run third_party/cliproxyapi/fetch.py'},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'e1-api-test-')),seen=[];let gateway,proxy,settings,cancelled=false;
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;
  const b=JSON.parse(raw||'{}');seen.push({url:req.url,headers:req.headers,body:b});
  if(req.url.endsWith('/models'))return res.end(JSON.stringify({data:[{id:'fixture-model'}]}));
  if(b.model==='cancel'){res.on('close',()=>{cancelled=true;});return;}
  if(b.model==='invalid'){res.writeHead(401,{'content-type':'application/json'});return res.end(JSON.stringify({error:{message:'fixture invalid credential'}}));}
  if(b.model==='limited' && req.headers.authorization!=='Bearer backup-key'){res.writeHead(429,{'content-type':'application/json','retry-after':'1'});return res.end(JSON.stringify({error:{message:'fixture quota',type:'rate_limit_error'}}));}
  const wantsTool=JSON.stringify(b).includes('CALL_FIXTURE')&&!JSON.stringify(b).includes('FIXTURE_RESULT');
  const txt='FIXTURE_OK';const tool={id:'call_fixture',type:'function',function:{name:'inspect_value',arguments:'{"key":"migration"}'}};
  const anth={id:'msg_fixture',type:'message',role:'assistant',model:b.model,content:wantsTool?[{type:'tool_use',id:tool.id,name:tool.function.name,input:{key:'migration'}}]:[{type:'text',text:txt}],stop_reason:wantsTool?'tool_use':'end_turn',usage:{input_tokens:11,output_tokens:4}};
  const chat={id:'chat_fixture',object:'chat.completion',model:b.model,choices:[{index:0,message:{role:'assistant',content:wantsTool?null:txt,...(wantsTool?{tool_calls:[tool]}:{})},finish_reason:wantsTool?'tool_calls':'stop'}],usage:{prompt_tokens:11,completion_tokens:4,total_tokens:15}};
  const output=wantsTool?[{id:'fc_fixture',type:'function_call',call_id:tool.id,name:tool.function.name,arguments:tool.function.arguments,status:'completed'}]:[{id:'msg_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:txt,annotations:[]}]}];
  const response={id:'resp_fixture',object:'response',model:b.model,status:'completed',output,usage:{input_tokens:11,output_tokens:4,total_tokens:15}};
  if(req.url==='/api/chat'){res.setHeader('content-type','application/x-ndjson');return res.end(JSON.stringify({message:{role:'assistant',content:txt},done:true,done_reason:'stop'})+'\n');}
  if(!b.stream){res.setHeader('content-type','application/json');return res.end(JSON.stringify(req.url.split('?')[0].endsWith('/messages')?anth:req.url.endsWith('/responses')?response:chat));}
  res.setHeader('content-type','text/event-stream');const event=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
  if(req.url.split('?')[0].endsWith('/messages')){
   event('message_start',{message:{...anth,content:[],stop_reason:null}});event('content_block_start',{index:0,content_block:wantsTool?{...anth.content[0],input:{}}:{type:'text',text:''}});
   event('content_block_delta',{index:0,delta:wantsTool?{type:'input_json_delta',partial_json:tool.function.arguments}:{type:'text_delta',text:txt}});event('content_block_stop',{index:0});event('message_delta',{delta:{stop_reason:anth.stop_reason},usage:{output_tokens:4}});event('message_stop',{});
  }else if(req.url.endsWith('/responses')){
   event('response.created',{response:{...response,status:'in_progress',output:[]}});event('response.output_item.added',{output_index:0,item:{...output[0],...(wantsTool?{arguments:''}:{content:[]})}});
   if(wantsTool)event('response.function_call_arguments.delta',{item_id:'fc_fixture',output_index:0,delta:tool.function.arguments});
   else{event('response.content_part.added',{item_id:'msg_fixture',output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});event('response.output_text.delta',{item_id:'msg_fixture',output_index:0,content_index:0,delta:txt});}
   event('response.output_item.done',{output_index:0,item:output[0]});event('response.completed',{response});
  }else{
   res.write('data: '+JSON.stringify({...chat,object:'chat.completion.chunk',choices:[{index:0,delta:wantsTool?{tool_calls:[{index:0,...tool}]}:{role:'assistant',content:txt},finish_reason:null}],usage:undefined})+'\n\n');
   res.write('data: '+JSON.stringify({...chat,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:wantsTool?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n');
  }res.end();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/v1';
 try{
  const store=new Store(dir);store.data.providers=['chat','responses','anthropic'].map(protocol=>({id:protocol,name:protocol,protocol,baseUrl:base,models:[{id:'fixture-model'},{id:'limited'},{id:'org/custom-model'},{id:'cancel'},{id:'invalid'}],preferredModel:'fixture-model'}));
  store.data.routing={enabled:false};for(const p of store.data.providers)store.memoryKeys.set(p.id,'fixture-'+p.id);
  proxy=store.proxy=new CLIProxy(dir,{binary,store});
  const requests=[];gateway=await startGatewayWorker({store,onRequest:r=>requests.push(r)});await gateway.ready;
  const ask=async(p,messages,extra={})=>{
   const route=gateway.routes().find(r=>r.provider===p&&r.model===(extra.model||'fixture-model'));
   const r=await fetch(gateway.origin+'/v1/messages',{method:'POST',headers:{Authorization:'Bearer '+gateway.token},body:JSON.stringify({model:route.id,max_tokens:128,messages,stream:true,...extra,model:route.id})});
   return extra.stream===false?r.json():relay(r,'anthropic',route.id,{write(){},end(){}});
  };
  const tool={name:'inspect_value',description:'Fixture',input_schema:{type:'object',properties:{key:{type:'string'}},required:['key']}};
  for(const p of store.data.providers){await t.test(p.protocol,async()=>{
   const result=await ask(p.id,[{role:'user',content:[{type:'text',text:'Native reminder'},{type:'text',text:'Hello'}]},...(p.protocol==='chat'?[{role:'system',content:'Desktop environment instructions'}]:[])]);assert.equal(result.content[0].text,'FIXTURE_OK');assert.equal(result.usage.input_tokens,11);
   await new Promise(r=>setTimeout(r,20));if(p.protocol==='responses'){assert.equal(store.provider(p.id).proxy,undefined);assert.equal(requests.at(-1).proxyTraceId,undefined);}else{assert.equal(requests.at(-1).engine,'CLIProxyAPI');assert.ok(requests.at(-1).proxyTraceId);}
   assert.equal(seen.at(-1).headers.authorization,'Bearer fixture-'+p.id);
   if(p.protocol==='chat')assert.equal(seen.at(-1).body.messages.find(m=>m.role==='user').content,'Native reminder\nHello');
   if(p.protocol==='chat'){
    assert.match(seen.at(-1).body.messages[0].content,/Desktop environment instructions/);
    assert.deepEqual(seen.at(-1).body.messages.map(m=>m.role),['system','user']);
   }
   assert.equal(seen.at(-1).body.model,'fixture-model');assert.equal(seen.at(-1).body[p.protocol==='responses'?'max_output_tokens':'max_tokens'],128);assert.equal(seen.at(-1).url.split('?')[0],p.protocol==='chat'?'/v1/chat/completions':p.protocol==='responses'?'/v1/responses':'/v1/messages');
   const first=await ask(p.id,[{role:'user',content:'CALL_FIXTURE'}],{tools:[tool]});assert.equal(first.content.find(c=>c.type==='tool_use')?.input.key,'migration');
   const use=first.content.find(c=>c.type==='tool_use');
   const second=await ask(p.id,[{role:'user',content:'CALL_FIXTURE'},{role:'assistant',content:first.content},{role:'user',content:[{type:'tool_result',tool_use_id:use.id,content:'FIXTURE_RESULT'}]}],{tools:[tool]});assert.equal(second.content[0].text,'FIXTURE_OK');
   const buffered=await ask(p.id,[{role:'user',content:'Hello'}],{stream:false});assert.equal(buffered.content[0].text,'FIXTURE_OK');
   const image=fixtureImage;
   await ask(p.id,[{role:'user',content:[{type:'text',text:'Describe'},{type:'image',source:{type:'base64',media_type:'image/png',data:image}}]}]);assert.ok(JSON.stringify(seen.at(-1).body).includes(image));
   const vision=require('../src/vision-provider.cjs').createVisionProvider({store,transport:fetch,requestFor,responseFor,relay});
   const visionResult=await vision.run({route:gateway.routes().find(r=>r.provider===p.id),content:[{type:'text',text:'describe'},{type:'image',source:{type:'base64',media_type:'image/png',data:image}}]});assert.equal(visionResult.content[0].text,'FIXTURE_OK');
   let legacy='';for await(const e of P.generate(store.provider(p.id),store.key(store.provider(p.id)),'fixture-model',[{role:'user',content:'hello'}],{}))if(e.type==='delta')legacy+=e.text;assert.equal(legacy,'FIXTURE_OK');
  });}
  store.memoryKeys.set('chat','changed-key');await gateway.refreshProviders();await ask('chat',[{role:'user',content:'Hello'}]);assert.equal(seen.at(-1).headers.authorization,'Bearer changed-key');
  await t.test('quota failure can fall back through CPA while retaining original messages',async()=>{
   store.data.providers.push({id:'backup',name:'backup',protocol:'chat',baseUrl:base,models:[{id:'limited'}]});store.memoryKeys.set('backup','backup-key');
   await gateway.refreshProviders();gateway.updateRouting({enabled:true,allowApiFallback:true,order:['chat','backup'],sessionAffinity:false});
   const result=await ask('chat',[{role:'user',content:'remember migration 17'},{role:'assistant',content:'migration 17'},{role:'user',content:'Hello'}],{model:'limited'});
   assert.equal(result.content[0].text,'FIXTURE_OK');assert.equal(seen.at(-1).headers.authorization,'Bearer backup-key');assert.match(JSON.stringify(seen.at(-1).body),/remember migration 17/);
   gateway.updateRouting({enabled:false});await proxy.reset('chat');gateway.resetHealth('chat');
  });
  await t.test('explicit account errors remain visible with no fallback',async()=>{
   await assert.rejects(()=>ask('chat',[{role:'user',content:'Hello'}],{model:'limited'}),/429/);
   await proxy.reset('chat');gateway.resetHealth('chat');
  });
  await t.test('slash model IDs and local keyless endpoints retain exact routing',async()=>{
   await ask('chat',[{role:'user',content:'Hello'}],{model:'org/custom-model'});assert.equal(seen.at(-1).body.model,'org/custom-model');
   store.data.providers.push({id:'keyless',name:'keyless',protocol:'chat',baseUrl:base,models:[{id:'fixture-model'}]});await gateway.refreshProviders();
   await ask('keyless',[{role:'user',content:'Hello'}]);assert.equal(seen.at(-1).headers.authorization,undefined);
  });
  await t.test('cleared API key cannot silently reuse the old credential',async()=>{
   store.memoryKeys.delete('anthropic');await gateway.refreshProviders();const count=seen.length;
   await assert.rejects(()=>ask('anthropic',[{role:'user',content:'Hello'}]),/credential/);assert.equal(seen.length,count);
   store.memoryKeys.set('anthropic','fixture-anthropic');await gateway.refreshProviders();gateway.resetHealth('anthropic');await ask('anthropic',[{role:'user',content:'Hello'}]);
  });
  await t.test('retained native Ollama path supports tools and legacy NDJSON',async()=>{
   store.data.providers.push({id:'ollama',name:'Ollama',protocol:'ollama',baseUrl:base.replace('/v1',''),models:[{id:'fixture-model'}]});await gateway.refreshProviders();
   assert.equal(store.provider('ollama').proxy,undefined);assert.equal((await ask('ollama',[{role:'user',content:'Hello'}])).content[0].text,'FIXTURE_OK');
   let answer='';for await(const e of P.generate(store.provider('ollama'),'','fixture-model',[{role:'user',content:'Hello'}],{}))if(e.type==='delta')answer+=e.text;assert.equal(answer,'FIXTURE_OK');
  });
  await t.test('invalid credentials surface without an unapproved account switch',async()=>{
   await assert.rejects(()=>ask('chat',[{role:'user',content:'Hello'}],{model:'invalid'}),/401/);await proxy.reset('chat');gateway.resetHealth('chat');
  });
  await t.test('cancellation closes the in-flight upstream request',async()=>{
   const route=gateway.routes().find(r=>r.provider==='chat'&&r.model==='cancel'),controller=new AbortController();
   const response=await fetch(gateway.origin+'/v1/messages',{method:'POST',headers:{Authorization:'Bearer '+gateway.token},body:JSON.stringify({model:route.id,max_tokens:128,stream:true,messages:[{role:'user',content:'Hello'}]}),signal:controller.signal});
   for(let i=0;i<50&&!seen.some(r=>r.body.model==='cancel');i++)await new Promise(r=>setTimeout(r,10));
   controller.abort();await response.body.cancel().catch(()=>{});
   for(let i=0;i<100&&!cancelled;i++)await new Promise(r=>setTimeout(r,10));assert.equal(cancelled,true);
  });
  await t.test('settings API updates the same live provider and keeps model discovery credentials upstream',async()=>{
   settings=await require('../src/server.cjs').startServer({dataDir:dir,sharedStore:store,providersChanged:()=>gateway.refreshProviders()});
   const auth=await fetch(settings.origin+'/api/session',{method:'POST',headers:{Origin:settings.origin,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(settings.url).hash.slice(1)})});
   const cookie=auth.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
   const post=async(url,body)=>{const r=await fetch(settings.origin+url,{method:'POST',headers:{Origin:settings.origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};
   await post('/api/provider',{id:'chat',name:'renamed',protocol:'chat',baseUrl:base,apiKey:'settings-key'});
   await ask('chat',[{role:'user',content:'Hello'}]);assert.equal(seen.at(-1).headers.authorization,'Bearer settings-key');
   await post('/api/models',{provider:'chat'});assert.equal(seen.at(-1).headers.authorization,'Bearer settings-key');assert.equal(store.data.providers.find(p=>p.id==='chat').name,'renamed');
  });
  assert.equal(fs.statSync(path.join(dir,'cliproxyapi/config.yaml')).mode&0o777,0o600);
  assert.ok(!JSON.stringify(store.snapshot()).includes(proxy.key));assert.ok(!JSON.stringify(store.snapshot()).includes('changed-key'));
 }finally{settings?.close();await gateway?.close();await proxy?.close();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
