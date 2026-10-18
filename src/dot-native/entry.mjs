import {createHost,installLegacyBridge} from './host.mjs';
import {createThreadHost} from './thread-host.mjs';
import {migratePersisted} from './persisted.mjs';
installLegacyBridge();
const params=new URLSearchParams(location.search),accountId=params.get('account'),dotId=params.get('dot');
const api=async(operation,args={})=>{const result=await (window.e1Dot||window.parent.e1Dot).request(operation,args);if(result?.dotError)throw Object.assign(new Error(result.dotError.message),{code:result.dotError.code});return result;};
try{const theme=window.parent.document.querySelector('.cds-root')?.getAttribute('data-mode')||'light';document.documentElement.dataset.theme=theme;document.documentElement.classList.toggle('dark',theme==='dark');}catch{}
let hostConnection,root;
try{
 const context=await api('native-open',{accountId,dotId});
 const [{e1NativeBindings},room,header,{e1WorkspaceBindings}]=await Promise.all([
  import('./assets/app-shared-6c00c2afcf84.js'),import('./assets/native-room-e49f0e771dbe.js'),import('./assets/header-1f71d7444df5.js'),import('./assets/app-initial-61c077dcc1af.js')
 ]);
 room.n();header.n();
 hostConnection=createHost(api,context.sessionId);
 const storageKey='e1-native-dot:'+accountId;let persisted={};try{persisted=migratePersisted(JSON.parse(localStorage.getItem(storageKey)||'{}'));localStorage.setItem(storageKey,JSON.stringify(persisted));}catch{}
 const b=e1NativeBindings({host:hostConnection.host,persisted,persist:(key,value)=>{persisted[key]=value;try{localStorage.setItem(storageKey,JSON.stringify(persisted));}catch{}}});
 const R=b.React,h=R.createElement,profile=context.profile,threadId=profile.active_root_thread_id,threadHost=createThreadHost(profile,context.rootThread,(op,args)=>api(op,{sessionId:context.sessionId,...args}),b);
 const workspace=e1WorkspaceBindings();
 const query=new b.QueryClient({defaultOptions:{queries:{retry:false}}});
 const route={pathname:'/dots/'+threadId,routeTemplate:'/dots/:conversationId',routeKind:'local-thread',conversationId:threadId,hostId:'durable',projectContext:null,search:''};
 function Setup(){const scope=b.useScope(b.AppScope);R.useMemo(()=>{scope.set(b.account,context.identity);b.seedDot(scope,profile,threadHost);},[scope]);R.useEffect(()=>{let active=true;api('native-catalog',{sessionId:context.sessionId}).then(items=>{if(active)b.seedCatalog(scope,items);}).catch(error=>console.error('Dot catalog:',error.message));return()=>{active=false;};},[scope]);
  return h(b.Scope,{scope:b.ThreadScope,value:{clientThreadId:threadId,routeConversationId:threadId}},h(b.Scope,{scope:b.RouteScope,value:route},h(NativeWorkspace)));}
 function NativeWorkspace(){const scope=b.useScope(b.RouteScope);R.useMemo(()=>{b.seedNavigation(scope,{
   navigateToLocalConversation:async(id,hostId)=>{try{if(hostId&&hostId!=='durable')throw Error('This task belongs to a different connection.');await threadHost.loadBackgroundThreadHistoryPage(id);const {openLocalConversationBackgroundAgent}=await import('./assets/open-local-conversation-background-agent-c880b1f1cf1b.js');await openLocalConversationBackgroundAgent(scope,{hostId:'durable',backgroundAgent:{conversationId:id,displayName:threadHost.getThreadSummary(id)?.title||'Task',canInteract:false},shouldResume:false});}catch(error){console.error('Dot task navigation:',error.stack);}},
   navigate:()=>{throw Error('This destination is not connected to E1 yet.');},prepareNavigation:()=>{}
  });},[scope]);const tabs=workspace.useValue(workspace.controller.tabs$);return h('div',{className:'e1-native-workspace'},h('div',{className:'e1-native-room','data-e1-original-component':'native-room-e49f0e771dbe'},h(room.t,{active:true,hostId:'durable',roomId:profile.messaging_room_id,conversationId:threadId,orbitId:profile.id,isOrbit:true,header:h(header.t,{conversationId:threadId,roomId:profile.messaging_room_id,draft:{name:profile.name||profile.display_name}})})),tabs.length>0?h('aside',{className:'e1-native-tabs'},h(workspace.Tabs,{controller:workspace.controller,headerHeight:'pane'})):null,h(workspace.ComputerPortal,{conversationId:threadId}));}
 const errorDetails=e=>(e.errors?.length?e.errors.flatMap(errorDetails):[e.stack||e.message]);
 class Boundary extends R.Component{state={error:null};static getDerivedStateFromError(error){return{error};}componentDidCatch(error){console.error('Native Dot render:',...errorDetails(error));}render(){return this.state.error?h('div',{className:'e1-native-failure',role:'alert'},h('h2',null,'Could not open your dot'),h('p',null,this.state.error.message||(this.state.error.errors||[]).map(e=>e.message).join('; ')),h('button',{onClick:()=>location.reload()},'Retry')):this.props.children;}}
 root=b.dom.createRoot(document.getElementById('root'));
 root.render(h(Boundary,null,h(b.ResizeContext,{value:b.resize},h(b.AuthContext,{value:{...context.identity,openAIAuth:'chatgpt',isLoading:false,planAtLogin:context.identity.plan}},h(b.Intl,{locale:'en',messages:{}},h(b.QueryProvider,{client:query},h(b.ScopeQuery,{queryClient:query},h(b.Scope,{scope:b.AppScope},h(b.Router,{location:route.pathname,navigator:{createHref:x=>typeof x==='string'?x:x.pathname,push:()=>{},replace:()=>{},go:()=>{}}},h(Setup))))))))));
 window.addEventListener('pagehide',()=>{root.unmount();query.clear();b.resize?.disconnect();hostConnection.close();},{once:true});
 window.parent.postMessage({type:'e1-dot-native-mounted',build:13536},location.origin);
}catch(error){
 hostConnection?.close();const main=document.createElement('main');main.className='e1-native-failure';main.setAttribute('role','alert');const title=document.createElement('h2');title.textContent='Could not open your dot';const message=document.createElement('p');message.textContent=error.message;const retry=document.createElement('button');retry.textContent='Retry';retry.onclick=()=>location.reload();main.append(title,message,retry);document.getElementById('root').replaceChildren(main);
}
