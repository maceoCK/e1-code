const {test}=require('node:test'),assert=require('node:assert/strict');
const {PlanUsage,claudeWindows,codexWindows}=require('../src/plan-usage.cjs');
function fixture(options={}){const a={id:'one',email:'one@test',mode:'codex',codexConnected:true,workspaceAccountId:'w1'},p={id:'p',accountId:'one',signedIn:true,authType:'chatgpt-subscription'};const manager={account:()=>a,usage:options.usage};return{a,p,api:new PlanUsage({provider:()=>p,subscriptions:manager,claudeAccounts:manager},options)};}
test('usage normalizes fractional Claude event windows and whole-percent API windows without inventing unknown values',()=>{
 assert.equal(claudeWindows({five_hour:{utilization:.27,resetsAt:1800000000}},true)[0].usedPercent,27);
 assert.equal(claudeWindows({five_hour:{utilization:27,resets_at:'2027-01-15T08:00:00Z'}})[0].usedPercent,27);
 assert.equal(claudeWindows({seven_day:{utilization:null,resetsAt:null}})[0].usedPercent,null);
 const rows=codexWindows({rateLimitsByLimitId:{codex:{primary:{usedPercent:20,windowDurationMins:300,resetsAt:1800000000},secondary:{usedPercent:40,windowDurationMins:10080,resetsAt:null}}}});
 assert.deepEqual(rows.map(r=>r.label),['5-hour limit','Weekly limit']);assert.equal(rows[0].resetsAt,1800000000000);assert.equal(rows[1].resetsAt,null);
});
test('plan requests coalesce, cache, and use the selected account read-only usage method',async()=>{
 let calls=0;const f=fixture({usage:async(id)=>{calls++;assert.equal(id,'one');return {rateLimits:{primary:{usedPercent:31,resetsAt:1800000000}}};}});
 const results=await Promise.all([f.api.read('p'),f.api.read('p')]);await f.api.read('p');assert.equal(calls,1);assert.equal(results[0].windows[0].usedPercent,31);assert.doesNotMatch(JSON.stringify(results),/secret-token/);
});
test('plan responses are discarded if the account changes during a read',async()=>{
 let finish;const f=fixture({usage:()=>new Promise(r=>finish=r)});const result=f.api.read('p');await new Promise(r=>setImmediate(r));f.a.workspaceAccountId='w2';finish({rateLimits:{primary:{usedPercent:87}}});assert.equal((await result).state,'unavailable');assert.deepEqual((await result).windows,[]);
});
test('Claude unavailable live readings preserve explicitly dated observations, not a fresh zero',async()=>{
 const f=fixture({claudeUsage:async()=>({rate_limits_available:false})});f.p.authType='claude-code';f.a.allowance={unifiedWindows:{five_hour:{utilization:.75,resetsAt:1800000000}}};f.a.billingCheckedAt='2026-10-08T07:00:00Z';const value=await f.api.read('p');assert.equal(value.state,'reported');assert.equal(value.windows[0].usedPercent,75);assert.equal(value.checkedAt,Date.parse(f.a.billingCheckedAt));
});
test('Claude usage helper sends only structured controls and skips transcript scans',async()=>{
 const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');const {readClaudeUsage}=require('../src/claude-plan-usage.cjs');
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();let killed=false;child.kill=()=>{killed=true;};const sent=[];
 child.stdin.on('data',chunk=>{const event=JSON.parse(chunk);sent.push(event);queueMicrotask(()=>child.stdout.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:event.request_id,response:event.request_id==='usage-read'?{rate_limits_available:true,rate_limits:{five_hour:{utilization:25,resets_at:null}}}:{}}})+'\n'));});
 const result=await readClaudeUsage('/fake/claude',{configDir:'/selected/profile'},(exe,args,opts)=>{assert.equal(exe,'/fake/claude');assert.equal(opts.env.CLAUDE_CONFIG_DIR,'/selected/profile');assert.equal(opts.env.ANTHROPIC_API_KEY,undefined);assert.ok(args.includes('--no-session-persistence'));return child;});
 assert.equal(killed,true);assert.deepEqual(sent.map(e=>e.type),['control_request','control_request']);assert.deepEqual(sent[1].request,{subtype:'get_usage',skip_behaviors:true});assert.equal(result.rate_limits.five_hour.utilization,25);
});
test('Codex usage is allowed while inference methods remain denied',async()=>{
 const {CodexAuth}=require('../src/codex-auth.cjs');
 const fake={closed:false,serial:0,pending:new Map(),child:{stdin:{write(line,callback){const msg=JSON.parse(line),entry=fake.pending.get(msg.id);clearTimeout(entry.timer);fake.pending.delete(msg.id);entry.resolve({rateLimits:{}});callback?.();}}}};
 assert.deepEqual(await CodexAuth.prototype.request.call(fake,'account/rateLimits/read',{}),{rateLimits:{}});
 await assert.rejects(()=>CodexAuth.prototype.request.call(fake,'turn/start',{}),/Only authentication and account usage/);
});
