// Account-bound adapters for routes recovered from ChatGPT build 13536 (unchanged in build 20770).
const BASE = 'https://chatgpt.com/backend-api';
const CLOUD = 'https://codex-cloud-backend.chatgpt.com';
class DotError extends Error { constructor(code, message) { super(message); this.code = code; } }
const id = value => {
 if (typeof value !== 'string' || !value || value.length > 256 || !/^[\w~-]+$/.test(value)) throw Error('Invalid Dot identifier.');
 return encodeURIComponent(value);
};
const cursor = value => {
 if (typeof value !== 'string' || !value || value.length > 8192) throw Error('Invalid Dot cursor.');
 return encodeURIComponent(value);
};
class DotService {
 constructor(subscriptions, {transport} = {}) { this.subscriptions = subscriptions; this.transport = transport; this.profiles = new Map(); this.identities = new Map(); this.tasks = new Map(); this.avatars = new Map(); }
 accounts() { return this.subscriptions.snapshot().accounts.filter(a => a.mode === 'codex' && a.connected).map(a => ({id:a.id,label:a.label,email:a.email,plan:a.planType})); }
 identity(accountId) {
  const a = this.subscriptions.account(accountId);
  if (a.mode !== 'codex' || !a.codexConnected) { this.profiles.delete(accountId); throw new DotError('sign_in', 'Reconnect this subscription in Settings.'); }
  return JSON.stringify([a.workspaceAccountId, a.profileId, a.accountId, a.email]);
 }
 async request(accountId, route, {method = 'GET', body, cloud = false} = {}) {
  const identity = this.identity(accountId), manager = this.subscriptions;
  const check = () => { if (this.identity(accountId) !== identity) { this.profiles.delete(accountId); throw new DotError('sign_in', 'This connection changed. Reload its Dot.'); } };
  const send = async refresh => {
   const token = await manager.token(accountId, refresh); check();
   const options = {method,headers:{Authorization:'Bearer '+token,'ChatGPT-Account-ID':manager.account(accountId).workspaceAccountId,originator:'e1_code',...(cloud?{'X-OpenAI-Product-Sku':'aeon'}:{}),...(body ? {'Content-Type':'application/json'} : {})},body:body ? JSON.stringify(body) : undefined,redirect:'error',signal:AbortSignal.timeout(30000)};
   return this.transport ? this.transport(accountId, (cloud?CLOUD:BASE)+route, options) : manager.transport((cloud?CLOUD:BASE)+route, options);
  };
  let response = await send(false);
  if (response.status === 401) { await response.body?.cancel(); response = await send(true); }
  check();
  if (!response.ok) {
   const challenge = response.headers.get('cf-mitigated') === 'challenge'; await response.body?.cancel();
   throw new DotError(challenge?'browser_verification':response.status===401?'sign_in':response.status===403?'access_denied':'request_failed', challenge?'ChatGPT returned a browser verification challenge to E1 (HTTP 403).':response.status===401?'This subscription needs to sign in again.':response.status===403?'Dot access was denied for this connection (HTTP 403).':'Dot request failed (HTTP '+response.status+').');
  }
  const result = response.status === 204 ? {} : await response.json(); check(); return result;
 }
 async pages(accountId, route) {
  let next, items = []; const seen = new Set();
  do {
   const page = await this.request(accountId, route+(next?'&cursor='+cursor(next):''));
   if (!Array.isArray(page.items)) throw Error('Dot returned an unsupported list format.');
   items.push(...page.items); next = page.cursor;
   if (next) { if (seen.has(next) || seen.size >= 200) throw Error('Dot could not finish loading this list. Please retry.'); seen.add(next); }
  } while (next);
  return items;
 }
 async list(accountId) {
  const identity = this.identity(accountId);
  const [primary, items] = await Promise.all([this.request(accountId, '/tbo/primary'), this.pages(accountId, '/tbo?limit=25')]);
  if (this.identity(accountId) !== identity) throw new DotError('sign_in','This connection changed. Reload its Dot.');
  this.profiles.set(accountId, new Map(items.map(p => [p.id,p]))); this.identities.set(accountId,identity);
  return {primary:primary.selection,items,cursor:null};
 }
 profile(accountId, dotId) {
  id(dotId); const identity = this.identity(accountId);
  if (this.identities.has(accountId) && this.identities.get(accountId) !== identity) this.profiles.delete(accountId);
  const profile = this.profiles.get(accountId)?.get(dotId);
  if (!profile) throw Error('Reload this account and select its Dot.'); return profile;
 }
 async detail(accountId, dotId) {
  const p = this.profile(accountId,dotId), taskPromise = this.pages(accountId,'/tbo/'+id(dotId)+'/threads?limit=100&include_hidden=true');
  if (!p.messaging_room_id) { const tasks=await taskPromise; this.tasks.set(accountId+'\0'+dotId,new Set(tasks.map(t=>t.thread_id))); return {profile:p,tasks,messages:[],room:null,before:null}; }
  const roomPath = '/messaging/rooms/'+id(p.messaging_room_id);
  const [tasks,room,messages] = await Promise.all([taskPromise,this.request(accountId,roomPath),this.request(accountId,roomPath+'/messages?limit=20')]);
  this.profile(accountId,dotId);
  this.tasks.set(accountId+'\0'+dotId,new Set(tasks.map(t=>t.thread_id)));
  if (room.id !== p.messaging_room_id || room.type !== 'DM' || room.app_source !== 'chatgpt:messaging') throw Error('Dot returned an unexpected message room.');
  if (!Array.isArray(messages.items)) throw Error('Dot returned an unsupported message format.');
  return {profile:p,tasks,room,messages:messages.items,before:messages.prev_cursor ?? (messages.items.length===20 ? [...messages.items].sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at))[0]?.id : null)};
 }
 async older(accountId,dotId,before) {
  const p = this.profile(accountId,dotId);
  if (!p.messaging_room_id) throw Error('This Dot has no message room.');
  return this.request(accountId,'/messaging/rooms/'+id(p.messaging_room_id)+'/messages?limit=20&before='+cursor(before));
 }
 async resources(accountId,dotId) {
  this.profile(accountId,dotId); const base = '/tbo/'+id(dotId), result = {};
  await Promise.all(['activity','automations','computers'].map(async name => {
   try { result[name] = name === 'automations' ? {items:await this.pages(accountId,base+'/automations?limit=100')} : await this.request(accountId,base+'/'+name+(name==='activity'?'?limit=50':'')); }
   catch (error) { result[name] = {error:{code:error.code||'request_failed',message:error.message}}; }
  }));
  this.profile(accountId,dotId); return result;
 }
 async avatar(accountId,dotId) {
  const profile=this.profile(accountId,dotId), identity=this.identity(accountId);
  let url;try{url=new URL(profile.avatar_url);}catch{throw Error('This Dot has no avatar image.');}
  if(url.protocol!=='https:'||!url.hostname.endsWith('.oaiusercontent.com')||url.username||url.password)throw Error('Unsupported Dot avatar host.');
  const key=accountId+'\0'+identity+'\0'+url.href;
  if(this.avatars.has(key))return this.avatars.get(key);
  if(!this.transport)throw Error('Avatar transport is unavailable.');
  const response=await this.transport(accountId,url.href,{method:'GET',headers:{},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok){await response.body?.cancel();throw Error('Could not load this Dot’s avatar.');}
  const type=response.headers.get('content-type')?.split(';')[0];
  if(!['image/png','image/jpeg','image/webp','image/gif'].includes(type)){await response.body?.cancel();throw Error('Unsupported Dot avatar image.');}
  const reader=response.body.getReader(),chunks=[];let size=0;
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>4*1024*1024){await reader.cancel();throw Error('Dot avatar image is too large.');}chunks.push(Buffer.from(part.value));}
  if(this.identity(accountId)!==identity)throw Error('This connection changed. Reload its Dot.');
  const data='data:'+type+';base64,'+Buffer.concat(chunks).toString('base64');
  if(this.avatars.size>=16)this.avatars.delete(this.avatars.keys().next().value);this.avatars.set(key,data);return data;
 }
 async task(accountId,dotId,threadId,{turns=false,before}={}) {
  this.profile(accountId,dotId); id(threadId);
  if (!this.tasks.get(accountId+'\0'+dotId)?.has(threadId)) throw Error('Select a task attached to this Dot.');
  if (turns) {
   return this.request(accountId,'/v2/threads/'+id(threadId)+'/turns?limit=20&sortDirection=desc&itemsView=full'+(before?'&cursor='+cursor(before):''),{cloud:true});
  }
  const result=await this.request(accountId,'/v1/threads/'+id(threadId),{cloud:true});
  if(result.thread?.id!==threadId)throw Error('Dot returned an unexpected task.');
  return result.thread;
 }
 async runtime(accountId,dotId,action) {
  this.profile(accountId,dotId); if (!['pause','resume'].includes(action)) throw Error('Unknown Dot action.');
  return this.request(accountId,'/tbo/'+id(dotId)+'/runtime/'+action,{method:'POST'});
 }
}
module.exports = {DotService,BASE};
