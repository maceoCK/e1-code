// Read-only native thread host. All records come from the selected Dot's
// authenticated catalog; the original renderer owns presentation and queries.
export function createThreadHost(profile,thread,call,bindings){
 const hostId='durable',rootId=profile.active_root_thread_id;
 const conversations=new Map(),hydrating=new Map();
 const cached=new Map(),summaries=new Map(),pending=new Map(),failures=new Map(),listeners=new Set();
 const millis=n=>typeof n==='number'&&n<1e11?n*1000:n;
 function remember(thread){
  cached.set(thread.id,thread);
  summaries.set(thread.id,{...thread,conversationId:thread.id,hostId,title:thread.name||(thread.id===rootId?profile.display_name:null),threadStartKind:thread.threadSource==='aeon'?'aeon':undefined,mode:'durable',createdAt:millis(thread.createdAt),updatedAt:millis(thread.updatedAt),recencyAt:millis(thread.recencyAt??thread.updatedAt),threadRuntimeStatus:thread.status});
  for(const sub of listeners)if(sub.key?.threadId===thread.id)sub.listener(field(thread.id,sub.field));
 }
 function field(id,name){
  const summary=summaries.get(id),thread=cached.get(id);if(!summary)return null;
  if(name==='summary')return summary;
  if(name==='listState')return{summary};
  if(name==='titleState')return conversations.has(id)?{kind:'loaded',title:summary.title,summary,subagentParentThreadId:thread.parentThreadId}:{kind:'unloaded',summary};
  if(name==='metadata')return{...summary,subagentParentThreadId:thread.parentThreadId};
  if(name==='sessionId')return thread.sessionId;
  if(name==='environments')return thread.environments;
  if(name==='fallbackSearchTitle')return thread.name||thread.preview||null;
  return null;
 }
 if(thread)remember(thread);
 function readThread(threadId){
  if(pending.has(threadId))return pending.get(threadId);
  if(failures.has(threadId))return Promise.reject(failures.get(threadId));
  const request=call('native-thread',{threadId}).then(value=>{remember(value.thread);return value;},error=>{failures.set(threadId,error);throw error;}).finally(()=>pending.delete(threadId));pending.set(threadId,request);return request;
 }
 async function hydrate(threadId){
  if(conversations.has(threadId))return conversations.get(threadId);
  if(hydrating.has(threadId))return hydrating.get(threadId);
  const request=(async()=>{
   const {thread}=await readThread(threadId),turns=[],seen=new Set();let cursor=null;
   do{const page=await call('native-turns',{threadId,cursor,limit:20,sortDirection:'desc',itemsView:'full'});if(!Array.isArray(page.data))throw Error('Dot returned an invalid task transcript.');turns.push(...page.data);cursor=page.nextCursor;if(cursor!=null){if(seen.has(cursor)||seen.size>=99)throw Error('Task history could not finish loading.');seen.add(cursor);}}while(cursor!=null);
   const conversation=bindings.normalizeConversation(thread,turns.reverse());conversations.set(threadId,conversation);remember(thread);return conversation;
  })().finally(()=>hydrating.delete(threadId));hydrating.set(threadId,request);return request;
 }
 const lease=(promise,dispose=()=>{})=>{const value={[Symbol.dispose]:dispose,onRpcBroken:()=>{},setHistoryViewport:async()=>{}};return Object.assign(promise.then(()=>value),value);};
 const noop=()=>()=>{};
 const result={
  getHostId:()=>hostId,
  activateThreadSummary:id=>{void readThread(id).catch(()=>{});},
  loadBackgroundThreadHistoryPage:id=>{failures.delete(id);return hydrate(id);},
  getThreadSummary:threadId=>summaries.get(threadId)||null,
  getThreadSummaries:()=>[...summaries.values()],
  getConversationCwd:threadId=>cached.get(threadId)?.cwd,
  getConversation:threadId=>conversations.get(threadId)||null,
  subscribe:sub=>{
   if(sub.type==='host'&&sub.field==='recentThreads')sub.listener([...summaries.values()].map(summary=>({summary})));
   else if(sub.type==='thread'){
    listeners.add(sub);sub.listener(field(sub.key.threadId,sub.field));
    if(!cached.has(sub.key.threadId)&&!failures.has(sub.key.threadId))void readThread(sub.key.threadId).catch(()=>{});
   }
   return()=>listeners.delete(sub);
  },
  addThreadSummariesCallback:noop,addNotificationCallback:noop,
  addConversationHistoryInvalidationListener:noop,addConversationChangeCallback:noop,
 };
 const methods={
  subscribe:options=>{if(options.type==='conversation'){let active=true;return lease(hydrate(options.key.threadId).then(conversation=>{if(active)options.listener({type:'reset',value:bindings.transcript(conversation)});}),()=>{active=false;});}return lease(Promise.resolve(),result.subscribe(options));},
  retainActiveConversation:threadId=>lease(hydrate(threadId)),
  // Build 20770 opens task tabs through the host RPC (activate, then first page).
  activateThreadSummary:id=>result.activateThreadSummary(id),
  ensureConversationFirstPage:async id=>{failures.delete(id);await hydrate(id);return conversations.has(id);},
  getHostId:()=>hostId,readThread,
  sendRequest:async(method,args)=>{if(method==='thread/turns/list')return call('native-turns',args);if(method==='thread/read')return readThread(args.threadId);throw Error('This task action is not connected to E1 yet.');},
  hydratePinnedThreads:async ids=>{const loaded=[];for(const id of ids){await readThread(id);loaded.push(id);}return loaded;},
  getCachedThreadMetadata:async ids=>ids.flatMap(id=>cached.has(id)?[cached.get(id)]:[]),
  discoverSubagentDescendantSnapshot:async root=>{
   const items=await call('native-catalog');if(root!==rootId&&!items.some(x=>x.thread_id===root))throw Error('Select a task attached to this Dot.');
   const children=new Map();for(const item of items){const parent=item.parent_thread_id;if(!children.has(parent))children.set(parent,[]);children.get(parent).push(item);}
   const seen=new Set([root]),queue=[root],descendantThreads=[];
   for(let i=0;i<queue.length;i++)for(const item of children.get(queue[i])||[]){if(seen.has(item.thread_id))continue;seen.add(item.thread_id);queue.push(item.thread_id);descendantThreads.push({id:item.thread_id,parentThreadId:item.parent_thread_id});}
   return{descendantThreads};
  },
  [Symbol.dispose]:()=>{},
 };
 const rpc=new Proxy(methods,{get(target,name){if(name in target)return target[name];if(name==='then')return undefined;return()=>{throw Error('This Dot host operation is not connected to E1 yet: '+String(name));};}});
 methods.dup=()=>rpc;
 return Object.assign(result,{rpc});
}
