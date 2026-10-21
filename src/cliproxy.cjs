// Pinned, unmodified CLIProxyAPI owns provider requests and OAuth refresh.
// E1 owns stable account/model IDs, its chat library, and account-selection policy.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),net=require('node:net');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const exec=promisify(execFile),{atomicJson,readJson}=require('./library-identity.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const providerId=(kind,a)=>(kind==='claude'?'claude-code-':'chatgpt-')+a.id;
const name=id=>{if(!/^(claude-code|chatgpt)-[a-f\d-]{36}$/i.test(id))throw Error('Invalid proxy account.');return id+'.json';};
function convertCredential(kind,a,raw){
 const base={type:kind,email:a.email,prefix:providerId(kind,a),e1_account_id:a.id};
 if(kind==='claude'){
  const t=raw.claudeAiOauth;
  if(!t?.accessToken||!t.refreshToken||!Number.isFinite(t.expiresAt))throw Error('Claude credentials are incomplete. Reconnect this account.');
  return {...base,access_token:t.accessToken,refresh_token:t.refreshToken,expired:new Date(t.expiresAt).toISOString(),organization_uuid:a.orgId,organization_name:a.orgName};
 }
 const t=raw.tokens;
 if(!t?.access_token||!t.refresh_token||!t.id_token)throw Error('Codex credentials are incomplete. Reconnect this account.');
 let claims;try{claims=JSON.parse(Buffer.from(t.id_token.split('.')[1],'base64url'));}catch{throw Error('Codex identity token is unreadable.');}
 if(claims.email&&claims.email.toLowerCase()!==a.email.toLowerCase())throw Error('Codex credential identity does not match the saved account.');
 if(t.account_id&&a.workspaceAccountId&&t.account_id!==a.workspaceAccountId)throw Error('Codex workspace does not match the saved account.');
 // Access tokens, not ID tokens, determine bearer expiry.
 let access;try{access=JSON.parse(Buffer.from(t.access_token.split('.')[1],'base64url'));}catch{}
 return {...base,...t,account_id:a.workspaceAccountId||t.account_id,plan_type:a.planType,last_refresh:raw.last_refresh,
  expired:new Date((access?.exp||claims.exp)*1000).toISOString()};
}
async function readCredential(kind,a,dir){
 if(kind==='claude'){
  const file=path.join(a.configDir,'.credentials.json');
  if(fs.existsSync(file))return JSON.parse(fs.readFileSync(file,'utf8'));
  const service='Claude Code-credentials'+(a.configDir===path.join(os.homedir(),'.claude')?'':'-'+hash(a.configDir.normalize('NFC')).slice(0,8));
  const {stdout}=await exec('/usr/bin/security',['find-generic-password','-s',service,'-a',os.userInfo().username,'-w'],{timeout:60000,killSignal:'SIGKILL',maxBuffer:1024*1024});
  return JSON.parse(stdout);
 }
 const home=fs.realpathSync(path.join(dir,'codex-accounts',a.profileId||a.id));
 const {stdout}=await exec('/usr/bin/security',['find-generic-password','-s','Codex Auth','-a','cli|'+hash(home).slice(0,16),'-w'],{timeout:60000,killSignal:'SIGKILL',maxBuffer:1024*1024});
 return JSON.parse(stdout);
}
class CLIProxy {
 constructor(dir,{binary=path.join(process.resourcesPath||'', 'cliproxyapi','cli-proxy-api'),accounts=()=>[],store}={}){
  this.dir=dir;this.root=path.join(dir,'cliproxyapi');this.authDir=path.join(this.root,'auth');this.binary=binary;this.accounts=accounts;this.store=store;this.apiRoutes=new Map();this.syncQueue=Promise.resolve();
  this.secret=crypto.randomBytes(32).toString('hex');this.key=crypto.randomBytes(32).toString('hex');this.closed=false;
 }
 supports(kind,a){return kind==='claude'?a.method==='claudeai':a.mode==='codex';}
 route(kind,a){return this.supports(kind,a)?{prefix:providerId(kind,a),origin:this.origin}:undefined;}
 has(id){return fs.existsSync(path.join(this.authDir,name(id)));}
 decorate(p){const route=this.apiRoutes.get(p.id);return route?{...p,proxy:route}:p;}
 async consoleKey(p){
  const suffix='-'+hash(p.configDir.normalize('NFC')).slice(0,8);
  for(const service of ['Claude Code'+suffix,...(p.configDir===path.join(os.homedir(),'.claude')?['Claude Code']:[])]){
   try{const {stdout}=await exec('/usr/bin/security',['find-generic-password','-s',service,'-a',os.userInfo().username,'-w'],{timeout:10000,maxBuffer:65536});if(stdout.trim())return stdout.trim();}catch{}
  }
  for(const file of [path.join(p.configDir,'.claude.json'),p.configDir+'.json']){const config=readJson(file,{});if(config.primaryApiKey)return config.primaryApiKey;}
  throw Error('Reconnect this Console account to restore its managed API key.');
 }
 async providerConfig(){
  const groups={claude:[],codex:[],'openai-compatibility':[]},routes=new Map();
  if(!this.store)return {groups,routes};
  const P=require('./proxy-providers.cjs');
  for(const p of [...this.store.data.providers,...(this.store.claudeAccounts?.providers()||[])]){
   const protocol=P.protocolFor(p);if(!protocol)continue;
   // Console workspace OAuth is distinct from Claude subscription OAuth.
   // Its official CLI owns refresh and workspace billing; never treat it as an API key.
   if(p.billingMethod==='console'&&require('./claude-identity.cjs').consoleIdentity(p.profileDir||path.join(p.configDir,'anthropic')))continue;
   const route={prefix:P.prefix(p.id),origin:this.origin,protocol,api:true};
   if(p.authType&&p.signedIn===false){routes.set(p.id,{...route,error:'This account is disconnected.'});continue;}
   try{
    const key=p.authType==='claude-code'?await this.consoleKey(p):await this.store.sourceKey(p);
    if(!key&&protocol!=='chat')throw Error('Add an API key to this connection.');
    const {group,entry}=P.entryFor(p,key);groups[group].push(entry);
   }catch{route.error='Provider credential is unavailable. Reconnect or update this connection in E1.';}
   routes.set(p.id,route);
  }
  return {groups,routes};
 }
 async waitForApiKeys(groups){
  if(!Object.values(groups).some(rows=>rows.length))return;
  for(let attempt=0;attempt<100;attempt++){
   const live=await this.management('/config/api-keys');
   const ready=Object.entries(groups).every(([group,rows])=>rows.every(row=>{
    const found=(live[group]||[]).find(r=>r.prefix===row.prefix);
    return found && (row.keys.length?row.keys.every(key=>found.keys?.some(k=>k['api-key']===key['api-key']&&k.auth_index)):found.auth_index);
   }));
   if(ready)return;
   await sleep(50);
  }
  throw Error('Provider settings are saved, but CLIProxyAPI has not applied them yet. Retry in E1.');
 }
 async syncProviders(){
  const run=async()=>{
   const {groups,routes}=await this.providerConfig();
   await this.management('/config/api-keys',{method:'PUT',body:groups});
   await this.waitForApiKeys(groups);this.apiRoutes=routes;
  };
  const task=this.syncQueue.then(run);this.syncQueue=task.catch(()=>{});return task;
 }
 async prepare(){
  const server=net.createServer();await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
  this.port=server.address().port;await new Promise(r=>server.close(r));this.origin='http://127.0.0.1:'+this.port;
 }
 async importAccount(kind,a,{replace=false}={}){
  const id=providerId(kind,a),file=path.join(this.authDir,name(id));if(!replace&&this.has(id))return;
  let data;try{data=convertCredential(kind,a,await readCredential(kind,a,this.dir));}catch{throw Error('Could not transfer '+(kind==='claude'?'Claude':'Codex')+' credentials for '+a.email+'. Reconnect this account.');}
  fs.mkdirSync(this.authDir,{recursive:true,mode:0o700});
  if(replace&&this.child){await this.management('/credentials?name='+encodeURIComponent(name(id)),{method:'POST',body:data});}
  else atomicJson(file,data);
  fs.chmodSync(file,0o600);
 }
 async start(){
  if(!this.origin)await this.prepare();
  fs.accessSync(this.binary,fs.constants.X_OK);
  fs.mkdirSync(this.authDir,{recursive:true,mode:0o700});fs.chmodSync(this.root,0o700);fs.chmodSync(this.authDir,0o700);
  // Recover an orphan from a crashed E1, but never terminate another proxy service.
  const runtimeFile=path.join(this.root,'runtime.json'),old=readJson(runtimeFile,{});
  if(old.pid){
   let command='';try{command=(await exec('/bin/ps',['-p',String(old.pid),'-o','command='])).stdout;}catch{}
   if(command.includes('cliproxyapi/cli-proxy-api')&&command.includes(path.join(this.root,'config.yaml'))){
    let ownerAlive=false;try{process.kill(old.ownerPid,0);ownerAlive=true;}catch{}
    if(ownerAlive)throw Error('Another E1 process already owns these accounts. Close it before reopening E1.');
    try{process.kill(old.pid,'SIGTERM');}catch{}
    for(let i=0;i<30;i++){try{process.kill(old.pid,0);await sleep(100);}catch{break;}}
    try{process.kill(old.pid,0);throw Error('Previous E1 proxy is still stopping. Reopen E1 in a moment.');}catch(e){if(e.code!=='ESRCH')throw e;}
   }
  }
  const migrated=[];
  for(const [kind,a] of this.accounts())if(this.supports(kind,a)&&(kind==='claude'?a.connected:a.codexConnected)){
   if(this.closed)throw Error('E1 proxy startup was cancelled.');
   await this.importAccount(kind,a);migrated.push(providerId(kind,a));
  }
  const api=await this.providerConfig();this.apiRoutes=api.routes;
  const config={'api-keys':api.groups,'config-version':8,server:{host:'127.0.0.1',port:this.port,'max-request-body-bytes':24*1024*1024},
   management:{'allow-remote':false,'secret-key':this.secret,'disable-control-panel':true,'disable-auto-update-panel':true},
   access:{'api-keys':[this.key]},oauth:{'auth-dir':this.authDir},
   routing:{strategy:'fill-first','force-model-prefix':true,'session-affinity':false,retry:{'request-retry':0,'max-retry-credentials':1,'max-retry-interval':0},cooldown:{'save-cooldown-status':true}},
   requests:{'passthrough-headers':true},
   observability:{logs:{debug:false,'logging-to-file':false,'request-log':false},usage:{'usage-statistics-enabled':true}},plugins:{enabled:false}};
  const file=path.join(this.root,'config.yaml');atomicJson(file,config);fs.chmodSync(file,0o600);
  const env={...process.env};for(const k of Object.keys(env))if(/^(ANTHROPIC_|OPENAI_|CLAUDE_|CODEX_|MANAGEMENT_PASSWORD|GITHUB_TOKEN|GH_TOKEN)/.test(k))delete env[k];
  // umask is inherited by the helper only. Refreshed credentials stay private.
  if(this.closed)throw Error('E1 proxy startup was cancelled.');
  this.child=spawn('/bin/sh',['-c','umask 077; exec "$@"','e1-cliproxy',this.binary,'-config',file],{cwd:this.root,env,stdio:['ignore','ignore','ignore']});
  this.child.on('error',()=>{this.startFailed=true;});this.child.on('exit',()=>{this.startFailed=true;});
  atomicJson(runtimeFile,{pid:this.child.pid,ownerPid:process.pid,port:this.port,version:'8.0.30',startedAt:new Date().toISOString()});
  for(let i=0;i<150;i++){
   if(this.startFailed||this.closed)throw Error('E1’s bundled CLIProxyAPI could not start.');
   try{const rows=(await this.management('/credentials')).files||[];if(migrated.every(id=>rows.some(r=>r.name===name(id)))){
    await this.waitForApiKeys(api.groups);
    atomicJson(path.join(this.root,'migration.json'),{version:1,engine:'CLIProxyAPI 8.0.30',accounts:migrated,checkedAt:new Date().toISOString()});return;
   }}catch{}
   await sleep(100);
  }
  await this.close();throw Error('E1’s bundled CLIProxyAPI did not become ready.');
 }
 async management(endpoint,{method='GET',body}={}){
  const response=await fetch(this.origin+'/v8/management'+endpoint,{method,headers:{Authorization:'Bearer '+this.secret,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Object.assign(Error('CLIProxyAPI management returned HTTP '+response.status),{status:response.status});
  return response.json();
 }
 async credential(id){const rows=(await this.management('/credentials?name='+encodeURIComponent(name(id)))).files||[];const row=rows.find(r=>r.name===name(id));if(!row)throw Error('This proxy account is not connected.');return row;}
 async status(id){const r=await this.credential(id);return !r.disabled&&!/invalid_grant|refresh_token_reused|refresh_token_invalidated/i.test(r.status_message||'');}
 async reset(id){
  if(this.apiRoutes.has(id)){
   const groups=await this.management('/config/api-keys');
   for(const rows of Object.values(groups))for(const row of Array.isArray(rows)?rows:[])if(row.prefix===this.apiRoutes.get(id).prefix){
    for(const index of [row.auth_index,...(row.keys||[]).map(k=>k.auth_index)].filter(Boolean))
     await this.management('/routing/cooldown/reset',{method:'POST',body:{auth_index:index}});
   }return;
  }
  const r=await this.credential(id);return this.management('/routing/cooldown/reset',{method:'POST',body:{auth_index:r.auth_index}});
 }
 async disconnect(id){await this.management('/credentials/status',{method:'PATCH',body:{name:name(id),disabled:true}});}
 async token(id,force=false){
  if(force)await this.management('/credentials/refresh',{method:'POST',body:{name:name(id)}});
  const data=readJson(path.join(this.authDir,name(id)),{});
  if(!data.access_token)throw Error('Reconnect this account.');return data.access_token;
 }
 async api(id,url,headers={},retried=false){
  const row=await this.credential(id);
  const value=await this.management('/requests/api-call',{method:'POST',body:{auth_index:row.auth_index,method:'GET',url,header:{Authorization:'Bearer $TOKEN$',...headers}}});
  if(value.status_code===401&&!retried){await this.management('/credentials/refresh',{method:'POST',body:{name:name(id)}});return this.api(id,url,headers,true);}
  if(value.status_code!==200)throw Object.assign(Error('Account service returned HTTP '+value.status_code),{status:value.status_code});
  return JSON.parse(value.body);
 }
 async usage(kind,a){
  if(kind==='claude')return this.api(providerId(kind,a),'https://api.anthropic.com/api/oauth/usage',{'anthropic-beta':'oauth-2025-04-20','User-Agent':'claude-code/2.1.114'});
  const d=await this.api(providerId(kind,a),'https://chatgpt.com/backend-api/wham/usage',{'ChatGPT-Account-ID':a.workspaceAccountId});
  const window=v=>v?{usedPercent:v.used_percent,windowDurationMins:v.limit_window_seconds/60,resetsAt:v.reset_at}:null;
  const limit=v=>({primary:window(v?.primary_window),secondary:window(v?.secondary_window)});
  const buckets={codex:limit(d.rate_limit)};
  for(const [i,b] of (d.additional_rate_limits||[]).entries())buckets[b.metered_feature||String(i)]={...limit(b.rate_limit),limitName:b.limit_name};
  return {rateLimitsByLimitId:buckets};
 }
 async models(kind,a){
  const id=providerId(kind,a),data=await this.management('/credentials/models?name='+encodeURIComponent(name(id)));
  const rows=data.models||data.data||[];
  const models=rows.map(m=>{const model=(m.id||m.name||'').replace(id+'/','');return {...m,id:model,name:m.display_name||m.name||model};}).filter(m=>m.id&&(kind==='claude'?m.id.startsWith('claude-'):m.id.startsWith('gpt-')));
  if(!models.length)throw Error('CLIProxyAPI has not loaded this account’s model catalog.');
  // Keep saved aliases, context metadata, and old history references stable.
  return [...new Map([...models,...(a.models||[])].map(m=>[m.id,m])).values()];
 }
 async close(){this.closed=true;if(!this.child||this.child.exitCode!==null)return;const child=this.child;await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},1500);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});}
}
module.exports={CLIProxy,convertCredential,providerId};
