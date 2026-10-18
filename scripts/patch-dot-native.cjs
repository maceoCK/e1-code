const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const capture=process.env.E1_CHATGPT_CAPTURE&&path.resolve(process.env.E1_CHATGPT_CAPTURE);
function needCapture(){if(!capture)throw Error('Set E1_CHATGPT_CAPTURE to your local ChatGPT renderer capture. Proprietary application files are not included in this repository. See docs/native-build.md.');}
const shared='app-shared-6c00c2afcf84.js';
const initial='app-initial-61c077dcc1af.js';
// Add exports at the host boundary. Original component bodies, styles and
// animations are copied unchanged from the user's local capture.
const bindings=`\nexport function e1NativeBindings(options){Ult();Mlt();KHe();Dst();gP();QP();pY();y1();EG();O2();e6();yB();v5t();PI();K$r();mIt();PRt(options.persisted||{},options.persist);$3=options.host;return {React:o(),AuthContext:w2,dom:DOM_FACTORY(),ResizeContext:vji,resize:bji(),Intl:GHe,Router:Oft,Scope:Nlt,ScopeQuery:klt,QueryProvider:hPt,QueryClient:Est,AppScope:Q,ThreadScope:iY,RouteScope:v1,useScope:Rk,account:_G,seedDot(scope,profile,threadHost){const id=profile.active_root_thread_id;scope.set(N3,'durable',threadHost);scope.set(Wai,id,'durable');if(threadHost.rpc){scope.set(tF,'durable',true);scope.set(DI,'durable',{status:'ready',client:{rpc:threadHost.rpc}});scope.set(scope.get($P,'durable').state$,'connected');}scope.query.setData(PX,id,profile);TX(scope,id,profile,{attachment:{thread_id:id,parent_thread_id:null}});},seedCatalog(scope,items){scope.query.setData(S4,items);},seedNavigation(scope,navigation){scope.set(rF,navigation);},normalizeConversation(thread,turns){return _5t({thread,hostId:'durable',conversationId:thread.id,turns:l6t({thread:{...thread,turns}}),threadTitle:thread.name,resumeState:'resumed',latestCollaborationMode:{mode:'default',settings:{model:thread.model||'',reasoning_effort:thread.reasoningEffort??null,developer_instructions:null}}});},transcript(conversation){return I5t(conversation,{turnEntityKeys:c=>c.turns.map(t=>'turn:'+t.turnId),turn:(c,key)=>c.turns.find(t=>'turn:'+t.turnId===key),timeline:()=>null,hasSubagentActivity:(c,key)=>c.turns.find(t=>'turn:'+t.turnId===key)?.items.some(U8t)??false});}};}\n`;
function sharedSource(){needCapture();const raw=fs.readFileSync(path.join(capture,'assets',shared),'utf8');const exports=raw.slice(raw.lastIndexOf('export'));const dom=/([\w$]+) as \$fn[,}]/.exec(exports)?.[1];if(!dom)throw Error('ChatGPT renderer version does not match this adapter.');return raw+bindings.replace('DOM_FACTORY',dom);}
function initialSource(){needCapture();return fs.readFileSync(path.join(capture,'assets',initial),'utf8')+'\nexport function e1WorkspaceBindings(){v3r();yM();$dc();return {Tabs:u3r,controller:gM,useValue:J,ComputerPortal:qdc};}\n';}
function install(ion,base=path.resolve(__dirname,'..')){
 const files=['entry.mjs','host.mjs','thread-host.mjs','persisted.mjs','index.html','host.css'];
 const digest=crypto.createHash('sha256').update(sharedSource()).update(initialSource());for(const file of files)digest.update(fs.readFileSync(path.join(base,'src/dot-native',file)));
 const version='v-'+digest.digest('hex').slice(0,12),root=path.join(ion,'e1-native-dot'),dest=path.join(root,version);fs.mkdirSync(dest,{recursive:true});
 if(!fs.existsSync(path.join(dest,'assets',shared)))require('node:child_process').execFileSync('/bin/cp',['-cR',path.join(capture,'assets'),dest]);
 fs.writeFileSync(path.join(dest,'assets',shared),sharedSource());
 fs.writeFileSync(path.join(dest,'assets',initial),initialSource());
 for(const name of files)fs.copyFileSync(path.join(base,'src/dot-native',name),path.join(dest,name));
 const original=fs.readFileSync(path.join(capture,'assets',shared));
 fs.writeFileSync(path.join(dest,'provenance.json'),JSON.stringify({build:13536,capture,originalSharedSha256:crypto.createHash('sha256').update(original).digest('hex'),originalInitialSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(capture,'assets',initial))).digest('hex'),changes:['Additional host-boundary exports in app-shared and app-initial; original component bodies unchanged'],components:['native-room-e49f0e771dbe.js','composer-controls-8942a84379da.js','header-1f71d7444df5.js','side-panel-b5de653b980f.js','panel-ecdc47f0a2b5.js'],componentSha256:Object.fromEntries(['native-room-e49f0e771dbe.js','composer-controls-8942a84379da.js','header-1f71d7444df5.js','side-panel-b5de653b980f.js','panel-ecdc47f0a2b5.js'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(capture,'assets',name))).digest('hex')]))},null,2));
 // Every wrapper revision gets a new URL namespace. Electron's immutable asset
 // cache must not reuse an earlier adapter with the same recovered filenames.
 for(const name of fs.readdirSync(root))if(name!==version&&(name==='assets'||/^v-[a-f0-9]{12}$/.test(name)||['entry.mjs','host.mjs','thread-host.mjs','index.html','host.css','provenance.json'].includes(name)))fs.rmSync(path.join(root,name),{recursive:true,force:true});
 return {dest,version};
}
module.exports={capture,shared,sharedSource,initial,initialSource,install};
