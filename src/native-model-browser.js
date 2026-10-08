import {aa as h, va as createContext, Aa as useContext, Ha as useState, Na as useEffect, Va as useRef} from './vendor-frame-Bk3oL3Qp.js';
import './e1-model-list.js';

const Query=createContext('');
export const isE1Catalog = models => models.some(m => m.id.startsWith('claude-aster-'));
export function ModelPopup({Menu,models,children,header,...props}) {
  if (!isE1Catalog(models)) return h(Menu.Popup,{...props,header,children});
  // Native numeric shortcuts must not consume digits typed into search.
  const {'data-cds-model-selector-digits':digits,...searchableProps}=props;
  return h(Menu.SearchablePopup,{
    ...searchableProps, searchLabel:'Search models', beforeSearch:header,
    style:{...props.style,minWidth:'min(340px, calc(100vw - 32px))',maxWidth:'min(440px, calc(100vw - 32px))'},
    children:query=>h(Query.Provider,{value:query,children}),
  });
}
export function ModelList({Menu,models,selected,renderModel}) {
  const query=useContext(Query),revision=useRef(0);
  const [snapshot,setSnapshot]=useState({preferences:{showLegacy:false},models:[]});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    let alive=true;
    const read=async()=>{const ticket=++revision.current;try{const next=await window.e1ModelBrowser?.read();if(alive&&ticket===revision.current&&next)setSnapshot(next);}catch(e){if(alive&&ticket===revision.current)setError(e.message);}};
    void read();const unsubscribe=window.e1ModelBrowser?.onChange(read);
    return ()=>{alive=false;revision.current++;unsubscribe?.();};
  },[]);
  const details=new Map(snapshot.models.map(r=>[r.id,r]));
  const rows=models.map(model=>({...details.get(model.id),...model,model:details.get(model.id)?.model || model.model}));
  const visible=globalThis.E1ModelList.arrange(rows,{showLegacy:snapshot.preferences.showLegacy,selected,query});
  const groups=new Map();
  for(const row of visible){if(!groups.has(row.vendor))groups.set(row.vendor,[]);groups.get(row.vendor).push(row);}
  async function toggle(){
    if(busy)return;setBusy(true);setError('');
    const ticket=++revision.current;
    try{const next=await window.e1ModelBrowser.save({showLegacy:!snapshot.preferences.showLegacy});if(ticket===revision.current)setSnapshot(next);}
    catch(e){if(ticket===revision.current)setError(e.message);}finally{setBusy(false);}
  }
  return h('div',{'data-e1-model-list':'',children:[
    ...[...groups].map(([label,rows])=>h(Menu.Group,{children:[
      h(Menu.GroupLabel,{children:label},'label'),
      ...rows.map(row=>renderModel(row,{title:row.title,hint:[row.legacy?'Legacy':null,row.connection&&row.connection!==row.vendor?row.connection:null].filter(Boolean).join(' · ')||undefined})),
    ]},label)),
    !visible.length&&h('div',{className:'px-md py-sm text-body text-muted',role:'status',children:'No matching models. Try a model, provider, or connection name.'},'empty'),
    h(Menu.Separator,{},'separator'),
    h(Menu.Item,{keepOpen:true,checked:snapshot.preferences.showLegacy,checkedRole:'checkbox',disabled:busy||!window.e1ModelBrowser,onClick:()=>void toggle(),children:'Show legacy models'},'legacy'),
    error&&h('div',{role:'alert',className:'px-md py-sm text-body text-danger',children:error},'error'),
  ]});
}
