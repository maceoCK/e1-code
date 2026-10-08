import {va as createContext,Aa as useContext,Ra as useLayoutEffect,Ua as useSyncExternalStore} from './vendor-frame-Bk3oL3Qp.js';
export const MixedPaneContext=createContext(null);
const noopSubscribe=()=>()=>{},zero=()=>0;
export function useMixedPaneHidden(){
  const context=useContext(MixedPaneContext);
  useSyncExternalStore(context?.controller.subscribe||noopSubscribe,context?.controller.snapshot||zero);
  return !!context&&context.controller.active!==context.pane;
}
export function useMixedPreviewVisibility(serverId,claimantId,targetWindowId,hide){
  const context=useContext(MixedPaneContext);
  useLayoutEffect(()=>{
    if(!context||!serverId||!hide)return;
    const update=()=>{if(context.controller.active!==context.pane)Promise.resolve(hide(serverId,claimantId,targetWindowId)).catch(()=>{});};
    update();
    return context.controller.subscribe(update);
  },[context,serverId,claimantId,targetWindowId,hide]);
}
export function useMixedNativeTabs(props){
  const context=useContext(MixedPaneContext);
  useLayoutEffect(()=>{if(context)context.controller.register(context.pane,props);});
  // Hidden native Activities suspend effects. Retain registrations until the
  // actual pane closes, so switching tabs never loses its native close handler.
  return !!context;
}
