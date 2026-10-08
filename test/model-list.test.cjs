const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../src/model-list.js');
const row=(id,extra={})=>({id,name:id,model:id,...extra});
const rows=[
  row('gpt-5.6-sol'),row('gpt-6-luna'),row('gpt-6-astra'),row('gpt-6.1-sol'),row('o3'),
  row('claude-sonnet-4-20250514'),row('gpt-6-20261001'),
  row('claude-sonnet-4-5'),row('claude-sonnet-4-6'),row('claude-opus-4-6'),
  row('claude-haiku-4-5'),row('claude-3-5-sonnet-20241022'),
  row('claude-opus-4-6-20261001'),
  row('gpt-4-local',{providerKind:'ollama',providerName:'Local models'}),
  row('ft:gpt-4.1:custom:worker'),row('claude-fable-5'),
];
test('model list groups providers and hides superseded generations without hiding current variants or custom models',()=>{
  const visible=M.arrange(rows),ids=visible.map(m=>m.id);
  assert.deepEqual(ids.slice(0,4),['claude-fable-5','claude-opus-4-6','claude-sonnet-4-6','claude-haiku-4-5']);
  for(const id of ['gpt-6.1-sol','gpt-6-astra','gpt-6-luna','gpt-4-local','ft:gpt-4.1:custom:worker'])assert.ok(ids.includes(id),id);
  for(const id of ['gpt-5.6-sol','o3','claude-sonnet-4-20250514','claude-sonnet-4-5','claude-3-5-sonnet-20241022','claude-opus-4-6-20261001'])assert.ok(!ids.includes(id),id);
  assert.equal(M.arrange(rows,{showLegacy:true}).length,rows.length);
  assert.equal(M.arrange(rows,{selected:'gpt-5.6-sol'}).find(m=>m.id==='gpt-5.6-sol').legacy,true);
});
test('search matches normalized model versions, providers and connection labels with AND terms',()=>{
  const models=rows.concat(row('gpt-6-astra-work',{model:'gpt-6-astra',name:'Work plan · GPT-6 Astra',providerName:'Work plan'}));
  assert.deepEqual(M.arrange(models,{query:'work OPENAI astra'}).map(m=>m.id),['gpt-6-astra-work']);
  assert.deepEqual(M.arrange(models,{query:'6.1 sol'}).map(m=>m.id),['gpt-6.1-sol']);
  assert.deepEqual(M.arrange(models,{query:'GPT6.1'}).map(m=>m.id),['gpt-6.1-sol']);
  assert.equal(M.matches({name:'Éclair · 模型'},'eclair 模型'),true);
  assert.equal(M.arrange(models,{query:'not a model'}).length,0);
  assert.equal(M.arrange(rows,{query:'5.6'}).length,0);
  assert.equal(M.arrange(rows,{query:'5.6',showLegacy:true}).length,1);
});
test('legacy visibility is independent of account billing and never mutates catalogs',()=>{
  const models=[row('sub',{name:'Personal plan · gpt-6-astra',model:'gpt-6-astra'}),row('api',{name:'API · gpt-6-astra',model:'gpt-6-astra'}),row('old',{model:'gpt-5.6-sol'})];
  const before=JSON.stringify(models);assert.equal(M.arrange(models).length,2);assert.equal(JSON.stringify(models),before);
  const items=M.items(models,{selected:'old'});assert.equal(items.filter(i=>i.groupLabelBefore).length,1);
  assert.match(items.find(i=>i.value==='old').description,/current selection/);
  // A provider exposing only an older generation remains usable until a newer
  // generation is available; explicit provider deprecation still takes effect.
  assert.equal(M.arrange([row('gpt-4.1')]).length,1);
  assert.equal(M.arrange([row('deprecated',{meta:{deprecated:true}})]).length,0);
});
