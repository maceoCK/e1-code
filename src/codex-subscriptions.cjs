// Codex handles authentication only. E1 retains all conversations and tool execution.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Subscriptions}=require('./subscriptions.cjs');
const {CodexAuth,findBinary}=require('./codex-auth.cjs');
const BASE='https://chatgpt.com/backend-api/codex';
const identity=a=>a.mode==='codex'&&a.workspaceAccountId&&typeof a.email==='string'&&a.email.includes('@')?JSON.stringify([a.workspaceAccountId,a.email.trim().toLowerCase()]):null;
class CodexSubscriptions extends Subscriptions {
  constructor(dir,vault,options={}){super(dir,vault,options);this.dir=dir;this.executable=options.executable||findBinary();this.factory=options.brokerFactory||((config)=>new CodexAuth(config));this.helpers=new Map();this.authRequests=new Map();this.starting=false;this.dedupe();}
  resolveAccountId(id){const seen=new Set();while(this.data.accountAliases?.[id]&&!seen.has(id)){seen.add(id);id=this.data.accountAliases[id];}return id;}
  resolveProviderId(id){return typeof id==='string'&&id.startsWith('chatgpt-')?'chatgpt-'+this.resolveAccountId(id.slice(8)):id;}
  account(id){return super.account(this.resolveAccountId(id));}
  dedupe(){
    const groups=new Map(),duplicates=[];
    for(const a of this.data.accounts){const key=identity(a);if(!key)continue;const first=groups.get(key);if(first)duplicates.push([first,a]);else groups.set(key,a);}
    if(!duplicates.length)return;
    // Keep a recoverable copy and leave unused Keychain profiles untouched.
    const backup=this.file+'.before-dedup';if(!fs.existsSync(backup))fs.writeFileSync(backup,JSON.stringify(this.data),{mode:0o600,flag:'wx'});
    this.data.accountAliases||={};
    for(const [first,duplicate] of duplicates){
      const stable={id:first.id,label:first.label,preferredModel:first.preferredModel};
      if(duplicate.codexConnected)Object.assign(first,duplicate,stable);
      else if(!first.models?.length)first.models=duplicate.models||[];
      this.data.accountAliases[duplicate.id]=first.id;
    }
    const removed=new Set(duplicates.map(([,a])=>a.id));this.data.accounts=this.data.accounts.filter(a=>!removed.has(a.id));
    for(const id of Object.keys(this.data.accountAliases))this.data.accountAliases[id]=this.resolveAccountId(id);
    this.save();
  }
  snapshot(){const s=super.snapshot();s.available=!!this.executable&&!!this.openExternal;s.connectionMode='codex';s.accounts=s.accounts.map(a=>({...a,connected:a.mode==='codex'?a.codexConnected===true:a.connected}));return s;}
  providers(){return super.providers().map(p=>{const a=this.account(p.accountId);return a.mode!=='codex'?p:{...p,baseUrl:BASE,connectionMode:'codex',connectionAliases:Object.keys(this.data.accountAliases||{}).filter(id=>this.resolveAccountId(id)===a.id).map(id=>'chatgpt-'+id),workspaceAccountId:a.workspaceAccountId,planType:a.planType,signedIn:a.codexConnected===true,hasKey:a.codexConnected===true,keySource:'Codex sign-in · '+a.email};});}
  async helper(id){
    if(!/^[\da-f-]{36}$/i.test(id))throw Error('Invalid account identifier.');
    if(!this.executable)throw Error('Install ChatGPT or the official Codex CLI to use Codex sign-in.');
    if(!this.helpers.has(id)){
      const work=(async()=>{const dir=path.join(this.dir,'codex-accounts',id);fs.mkdirSync(dir,{recursive:true,mode:0o700});
        // A separate Keychain entry per account; never borrow the user's Codex profile.
        fs.writeFileSync(path.join(dir,'config.toml'),'cli_auth_credentials_store = "keyring"\n[analytics]\nenabled = false\n',{mode:0o600});
        const helper=this.factory({binary:this.executable,dir});helper.once('stopped',()=>{this.helpers.delete(id);});
        try{await helper.initialize();return helper;}catch(error){helper.close();throw error;}})();
      this.helpers.set(id,work);work.catch(()=>this.helpers.delete(id));
    }
    return this.helpers.get(id);
  }
  async begin(accountId){
    if(!this.openExternal)throw Error('Open sign-in from E1 Code.');
    if(this.starting||[...this.pending.values()].some(p=>['waiting','verifying'].includes(p.status)))throw Error('Finish or cancel the current sign-in first.');
    this.starting=true;let helper,p;
    try{
      const existing=accountId?this.account(accountId):null,id=existing?.id||crypto.randomUUID(),profileId=crypto.randomUUID();helper=await this.helper(profileId);
      p={id:crypto.randomUUID(),accountId:id,profileId,status:'waiting',helper,existing};this.pending.set(p.id,p);
      p.listener=event=>{if(event.loginId===p.loginId)void this.finish(p,event);};helper.on('login',p.listener);
      // Both hosted and streamlined success pages can launch the official desktop app.
      // E1 completes through the local callback and account/login/completed instead.
      const login=await helper.request('account/login/start',{type:'chatgpt',useHostedLoginSuccessPage:false,codexStreamlinedLogin:false});
      const url=new URL(login.authUrl);if(url.protocol!=='https:'||!['auth.openai.com','chatgpt.com'].includes(url.hostname))throw Error('Codex returned an unexpected sign-in page.');
      p.loginId=login.loginId;p.authUrl=login.authUrl;
      p.timer=setTimeout(()=>{void this.cancel(p.id);},10*60*1000);p.timer.unref();
      await this.openExternal(p.authUrl);return{id:p.id};
    }catch(error){if(p){p.status='failed';p.error=error.message;this.cleanup(p);if(p.loginId)await helper.request('account/login/cancel',{loginId:p.loginId}).catch(()=>{});}throw error;}
    finally{this.starting=false;}
  }
  cleanup(p){clearTimeout(p.timer);p.helper?.removeListener('login',p.listener);delete p.authUrl;}
  async finish(p,event){
    if(p.status!=='waiting')return;p.status='verifying';
    try{
      if(!event.success)throw Error('Codex sign-in was cancelled or could not complete.');
      const current=await p.helper.request('account/read',{refreshToken:false});
      const account=current.account,routing=current.workspaceRouting;
      if(account?.type!=='chatgpt'||!routing?.chatgptAccountId||routing.backendOrigin!=='https://chatgpt.com')throw Error('This workspace is not supported by the E1 Codex connection yet.');
      const signedIn={mode:'codex',email:account.email,workspaceAccountId:routing.chatgptAccountId};
      if(p.existing?.mode==='codex'&&(p.existing.workspaceAccountId!==routing.chatgptAccountId||(identity(p.existing)&&identity(p.existing)!==identity(signedIn))))throw Error('This is a different account or workspace. Add it as a separate connection.');
      const match=identity(signedIn)&&this.data.accounts.find(a=>identity(a)===identity(signedIn));
      const a=p.existing||match||{id:p.accountId,label:'ChatGPT '+(this.data.accounts.length+1),models:[]};
      const oldProfile=a.profileId;
      Object.assign(a,{mode:'codex',profileId:p.profileId,email:account.email||'ChatGPT account',workspaceAccountId:routing.chatgptAccountId,planType:account.planType,planEnabled:true,codexConnected:true,status:'connected'});
      if(!p.existing&&!match)this.data.accounts.push(a);p.accountId=a.id;this.save();this.onChange();
      try{await this.models(a.id);}catch{a.modelDiscoveryError=true;this.save();}
      p.status='complete';this.onChange({accountId:a.id,authenticated:true});
      if(oldProfile&&oldProfile!==p.profileId){try{const old=await this.helper(oldProfile);await old.request('account/logout',{}).catch(()=>{});old.close();}catch{/* The new connection is saved; old-profile cleanup is best effort. */}}
    }catch(error){p.status='failed';p.error=error.message;}
    finally{this.cleanup(p);if(p.status==='failed'){await p.helper.request('account/logout',{}).catch(()=>{});p.helper.close();}}
  }
  async reopen(id){const p=this.pending.get(id);if(!p||p.status!=='waiting'||!p.authUrl)throw Error('Start a new Codex sign-in.');await this.openExternal(p.authUrl);}
  async cancel(id){const p=this.pending.get(id);if(p?.status==='waiting'){p.status='cancelled';this.cleanup(p);await p.helper.request('account/login/cancel',{loginId:p.loginId}).catch(()=>{});await p.helper.request('account/logout',{}).catch(()=>{});p.helper.close();}}
  async token(id,refresh=false){
    const a=this.account(id);if(a.mode!=='codex')return super.token(id);
    if(!a.codexConnected)throw Error('Sign in to this ChatGPT account again.');
    if(!this.authRequests.has(id)){
      const work=(async()=>{const helper=await this.helper(a.profileId||id);const status=await helper.request('getAuthStatus',{includeToken:true,refreshToken:refresh});
        if(!status.authToken){a.codexConnected=false;a.status='sign-in-required';this.save();throw Error('Codex session expired. Sign in again.');}return status.authToken;})();
      this.authRequests.set(id,work);work.finally(()=>this.authRequests.delete(id)).catch(()=>{});
    }
    return this.authRequests.get(id);
  }
  async usage(id){const a=this.account(id);if(a.mode!=='codex'||!a.codexConnected)throw Error('Plan usage needs a connected Codex account.');const helper=await this.helper(a.profileId||id);return helper.request('account/rateLimits/read',{});}
  async models(id){
    const a=this.account(id);if(a.mode!=='codex')return super.models(id);
    const token=await this.token(id);const response=await this.transport(BASE+'/models?client_version=0.162.0',{headers:{Authorization:'Bearer '+token,'ChatGPT-Account-ID':a.workspaceAccountId,originator:'e1_code'},redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error('Codex model discovery returned HTTP '+response.status);
    const data=await response.json();const models=(data.models||[]).filter(m=>m.slug&&m.visibility==='list').map(m=>({id:m.slug,name:m.display_name||m.slug,contextWindow:m.context_window,maxTokens:m.max_output_tokens||32768,reasoningEfforts:(m.supported_reasoning_levels||[]).map(v=>typeof v==='string'?v:v.effort).filter(Boolean),reasoning:true,...require('./vision-fallback.cjs').modalityMetadata(m)}));
    if(!models.length)throw Error('Codex returned no available models.');a.models=models;delete a.modelDiscoveryError;this.save();this.onChange();return models;
  }
  async logout(id){const a=this.account(id);if(a.mode!=='codex')return super.logout(id);const helper=await this.helper(a.profileId||id);await helper.request('account/logout',{});a.codexConnected=false;a.status='signed-out';this.save();helper.close();this.onChange();return{message:'Signed out of this E1 Codex connection. Your chats are unchanged.'};}
  close(){super.close();for(const p of this.pending.values())this.cleanup(p);for(const helper of this.helpers.values())helper.then(h=>h.close()).catch(()=>{});this.helpers.clear();}
}
module.exports={CodexSubscriptions,BASE};
