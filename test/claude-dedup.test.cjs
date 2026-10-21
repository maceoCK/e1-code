const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {ClaudeAccounts}=require('../src/claude-accounts.cjs'),{Store}=require('../src/store.cjs'),{catalog,routeId}=require('../src/gateway.cjs');
const base={method:'claudeai',email:'person@example.test',orgId:'org',connected:true,configDir:'/one',models:[{id:'model-v1',aliases:['model']}],billingState:'subscription'};
test('migration keeps labels, models, credentials and old route IDs while separating organizations and billing types',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'e1-claude-dedup-'));
 try{
  const accounts=[{...base,id:'one',label:'Personal',preferredModel:'model-v1',checkedAt:'2026-10-01'},
   {...base,id:'two',label:'Claude 3',email:'PERSON@example.test',configDir:'/new',checkedAt:'2026-10-02'},
   {...base,id:'other-org',orgId:'other'}, {...base,id:'console',method:'console',workspaceId:'workspace'},
   {...base,id:'other-workspace',method:'console',workspaceId:'other'}, {...base,id:'unknown',orgId:null}];
  fs.writeFileSync(path.join(dir,'claude-accounts.json'),JSON.stringify({accounts}));
  const a=new ClaudeAccounts(dir,{executable:'/fixture'});assert.equal(a.data.accounts.length,5);
  assert.equal(a.account('two').id,'one');assert.equal(a.account('two').label,'Personal');assert.equal(a.account('one').configDir,'/new');
  assert.equal(a.account('one').preferredModel,'model-v1');assert.ok(fs.existsSync(a.file+'.before-dedup'));
  const store=new Store(dir);store.data.providers=[];store.data.selection.provider='claude-code-two';store.data.routing.order=['claude-code-two','claude-code-one'];store.claudeAccounts=a;
  assert.equal(store.provider('claude-code-two').id,'claude-code-one');assert.deepEqual(store.data.routing.order,['claude-code-one']);
  const route=catalog(store).find(r=>r.provider==='claude-code-one'&&r.model==='model-v1');
  assert.ok(route.aliases.includes(routeId('claude-code-two','model-v1')));assert.ok(route.aliases.includes(routeId('claude-code-two','model')));
  store.setProvider({id:'claude-code-two',name:'Renamed'});assert.equal(a.account('one').label,'Renamed');
  assert.equal(new ClaudeAccounts(dir,{executable:'/fixture'}).data.accounts.length,5);
  a.disconnect('two');assert.throws(()=>a.account('one'),/not found/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('repeated and overlapping completed sign-ins reuse the original connection and its custom label',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'e1-claude-repeat-')),children=[];
 const a=new ClaudeAccounts(dir,{executable:'/fixture',run:async()=>({data:{loggedIn:true,email:'PERSON@example.test',orgId:'org',subscriptionType:'max'}}),spawn:()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};children.push(child);return child;
 }});a.models=async()=>[];
 try{
  a.data.accounts.push({...base,id:'original',label:'My Max'});a.save();
  const first=a.begin(),second=a.begin();children[0].emit('close',0);children[1].emit('close',0);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(a.data.accounts.length,1);assert.equal(a.data.accounts[0].label,'My Max');
  // 10-18 reconnect design: begin() returns a provisional ID for a new sign-in; the
  // verified pending record (what Settings polls by login ID) resolves to the stable account.
  for(const p of [first,second]){const done=a.pending.get(p.id);assert.equal(done.status,'complete');assert.equal(done.accountId,'original');assert.equal(a.account(done.accountId).id,'original');
   assert.equal(a.snapshot().pending.find(v=>v.id===p.id).accountId,'original');assert.equal(a.data.accounts.some(v=>v.id===p.accountId),false,'no provisional account row');}
  const previousProfile=a.data.accounts[0].configDir,third=a.begin();children[2].emit('close',0);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(a.data.accounts.length,1);assert.equal(a.pending.get(third.id).status,'complete');assert.equal(a.data.accounts[0].label,'My Max');
  // Each login writes a fresh isolated profile, which becomes the connection's profile once verified.
  assert.equal(a.data.accounts[0].configDir,a.pending.get(third.id).draft.configDir);
  assert.equal(path.dirname(a.data.accounts[0].configDir),path.join(dir,'claude-profiles'));assert.notEqual(a.data.accounts[0].configDir,previousProfile);
 }finally{for(const p of a.pending.values())clearTimeout(p.timer);fs.rmSync(dir,{recursive:true,force:true});}
});
