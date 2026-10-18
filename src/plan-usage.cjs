const label=name=>({five_hour:'5-hour limit',seven_day:'Weekly limit',seven_day_sonnet:'Sonnet weekly limit',seven_day_opus:'Opus weekly limit',seven_day_cowork:'Cowork weekly limit'}[name]||name.replace(/_/g,' '));
const percent=n=>typeof n==='number'&&Number.isFinite(n)?Math.max(0,Math.min(100,n)):null;
const time=value=>{if(value==null)return null;const n=typeof value==='number'?(value<1e12?value*1000:value):Date.parse(value);return Number.isFinite(n)?n:null;};
function claudeWindows(value,fraction=false){
 const rows=Object.entries(value||{}).filter(([key,v])=>key!=='extra_usage'&&v&&typeof v==='object'&&('utilization'in v||'resets_at'in v||'resetsAt'in v)).map(([key,v])=>({id:key,label:label(key),usedPercent:percent(typeof v.utilization==='number'?v.utilization*(fraction?100:1):null),resetsAt:time(v.resets_at??v.resetsAt)}));
 for(const [index,v] of (Array.isArray(value?.model_scoped)?value.model_scoped:[]).entries())rows.push({id:'model:'+index,label:v.display_name||'Model limit',usedPercent:percent(v.utilization),resetsAt:time(v.resets_at)});
 return rows;
}
function codexWindows(value){
 const buckets=value.rateLimitsByLimitId&&Object.keys(value.rateLimitsByLimitId).length?Object.entries(value.rateLimitsByLimitId):[['codex',value.rateLimits||value]];
 const rows=[];
 for(const [bucket,data] of buckets)for(const key of ['primary','secondary']){const v=data?.[key];if(!v)continue;const mins=v.windowDurationMins;const period=mins===300?'5-hour limit':mins===10080?'Weekly limit':mins?mins%1440===0?`${mins/1440}-day limit`:mins%60===0?`${mins/60}-hour limit`:`${mins}-minute limit`:key==='primary'?'Primary limit':'Secondary limit';rows.push({id:bucket+':'+key,label:(buckets.length>1?(data.limitName||bucket)+' · ':'')+period,usedPercent:percent(v.usedPercent),resetsAt:time(v.resetsAt)});}
 return rows;
}
class PlanUsage {
 constructor(store,{claudeUsage=require('./claude-plan-usage.cjs').readClaudeUsage,now=Date.now}={}){this.store=store;this.claudeUsage=claudeUsage;this.now=now;this.cache=new Map();this.pending=new Map();}
 context(providerId){
  const p=this.store.provider(providerId);
  const manager=p.authType==='claude-code'?this.store.claudeAccounts:p.authType==='chatgpt-subscription'?this.store.subscriptions:null;
  if(!manager||!p.signedIn)throw Error('This plan is not connected.');
  const a=manager.account(p.accountId);
  if(p.authType==='claude-code'&&a.method==='console')throw Error('This connection uses API billing.');
  return{p,a,manager,key:JSON.stringify([p.id,a.id,a.email,a.orgId,a.workspaceAccountId,a.configDir,a.profileId,a.method,a.codexConnected,a.connected])};
 }
 async read(providerId){
  let c;try{c=this.context(providerId);}catch{return{windows:[],state:'unavailable',note:'Plan usage is unavailable for this connection.'};}
  const cached=this.cache.get(c.key);if(cached&&this.now()-cached.at<(cached.value.state==='live'?60000:15000))return cached.value;
  if(this.pending.has(c.key))return this.pending.get(c.key);
  const work=this.fetch(c).then(value=>{if(this.context(providerId).key!==c.key)throw Error();this.cache.set(c.key,{at:this.now(),value});return value;}).catch(()=>({windows:[],state:'unavailable',note:'This account changed. Hover again to reload usage.'})).finally(()=>this.pending.delete(c.key));this.pending.set(c.key,work);return work;
 }
 async fetch({p,a,manager}){
  try{
   const claude=p.authType==='claude-code';
   if(claude){const data=await this.claudeUsage(manager.executable,a);if(!data.rate_limits_available||!data.rate_limits)throw Error();return{windows:claudeWindows(data.rate_limits),state:'live',checkedAt:this.now(),...(data.rate_limits.extra_usage?.is_enabled?{extraUsage:true}:{})};}
   const data=await manager.usage(a.id),windows=codexWindows(data);
   return{windows,state:'live',checkedAt:this.now(),...(windows.length?{}:{note:'No plan usage windows were reported.'})};
  }catch{
   if(p.authType==='claude-code'&&a.allowance?.unifiedWindows)return{windows:claudeWindows(a.allowance.unifiedWindows,true),state:'reported',checkedAt:time(a.billingCheckedAt),note:'Last reported by Claude. Live usage could not be refreshed.'};
   return{windows:[],state:'unavailable',note:'Usage could not be loaded. Hover again to retry.'};
  }
 }
}
module.exports={PlanUsage,claudeWindows,codexWindows};
