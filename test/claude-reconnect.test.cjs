const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {ClaudeAccounts}=require('../src/claude-accounts.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'e1-claude-login-'));
 const original={id:'existing',label:'Personal',method:'claudeai',connected:true,email:'me@example.test',orgId:'org-one',subscriptionType:'max',billingState:'subscription',configDir:path.join(dir,'original'),preferredModel:'opus',models:[{id:'opus'}]};
 fs.mkdirSync(original.configDir);fs.writeFileSync(path.join(original.configDir,'history.json'),'keep');
 fs.writeFileSync(path.join(dir,'claude-accounts.json'),JSON.stringify({accounts:[original]}));
 const calls=[],children=[];let status={loggedIn:true,email:original.email,orgId:original.orgId,authMethod:'claude.ai',subscriptionType:'max'};
 const manager=new ClaudeAccounts(dir,{executable:'/official/claude',run:async(_exe,args,configDir)=>{calls.push({args,configDir});return{data:await(typeof status==='function'?status():status)};},spawn:(_exe,args,options)=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;child.kill=()=>{child.exitCode=1;queueMicrotask(()=>child.emit('close',1));};children.push({child,args,options});return child;
 }});
 manager.models=async()=>[];
 t.after(()=>{for(const p of manager.pending.values())clearTimeout(p.timer);fs.rmSync(dir,{recursive:true,force:true});});
 return{manager,dir,calls,children,original:manager.account('existing'),setStatus:v=>status=v,finish:async code=>{const child=children.at(-1).child;child.exitCode=code;child.emit('close',code);await tick();await tick();}};
}
test('reconnect uses an isolated draft and cancellation preserves old credentials and metadata',async t=>{
 const f=fixture(t),before=fs.readFileSync(f.manager.file,'utf8'),login=f.manager.begin('existing');
 assert.notEqual(f.children[0].options.env.CLAUDE_CONFIG_DIR,f.original.configDir);
 assert.equal(fs.readFileSync(f.manager.file,'utf8'),before);assert.equal(f.manager.account('existing').billingState,'subscription');
 f.manager.cancel(login.id);await tick();await tick();
 assert.equal(f.manager.snapshot().pending[0].status,'cancelled');assert.equal(fs.readFileSync(f.manager.file,'utf8'),before);
 assert.ok(f.calls.filter(c=>c.args[1]==='logout').every(c=>c.configDir!==f.original.configDir));
 assert.equal(fs.readFileSync(path.join(f.original.configDir,'history.json'),'utf8'),'keep');
});
test('verified reconnect commits stable identity and preserves a concurrent label edit',async t=>{
 const f=fixture(t),old=f.original.configDir,login=f.manager.begin('existing');f.manager.update('existing',{label:'Renamed'});await f.finish(0);
 assert.equal(f.manager.snapshot().pending[0].status,'complete');const current=f.manager.account('existing');assert.equal(current.label,'Renamed');assert.notEqual(current.configDir,old);assert.equal(current.preferredModel,'opus');assert.equal(fs.readFileSync(path.join(old,'history.json'),'utf8'),'keep');
 assert.equal(JSON.parse(fs.readFileSync(f.manager.file)).accounts[0].configDir,current.configDir);
 assert.ok(!JSON.stringify(f.manager.snapshot().pending).includes('configDir'));assert.equal(login.accountId,current.id);
});
for(const change of [{email:'other@example.test'},{orgId:'other-org'},{email:null}])test('wrong or unverified identity cannot replace existing connection '+JSON.stringify(change),async t=>{
 const f=fixture(t),before=fs.readFileSync(f.manager.file,'utf8');f.setStatus({loggedIn:true,email:'me@example.test',orgId:'org-one',...change});f.manager.begin('existing');await f.finish(0);
 assert.equal(f.manager.snapshot().pending[0].status,'failed');assert.equal(fs.readFileSync(f.manager.file,'utf8'),before);assert.equal(f.original.configDir,path.join(f.dir,'original'));
});
test('cancelling during verification cannot publish the new profile',async t=>{
 const f=fixture(t);let release;f.setStatus(()=>new Promise(resolve=>release=resolve));const login=f.manager.begin('existing');f.children[0].child.exitCode=0;f.children[0].child.emit('close',0);await tick();
 assert.equal(f.manager.snapshot().pending[0].status,'verifying');f.manager.cancel(login.id);release({loggedIn:true,email:'me@example.test',orgId:'org-one'});await tick();assert.equal(f.manager.snapshot().pending[0].status,'cancelled');assert.equal(f.original.configDir,path.join(f.dir,'original'));
});
test('disconnect during verification cannot recreate the connection',async t=>{
 const f=fixture(t);let release;f.setStatus(()=>new Promise(resolve=>release=resolve));f.manager.begin('existing');f.children[0].child.emit('close',0);await tick();f.manager.disconnect('existing');release({loggedIn:true,email:'me@example.test',orgId:'org-one'});await tick();assert.equal(f.manager.data.accounts.length,0);
});
test('failed login never creates a disconnected account row',async t=>{
 const f=fixture(t);f.manager.begin();await f.finish(1);assert.equal(f.manager.data.accounts.length,1);assert.equal(f.manager.snapshot().pending[0].status,'failed');
});
test('adding an already connected identity reuses its stable account ID',async t=>{
 const f=fixture(t);f.manager.begin();await f.finish(0);assert.equal(f.manager.data.accounts.length,1);assert.equal(f.manager.snapshot().pending[0].accountId,'existing');
});
test('a sign-out refresh retains identity for a later reconnect check',async t=>{
 const f=fixture(t);f.setStatus({loggedIn:false,authMethod:'none'});await f.manager.refresh('existing');assert.equal(f.original.connected,false);assert.equal(f.original.lastIdentity.email,'me@example.test');f.setStatus({loggedIn:true,email:'someone@example.test',orgId:'org-one'});f.manager.begin('existing');await f.finish(0);assert.equal(f.manager.snapshot().pending[0].status,'failed');
});
test('a signed-out account drops stale billing and allowance metadata',async t=>{
 const f=fixture(t);f.original.allowance={unifiedWindows:{five_hour:{utilization:0.9}}};
 f.setStatus({loggedIn:false,authMethod:'none'});await f.manager.refresh('existing');
 assert.equal(f.original.connected,false);assert.equal(f.original.billingState,undefined);assert.equal(f.original.allowance,undefined);
 const saved=JSON.parse(fs.readFileSync(f.manager.file)).accounts[0];assert.equal(saved.billingState,undefined);assert.equal(saved.allowance,undefined);
});
test('atomic metadata failure rolls back in-memory connection as well',async t=>{
 const f=fixture(t),old=f.original.configDir;f.manager.begin('existing');fs.renameSync(f.manager.file,f.manager.file+'.saved');fs.mkdirSync(f.manager.file);await f.finish(0);assert.equal(f.original.configDir,old);assert.equal(f.manager.snapshot().pending[0].status,'failed');
});
test('notification failure after commit does not misreport the successful sign-in',async t=>{
 const f=fixture(t);f.manager.onChange=()=>{throw Error('consumer failed');};f.manager.begin('existing');await f.finish(0);assert.equal(f.manager.snapshot().pending[0].status,'complete');assert.notEqual(f.original.configDir,path.join(f.dir,'original'));
});
test('another process changing accounts is not overwritten by a completed login',async t=>{
 const f=fixture(t);f.manager.begin('existing');const disk=JSON.parse(fs.readFileSync(f.manager.file));disk.accounts[0].label='From another window';fs.writeFileSync(f.manager.file,JSON.stringify(disk));await f.finish(0);assert.equal(f.manager.snapshot().pending[0].status,'failed');assert.equal(JSON.parse(fs.readFileSync(f.manager.file)).accounts[0].label,'From another window');
});
test('importing an already-connected CLI identity reuses the isolated account',async t=>{
 const f=fixture(t),before=JSON.stringify(f.original),result=await f.manager.useExisting();assert.equal(result.accountId,'existing');assert.equal(f.manager.data.accounts.length,1);assert.equal(JSON.stringify(f.original),before);
});
test('existing Console connection is not overwritten while importing a subscription',async t=>{
 const f=fixture(t);f.original.connected=false;f.original.email='other@example.test';f.original.orgId='other-org';
 const consoleAccount={id:'console',label:'Console',existing:true,method:'console',connected:true,configDir:path.join(os.homedir(),'.claude'),profileDir:path.join(os.homedir(),'.config/anthropic'),email:'console@example.test',orgId:'console-org',workspaceId:'console-workspace'};
 f.manager.data.accounts.push(consoleAccount);f.manager.save();const before=JSON.stringify(consoleAccount),result=await f.manager.useExisting();assert.notEqual(result.accountId,'console');assert.equal(JSON.stringify(consoleAccount),before);assert.equal(f.manager.account(result.accountId).method,'claudeai');
});
