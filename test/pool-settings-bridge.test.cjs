const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {startServer}=require('../src/server.cjs');
const {installSettings}=require('../src/settings-native.cjs');
test('native settings bridge loads live usage through its allowlist and preserves routing preferences',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'e1-settings-test-'));
 const a={id:'one',codexConnected:true},p={id:'chatgpt-one',accountId:'one',authType:'chatgpt-subscription',signedIn:true};
 const subscriptions={providers:()=>[p],account:()=>a,usage:async()=>({rateLimits:{primary:{usedPercent:42,windowDurationMins:10080,resetsAt:2000000000}}})};
 const server=await startServer({dataDir:dir,subscriptions,settingsOnly:true});
 try{let attach,request;const frame={url:'app://localhost/settings'},contents={session:{registerPreloadScript(){}},mainFrame:frame,on(){},ipc:{handle(_name,handler){request=handler;}}};
 installSettings({app:{on(_event,handler){attach=handler;}}},()=>null,async()=>server);attach(null,contents);
 const event={senderFrame:frame};const result=await request(event,'api',{route:'plan/usage',data:{provider:'chatgpt-one'}});assert.equal(result.state,'live');assert.equal(result.windows[0].usedPercent,42);
 const policy=await request(event,'api',{route:'routing',data:{enabled:true,order:['chatgpt-one'],strategy:'round-robin',sessionAffinity:false,allowApiFallback:false}});assert.equal(policy.strategy,'round-robin');assert.equal(policy.sessionAffinity,false);assert.equal(server.store.data.routing.allowApiFallback,false);
 await assert.rejects(request({senderFrame:{url:'https://untrusted.test'}},'api',{route:'plan/usage',data:{provider:'chatgpt-one'}}),/Invalid settings sender/);
 }finally{server.close();fs.rmSync(dir,{recursive:true,force:true});}
});
