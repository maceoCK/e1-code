// A session owns one tool group. Native panes still own their contents and
// confirmations; this controller only chooses visibility and tab order.
export function tileIds(layout) {
  const result=[];
  function visit(node){if(!node)return;if(node.kind==='tile')result.push(node.tileId);else node.children?.forEach(visit);}
  visit(layout?.root);return result;
}
const kind=id=>id.split(':')[0];
const labels={preview:'Browser',file:'Files',terminal:'Terminal',diff:'Changes',pr:'Pull request',tasks:'Tasks',runs:'Runs'};
export class MixedTabs {
  constructor(store,sessionId,storage=globalThis.localStorage){
    this.store=store;this.sessionId=sessionId;this.storage=storage;
    this.key='e1.tool-tabs.v1:'+sessionId;this.records=new Map();this.listeners=new Set();this.version=0;
    this.ids=[];this.active=null;this.order=[];this.ratio=.55;
    try{const saved=JSON.parse(storage?.getItem(this.key)||'null');if(saved){this.active=saved.active;this.order=Array.isArray(saved.order)?saved.order:[];this.ratio=Math.min(.8,Math.max(.2,saved.ratio||.55));}}catch{}
  }
  subscribe=callback=>{this.listeners.add(callback);return()=>this.listeners.delete(callback)};
  snapshot=()=>this.version;
  emit(){this.version++;for(const callback of this.listeners)callback();}
  save(){try{this.storage?.setItem(this.key,JSON.stringify({active:this.active,order:this.order,ratio:this.ratio}));}catch{}}
  resolve(id){return this.ids.find(value=>value===id)||this.ids.find(value=>kind(value)===id);}
  sync(ids,names){
    const tools=ids.filter(id=>id!=='chat'),changed=tools.join('\n')!==this.ids.join('\n');
    const namesChanged=tools.some(id=>names?.get(id)!==this.names?.get(id));
    const previous=this.entries(),selected=previous.findIndex(tab=>tab.pane===this.active);
    const added=tools.filter(id=>!this.ids.includes(id));this.ids=tools;this.names=names;
    for(const id of this.records.keys())if(!tools.includes(id))this.records.delete(id);
    if(!tools.includes(this.active))this.active=previous.slice(selected+1).find(tab=>tools.includes(tab.pane))?.pane||previous.slice(0,selected).reverse().find(tab=>tools.includes(tab.pane))?.pane||tools.at(-1)||null;
    if(changed){if(this.initialized&&added.length)this.active=added.at(-1);this.initialized=true;this.save();this.emit();}
    else if(namesChanged)this.emit();
  }
  activate(pane){
    const id=this.resolve(pane);if(!id)return;
    if(this.active!==id){this.active=id;this.save();this.emit();}
    const state=this.store?.getState();
    if(state?.currentSessionId!==this.sessionId)return;
    state.collapseExpandedTile?.();
    if(state.focusedTile!==id)state.setFocusedTile?.(id);
  }
  register(pane,props){
    // Callback/element identity changes on native renders. Do not feed those
    // identities back into React; notify only when visible tab data changes.
    const signature=JSON.stringify([props.activeId,props.tabs?.map(tab=>[tab.id,tab.label,tab.detail,tab.closable,tab.preview,tab.dirty,tab.icon?.props?.src,tab.icon?.props?.busy])]);
    const previous=this.records.get(pane);this.records.set(pane,{props,signature});
    if(previous&&props.activeId!==previous.props.activeId&&props.tabs?.some(tab=>tab.id===props.activeId&&!previous.props.tabs?.some(old=>old.id===tab.id)))this.activate(pane);
    if(previous?.signature!==signature)this.emit();
  }
  entries(){
    const entries=this.ids.flatMap(pane=>{
      const tabs=this.records.get(pane)?.props.tabs;
      return tabs?.length?tabs.map(tab=>({...tab,id:JSON.stringify([pane,tab.id]),nativeId:tab.id,pane})):
        [{id:JSON.stringify([pane,null]),pane,nativeId:null,label:labels[kind(pane)]||this.names?.get(pane)||pane,closable:true}];
    });
    const positions=new Map(this.order.map((id,index)=>[id,index]));
    return entries.sort((a,b)=>(positions.get(a.id)??Infinity)-(positions.get(b.id)??Infinity));
  }
  selected(entries){
    const nativeId=this.records.get(this.active)?.props.activeId;
    return entries.find(tab=>tab.pane===this.active&&tab.nativeId===nativeId)?.id||entries.find(tab=>tab.pane===this.active)?.id||'';
  }
  call(id,method,...args){
    const tab=this.entries().find(tab=>tab.id===id);if(!tab)return;
    const props=this.records.get(tab.pane)?.props;
    // Discard / running-server confirmations belong to the native pane. Make
    // that pane visible before invoking a close that may need a decision.
    if(method==='onActivate'||method==='onReselect'||method==='onClose')this.activate(tab.pane);
    if(tab.nativeId!==null&&props?.[method])return props[method](tab.nativeId,...args);
    if(method==='onClose')return this.store?.getState().closeSidePane?.(tab.pane);
  }
  reorder(id,index){const order=this.entries().map(tab=>tab.id),from=order.indexOf(id);if(from<0)return;order.splice(from,1);order.splice(index,0,id);this.order=order;this.save();this.emit();}
  layout(ids){return {root:{kind:'stack',id:'e1-tool-group',direction:'row',flex:1,children:ids.map(id=>({kind:'tile',tileId:id,flex:id==='chat'?this.ratio:1-this.ratio}))}};}
  resize(layout){
    const nodes=layout.root?.children||[],chat=nodes.find(node=>node.tileId==='chat'),active=nodes.find(node=>node.tileId===this.active);
    if(!chat||!active)return;
    const ratio=Math.min(.8,Math.max(.2,chat.flex/(chat.flex+active.flex)));
    if(Number.isFinite(ratio)&&Math.abs(ratio-this.ratio)>.001){this.ratio=ratio;this.save();this.emit();}
  }
  connect(){
    if(!this.store)return()=>{};
    const store=this.store,original=store.getState(),controller=this;
    const ours=()=>store.getState().currentSessionId===controller.sessionId;
    function setSidePane(...args){const result=original.setSidePane(...args);if(ours())controller.activate(args[0]);return result;}
    function toggleSidePane(id,...args){
      const target=controller.resolve(id);
      if(ours()&&target&&controller.active!==target){controller.activate(target);return;}
      return original.toggleSidePane(id,...args);
    }
    store.setState({setSidePane,toggleSidePane});
    const unsubscribe=store.subscribe((state,previous)=>{
      if(!ours())return;
      if(state.tileLayout!==previous.tileLayout)controller.sync(tileIds(state.tileLayout),controller.names);
      const target=state.sidePane!==previous.sidePane?state.sidePane:state.focusedTile!==previous.focusedTile?state.focusedTile:null;
      if(target&&target!=='chat'&&target!=='none')controller.activate(target);
    });
    return()=>{unsubscribe();const current=store.getState(),restore={};if(current.setSidePane===setSidePane)restore.setSidePane=original.setSidePane;if(current.toggleSidePane===toggleSidePane)restore.toggleSidePane=original.toggleSidePane;if(Object.keys(restore).length)store.setState(restore);};
  }
}
