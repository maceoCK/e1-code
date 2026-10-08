import {aa as h,za as useMemo,Ra as useLayoutEffect,Ua as useSyncExternalStore} from './vendor-frame-Bk3oL3Qp.js';
import {kc as Icon} from './shared-frame-mKeNK6Hi.js';
import {t as NativeTabs} from './cfe7c4b3b-GwJAekXp.js';
import {MixedTabs} from './e1-mixed-tab-state.js';
import {MixedPaneContext} from './e1-mixed-tab-context.js';

export function useMixedTabs(store,sessionId,tiles,hidden,expanded){
  const controller=useMemo(()=>new MixedTabs(store,sessionId),[store,sessionId]);
  const revision=useSyncExternalStore(controller.subscribe,controller.snapshot);
  const ids=useMemo(()=>tiles.map(tile=>tile.id),[tiles]);
  useLayoutEffect(()=>controller.sync(ids,new Map(tiles.map(tile=>[tile.id,tile.name]))),[controller,ids,tiles]);
  useLayoutEffect(()=>controller.connect(),[controller]);
  const active=ids.includes(controller.active)?controller.active:ids.filter(id=>id!=='chat').at(-1);
  const hiddenIds=useMemo(()=>{
    const result=new Set(hidden||[]),selected=expanded&&expanded!=='chat'?expanded:active;
    for(const id of ids)if(id!=='chat'&&(expanded==='chat'||id!==selected))result.add(id);
    return result;
  },[ids,active,hidden,expanded]);
  const layout=useMemo(()=>controller.layout(ids),[controller,ids,revision]);
  return {controller,hiddenIds,layout,onLayoutChange:useMemo(()=>layout=>controller.resize(layout),[controller])};
}
const icons={preview:'Globe',terminal:'CommandLinePrompt',file:'Folder',diff:'Code',pr:'Code',tasks:'Check',runs:'Play'};
const css=`
.e1-mixed-pane{height:100%;width:100%;min-height:0;min-width:0;display:flex;flex-direction:column;overflow:hidden}
.e1-mixed-strip{height:42px;min-height:42px;display:flex;align-items:center;padding:0 8px;border-bottom:1px solid var(--cds-border-default);background:var(--cds-background-base,var(--cds-surface-1))}
.e1-mixed-content{flex:1;min-height:0;min-width:0;position:relative;overflow:hidden}
`;
export function MixedTabFrame({model,tile,children}){
  const controller=model.controller;
  useSyncExternalStore(controller.subscribe,controller.snapshot);
  const context=useMemo(()=>({controller,pane:tile.id}),[controller,tile.id]);
  if(tile.id==='chat')return children;
  const entries=controller.entries().map(tab=>({...tab,icon:tab.icon||h(Icon,{name:icons[tab.pane.split(':')[0]]||'Document',size:"sm"})}));
  return h('div',{className:'e1-mixed-pane','data-e1-tool-pane':tile.id,children:[
    h('style',{children:css},'style'),
    h('div',{className:'e1-mixed-strip',children:h(NativeTabs,{
      'aria-label':'Workspace tabs',className:'min-w-0 flex-1',tabs:entries,activeId:controller.selected(entries),
      onActivate:id=>controller.call(id,'onActivate'),onReselect:id=>controller.call(id,'onReselect'),
      onClose:id=>controller.call(id,'onClose'),onKeep:id=>controller.call(id,'onKeep'),
      onReorder:(id,index)=>controller.reorder(id,index),
      onCreate:()=>window.e1TabPicker?window.e1TabPicker.open():window.e1NativeTabActions?.browser?.(),newTabShortcut:'cmd+t',minTabWidth:88,
    })},'strip'),
    h('div',{className:'e1-mixed-content',children:h(MixedPaneContext.Provider,{value:context,children})},'content'),
  ]});
}
