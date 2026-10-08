const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { WorkflowPreferences, WorkflowRouter, isWorkflowChild } = require('../src/workflow-preferences.cjs');
const G = require('../src/gateway.cjs'), R = require('../src/routing.cjs');
const main = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const frame = '[Workflow harness — computed task] Read the fixture.';
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'e1-workflow-prefs-'));
  const folder = path.join(dir,'claude-code-sessions/account/org'); fs.mkdirSync(folder,{recursive:true});
  for (const id of [main,other]) fs.writeFileSync(path.join(folder,`local_${id}.json`),JSON.stringify({sessionId:`local_${id}`,cliSessionId:id}));
  const providers = [{id:'one',name:'Main',protocol:'chat',baseUrl:'https://one.test/v1',models:[{id:'main',reasoningEfforts:['low','high']}]},
    {id:'two',name:'Worker',protocol:'chat',baseUrl:'https://two.test/v1',models:[{id:'worker',reasoningEfforts:['low','high'],compat:{supportsReasoningEffort:true}}]}];
  const store = {nativeProfile:dir,data:{providers,routing:{enabled:true,allowApiFallback:true,order:[]}},provider:id=>providers.find(p=>p.id===id),key:()=>''};
  return {dir,store,routes:G.modelCatalog(store)};
}
test('workflow choices persist by chat, validate effort, and never alter chat history',()=>{
  const {dir,routes}=fixture();
  try {
    const p=new WorkflowPreferences(dir), history=path.join(dir,'history.json');fs.writeFileSync(history,'unchanged');
    p.save({parentModel:routes[0].id,chatId:`local_${main}`,model:routes[1].id,effort:'high'},routes);
    assert.equal(new WorkflowPreferences(dir).read().chats[`local_${main}`].model,routes[1].id);
    assert.throws(()=>p.save({parentModel:routes[0].id,model:'missing'},routes),/no longer connected/);
    assert.throws(()=>p.save({parentModel:routes[0].id,model:routes[1].id,effort:'max'},routes),/supported/);
    assert.throws(()=>p.save({parentModel:routes[0].id,chatId:'__proto__'},routes),/Invalid chat/);
    assert.equal(fs.readFileSync(history,'utf8'),'unchanged');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('parent remains on main model while child requests use chat-specific model and effort',async()=>{
  const {dir,store,routes}=fixture(); const calls=[];
  store.data.workflowPreferences={chats:{[`local_${main}`]:{model:routes[1].id,effort:'high'}}};
  const gateway=await G.startGateway({store,transport:async(_url,options)=>{
    calls.push(JSON.parse(options.body));return new Response(JSON.stringify({choices:[{message:{content:'OK'},finish_reason:'stop'}]}));
  }});
  try {
    async function send(id,text){const r=await fetch(gateway.origin+'/v1/messages',{method:'POST',headers:{Authorization:'Bearer '+gateway.token},body:JSON.stringify({model:routes[0].id,metadata:{user_id:JSON.stringify({session_id:id})},messages:[{role:'user',content:text}],output_config:{effort:'low'}})});assert.equal(r.status,200,await r.text());}
    await send(main,'Main request');await send(main,frame);await send(other,frame);await send(main,'Continue main chat');
    assert.deepEqual(calls.map(c=>c.model),['main','worker','main','main']);
    assert.equal(calls[1].reasoning_effort,'high');
    assert.equal(calls[1].messages.at(-1).content,frame);
  } finally {gateway.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('missing preferred model pauses, and quoted harness-like content is not classified as a workflow',()=>{
  const {dir,routes}=fixture();
  try {
    const router=new WorkflowRouter(dir);
    const body={metadata:{session_id:main},messages:[{role:'user',content:frame}]};
    assert.throws(()=>router.select(body,routes[0],routes,{chats:{[`local_${main}`]:{model:'gone'}}}),/unavailable/);
    assert.equal(isWorkflowChild({messages:[{role:'user',content:'  '+frame}]}),false);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('plan failover preserves GPT version and cannot match a different vendor by name',()=>{
  const providers=[{id:'a',authType:'chatgpt-subscription',signedIn:true,models:[{id:'gpt-6.1-sol'}]},
    {id:'b',authType:'chatgpt-subscription',signedIn:true,models:[{id:'gpt-6.1-sol'},{id:'gpt-6-astra'}]},
    {id:'api',protocol:'responses',baseUrl:'https://api.openai.com/v1',models:[{id:'gpt-6.1-sol'}]},
    {id:'other',protocol:'chat',baseUrl:'https://unrelated.test/v1',models:[{id:'gpt-6.1-sol'}]}];
  const store={data:{providers},provider:id=>providers.find(p=>p.id===id)},routes=G.catalog(store);
  const policy=R.policyFor({enabled:true,allowApiFallback:true,order:['b','other','api'],models:{b:'gpt-6-astra'}});
  assert.deepEqual(R.candidateRoutes(routes[0],routes,store,policy,{a:{retryAt:null}}).map(r=>[r.provider,r.model]),[['b','gpt-6.1-sol'],['api','gpt-6.1-sol']]);
});
