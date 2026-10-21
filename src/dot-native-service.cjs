// Host adapter for the locally recovered ChatGPT renderer. Credentials never
// cross IPC. Every request belongs to one selected connection and owned Dot.
const crypto=require('node:crypto');
const {BASE}=require('./dot-service.cjs');
const key=/^[\w~-]{1,256}$/;
const CUA_ORIGIN='https://realtime.chatgpt.com';
class NativeDotService{
 constructor(api,{diagnostic=()=>{}}={}){this.diagnostic=diagnostic;this.api=api;this.sessions=new Map();this.pending=new Map();}
 async open(accountId,dotId){
  const api=this.api,profile=api.profile(accountId,dotId),identity=api.identity(accountId);
  const token=await api.subscriptions.token(accountId,false);
  let claims;try{claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));}catch{throw Error('This connection has no ChatGPT identity.');}
  const auth=claims['https://api.openai.com/auth']||{},userId=auth.chatgpt_user_id||auth.user_id,accountUserId=auth.chatgpt_account_user_id||auth.account_user_id||null;
  if(!userId)throw Error('Reconnect this subscription to load its ChatGPT user identity.');
  if(api.identity(accountId)!==identity)throw Error('This connection changed. Reload its Dot.');
  let rootThread=null;try{rootThread=(await api.request(accountId,'/v1/threads/'+profile.active_root_thread_id,{cloud:true})).thread;if(rootThread?.id!==profile.active_root_thread_id)rootThread=null;}catch{}
  if(api.identity(accountId)!==identity)throw Error('This connection changed. Reload its Dot.');
  const a=api.subscriptions.account(accountId),sessionId=crypto.randomUUID();
  const s={accountId,dotId,identity,workspaceAccountId:a.workspaceAccountId,userId,profile};
  this.sessions.set(sessionId,s);
  return {sessionId,profile,rootThread,identity:{accountId:a.workspaceAccountId,authenticatedAccountId:a.workspaceAccountId,userId,authenticatedUserId:userId,accountUserId,accountStructure:a.accountStructure||'personal',authMethod:'chatgpt',hasChatGptToken:true,authLoading:false,accountLoading:false,requiresAuth:false,plan:a.planType,email:a.email}};
 }
 get(sessionId){const s=this.sessions.get(sessionId);try{if(!s||this.api.identity(s.accountId)!==s.identity)throw Error('This Dot connection changed. Reopen it.');this.api.profile(s.accountId,s.dotId);return s;}catch(error){this.close(sessionId);throw error;}}
 async catalog(sessionId){
  const s=this.get(sessionId),items=await this.api.pages(s.accountId,'/tbo/'+s.dotId+'/threads?limit=100&include_hidden=true');this.get(sessionId);
  if(items.some(x=>typeof x.thread_id!=='string'||!key.test(x.thread_id)))throw Error('Dot returned invalid task identifiers.');
  s.threadIds=new Set([s.profile.active_root_thread_id,...items.map(x=>x.thread_id)]);return items;
 }
 async thread(sessionId,threadId){
  const s=this.get(sessionId);if(typeof threadId!=='string'||!key.test(threadId))throw Error('Invalid Dot task.');
  if(threadId!==s.profile.active_root_thread_id&&!s.threadIds?.has(threadId))await this.catalog(sessionId);
  if(threadId!==s.profile.active_root_thread_id&&!s.threadIds?.has(threadId))throw Error('This task is not attached to the selected Dot.');
  const result=await this.api.request(s.accountId,'/v1/threads/'+threadId,{cloud:true});this.get(sessionId);
  if(result.thread?.id!==threadId)throw Error('Dot returned an unexpected task.');return result;
 }
 async turns(sessionId,args){
  const {threadId}=args,s=this.get(sessionId);
  if(typeof threadId!=='string'||!key.test(threadId))throw Error('Invalid Dot task.');
  if(threadId!==s.profile.active_root_thread_id&&!s.threadIds?.has(threadId))await this.catalog(sessionId);
  if(threadId!==s.profile.active_root_thread_id&&!s.threadIds?.has(threadId))throw Error('This task is not attached to the selected Dot.');
  const limit=Math.min(50,Math.max(1,Number(args.limit)||20)),query=new URLSearchParams({limit:String(limit),sortDirection:args.sortDirection==='asc'?'asc':'desc',itemsView:args.itemsView==='notLoaded'?'notLoaded':'full'});
  if(args.cursor!=null){if(typeof args.cursor!=='string'||args.cursor.length>8192)throw Error('Invalid task history cursor.');query.set('cursor',args.cursor);}
  const result=await this.api.request(s.accountId,'/v2/threads/'+threadId+'/turns?'+query,{cloud:true});this.get(sessionId);return result;
 }
 route(s,request){
  const input=request?.url;if(typeof input!=='string'||input.length>16384)throw Error('Invalid native Dot route.');
  const url=new URL(input,BASE+'/');
  // ChatGPT build 20770 sends the Dot computer SDP offer to the realtime CUA
  // service instead of /tbo/{id}/computer/sessions. Allow only that offer, for this Dot and its known tasks.
  if(url.origin===CUA_ORIGIN){
   const method=String(request.method||'GET').toUpperCase(),q=url.searchParams,threadId=q.get('thread_id'),one=name=>q.getAll(name).length===1;
   if(url.username||url.password||url.hash||method!=='POST'||url.pathname!=='/v1/cua'||[...q.keys()].some(k=>!['source','thread_id','aeon_id'].includes(k))||!one('source')||!one('aeon_id')||!one('thread_id')||q.get('source')!=='aeon'||q.get('aeon_id')!==s.dotId||!key.test(threadId)||threadId!==s.profile.active_root_thread_id&&!s.threadIds?.has(threadId))throw Error('This native Dot action is not connected to E1 yet.');
   const expected=Object.entries(request.headers||{}).find(([k])=>k.toLowerCase()==='x-openai-expected-account-id')?.[1];
   if(expected&&expected!==s.workspaceAccountId)throw Error('Native Dot account does not match the selected connection.');
   return {route:url.pathname+url.search,method,url:url.href};
  }
  if(url.origin!=='https://chatgpt.com'||url.username||url.password||url.hash)throw Error('Invalid native Dot host.');
  // The native renderer passes /tbo/... relative to the backend API.
  let route=url.pathname.replace(/^\/backend-api(?=\/)/,'');
  const method=String(request.method||'GET').toUpperCase();
  const parts=route.split('/').filter(Boolean),p=s.profile;
  const knownRoom=parts[0]==='messaging'&&parts[1]==='rooms'&&parts[2]===p.messaging_room_id;
  const ownDot=parts[0]==='tbo'&&parts[1]===s.dotId;
  const ownThread=parts[0]==='tbo'&&parts[1]==='by-thread'&&parts[2]===p.active_root_thread_id;
  const commonRead=['/tbo/primary','/tbo','/me','/accounts/check/v4-2023-04-27','/accounts/optimized/check','/celsius/ws/user'].includes(route);
  const read=method==='GET'&&(knownRoom||ownDot||ownThread||commonRead);
  const computerSession=ownDot&&parts[2]==='computer'&&parts[3]==='sessions';
  const write=method==='POST'&&((knownRoom&&['read','responding_heartbeat','messages','subscribe'].includes(parts[3]))||(ownDot&&parts[2]==='runtime'&&['pause','resume'].includes(parts[3]))||(computerSession&&parts.length===4))||method==='DELETE'&&computerSession&&parts.length===5;
  if(!read&&!write)throw Error('This native Dot action is not connected to E1 yet.');
  if(parts.some(x=>!key.test(x)))throw Error('Invalid native Dot identifier.');
  const expected=Object.entries(request.headers||{}).find(([k])=>k.toLowerCase()==='x-openai-expected-account-id')?.[1];
  if(expected&&expected!==s.workspaceAccountId)throw Error('Native Dot account does not match the selected connection.');
  // Authenticate as E1 and let ChatGPT enforce its own request requirements.
  // Do not manufacture device attestation or security-verification headers.
  return {route:route+url.search,method};
 }
 async fetch(sessionId,requestId,request){
  if(typeof requestId!=='string'||!key.test(requestId))throw Error('Invalid request identifier.');
  const s=this.get(sessionId),{route,method,url}=this.route(s,request),controller=new AbortController();
  const requestKey=sessionId+'\0'+requestId;this.cancel(sessionId,requestId);
  const pending={controller,sessionId};this.pending.set(requestKey,pending);
  try{
   const api=this.api;let token=await api.subscriptions.token(s.accountId,false);this.get(sessionId);
   const headers={Authorization:'Bearer '+token,'ChatGPT-Account-ID':s.workspaceAccountId,originator:'e1_code'};
   const body=request.body==null?undefined:typeof request.body==='string'?request.body:JSON.stringify(request.body);
   if(body&&Buffer.byteLength(body)>1024*1024)throw Error('Native Dot request is too large.');
   if(body){const supplied=Object.entries(request.headers||{}).find(([name])=>name.toLowerCase()==='content-type')?.[1];headers['Content-Type']=supplied==='application/sdp'?supplied:'application/json';}
   const send=()=>api.transport(s.accountId,url||BASE+route,{method,headers,body,signal:controller.signal,redirect:'error'});
   let response=await send();this.diagnostic({event:'response',method,route:route.split('?')[0].split('/').map(x=>/^(tbo|rooms|messaging|by-thread|messages|read|responding_heartbeat|activity|stream|automations|environment|status|primary|celsius|ws|user|accounts|check|v4-2023-04-27|me|tasks|subscription|v1|cua)$/.test(x)?x:x?'{id}':'').join('/'),status:response.status});
   if(response.status===401){await response.body?.cancel();token=await api.subscriptions.token(s.accountId,true);this.get(sessionId);headers.Authorization='Bearer '+token;response=await send();}
   this.get(sessionId);
   if(response.headers.get('cf-mitigated')==='challenge'){await response.body?.cancel();throw Error('ChatGPT requires browser verification for this request. No action was confirmed.');}
   pending.reader=response.body?.getReader();if(!pending.reader)this.pending.delete(requestKey);
   return {status:response.status,statusText:response.statusText,headers:Object.fromEntries(response.headers),stream:!!pending.reader};
  }catch(e){this.diagnostic({event:'request-error',method,name:e.name});this.cancel(sessionId,requestId);throw e;}
 }
 async pull(sessionId,requestId){
  this.get(sessionId);const requestKey=sessionId+'\0'+requestId,p=this.pending.get(requestKey);if(!p?.reader)return{done:true};
  try{const chunk=await p.reader.read();this.get(sessionId);if(chunk.done)this.pending.delete(requestKey);return{done:chunk.done,bytes:chunk.value};}catch(e){this.cancel(sessionId,requestId);throw e;}
 }
 cancel(sessionId,requestId){const k=sessionId+'\0'+requestId,p=this.pending.get(k);if(p){this.pending.delete(k);p.controller.abort();void p.reader?.cancel().catch(()=>{});}return{};}
 close(sessionId){for(const [k,p] of this.pending)if(p.sessionId===sessionId)this.cancel(sessionId,k.split('\0')[1]);this.sessions.delete(sessionId);return{};}
}
module.exports={NativeDotService};
