import {aa as h, Ha as useState, Na as useEffect, Va as useRef} from './vendor-frame-Bk3oL3Qp.js';
import {kc as Icon} from './shared-frame-mKeNK6Hi.js';

// Codex's native new-tab Page: tools first, then up to four real top sites.
// Keep navigation in the recovered browser; this component never embeds a browser.
const historyKey='e1.browser.top-sites.v1', changed='e1:browser-top-sites';
function readSites(){
  try {
    const rows=JSON.parse(localStorage.getItem(historyKey)||'[]');
    return Array.isArray(rows)?rows.filter(row=>{
      try { const url=new URL(row.url);return /^https?:$/.test(url.protocol)&&url.origin===row.url&&Number.isFinite(row.visits)&&Number.isFinite(row.lastVisit); }catch{return false;}
    }).slice(0,40):[];
  }catch{return [];}
}
function saveSites(rows){
  try{localStorage.setItem(historyKey,JSON.stringify(rows));}catch{}
  window.dispatchEvent(new Event(changed));
}
export function recordBrowserVisit(value){
  let url;try{url=new URL(value);}catch{return;}
  if(!/^https?:$/.test(url.protocol)||url.username||url.password)return;
  // Suggested sites only need the origin. Never retain URL tokens, searches or paths.
  const rows=readSites(),previous=rows.find(row=>row.url===url.origin),now=Date.now();
  if(previous&&now-previous.lastVisit<10000)return;
  saveSites([{url:url.origin,visits:(previous?.visits||0)+1,lastVisit:now,dismissed:previous?.dismissed===true},...rows.filter(row=>row.url!==url.origin)].slice(0,40));
}
function topSites(){return readSites().filter(row=>!row.dismissed).sort((a,b)=>b.visits-a.visits||b.lastVisit-a.lastVisit).slice(0,4);}
const tools=[['browser','Browser','Globe'],['terminal','Terminal','CommandLinePrompt'],['files','Files','Folder'],['changes','Changes','Code']];
const css=`
.e1-browser-start{container-type:inline-size;height:100%;min-height:0;overflow:auto;overscroll-behavior:contain;padding:32px 24px;box-sizing:border-box;user-select:none;background:var(--cds-background-base,var(--cds-surface-1));color:var(--cds-text-primary)}
.e1-browser-start-inner{display:flex;flex-direction:column;gap:40px;width:100%;max-width:768px;margin:0 auto}
.e1-browser-start h3{font-family:inherit;font-weight:500;font-size:14px;line-height:20px;margin:0 0 12px;color:var(--cds-text-primary)}
.e1-browser-tools{display:grid;grid-template-columns:minmax(0,1fr);gap:4px 16px}
@container (min-width:448px){.e1-browser-tools{grid-template-columns:repeat(2,minmax(0,1fr))}}
.e1-browser-tool{display:flex;align-items:center;gap:8px;min-height:40px;min-width:0;width:100%;border:0;border-radius:6px;padding:8px 10px;text-align:left;font-family:inherit;font-weight:400;font-size:14px;line-height:20px;color:var(--cds-text-primary);background:var(--cds-alpha-1);cursor:pointer}
.e1-browser-tool>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.e1-browser-tool svg,.e1-browser-site-icon{color:var(--cds-text-secondary)}
.e1-browser-tool:hover{background:var(--cds-alpha-2)}
.e1-browser-start button:focus-visible{outline:2px solid var(--cds-fill-accent);outline-offset:2px}
.e1-browser-sites{display:flex;gap:12px;overflow-x:auto;padding:2px;margin:-2px}
.e1-browser-site{position:relative;flex:1;min-width:128px;border-radius:12px}
.e1-browser-site-open{display:flex;flex-direction:column;align-items:center;gap:12px;width:100%;border:0;border-radius:12px;padding:12px;background:transparent;color:var(--cds-text-primary);font-family:inherit;font-weight:400;font-size:14px;line-height:20px;cursor:pointer}
.e1-browser-site:hover,.e1-browser-site:focus-within{background:var(--cds-alpha-1)}
.e1-browser-site-icon{display:flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:50%;background:var(--cds-alpha-1)}
.e1-browser-site-label{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}
.e1-browser-site-dismiss{position:absolute;right:2px;top:2px;display:flex;align-items:center;justify-content:center;width:24px;height:24px;border:0;border-radius:6px;background:var(--cds-surface-1);color:var(--cds-text-secondary);opacity:0;cursor:pointer}
.e1-browser-site:hover .e1-browser-site-dismiss,.e1-browser-site:focus-within .e1-browser-site-dismiss{opacity:1}
.e1-browser-site-dismiss:hover{background:var(--cds-alpha-2)}
.e1-browser-note{font-size:13px;line-height:20px;color:var(--cds-text-secondary);margin:0}
.e1-browser-undo{border:0;background:transparent;padding:0 0 0 8px;color:var(--cds-text-primary);text-decoration:underline;cursor:pointer}
.e1-browser-error{color:var(--cds-text-danger);font-size:13px;margin:0}
@media(hover:none){.e1-browser-site-dismiss{opacity:1}}
`;
export function BrowserStart({onNavigate,onSetUp,detection,detectionActive,children}){
  const [actions,setActions]=useState(()=>window.e1NativeTabActions||{});
  const [sites,setSites]=useState(topSites),[dismissed,setDismissed]=useState(null),[error,setError]=useState('');
  const alive=useRef(true),busy=useRef(false);
  useEffect(()=>{
    alive.current=true;
    const updateActions=()=>setActions(window.e1NativeTabActions||{}),updateSites=()=>setSites(topSites());
    updateActions();updateSites();
    window.addEventListener('e1:tab-actions',updateActions);window.addEventListener(changed,updateSites);window.addEventListener('storage',updateSites);
    return()=>{alive.current=false;window.removeEventListener('e1:tab-actions',updateActions);window.removeEventListener(changed,updateSites);window.removeEventListener('storage',updateSites);};
  },[]);
  async function run(action){
    if(busy.current)return;busy.current=true;setError('');
    try{await action();}catch(failure){if(alive.current)setError(failure?.message||'Could not open this tab. Try again.');}finally{busy.current=false;}
  }
  function dismiss(url,value=true){saveSites(readSites().map(row=>row.url===url?{...row,dismissed:value}:row));setDismissed(value?url:null);}
  const available=tools.filter(([id])=>typeof actions[id]==='function');
  return h('div',{className:'e1-browser-start','data-e1-browser-start':'',children:[
    h('style',{children:css},'style'),
    h('div',{className:'e1-browser-start-inner',children:[
      h('section',{'aria-label':'Tools',children:[
        h('h3',{children:'Tools'},'heading'),
        available.length||onSetUp?h('div',{className:'e1-browser-tools',children:[
          ...available.map(([id,label,icon])=>h('button',{type:'button',className:'e1-browser-tool',onClick:()=>void run(()=>actions[id]()),children:[h(Icon,{name:icon,size:'md','aria-hidden':true},'icon'),h('span',{children:label},'label')]},id)),
          onSetUp&&h('button',{type:'button',className:'e1-browser-tool',onClick:()=>void run(onSetUp),children:[h(Icon,{name:'Code',size:'md','aria-hidden':true},'icon'),h('span',{children:'Detect dev server'},'label')]},'server'),
        ]},'tools'):h('p',{className:'e1-browser-note',children:'Enter a URL to open a page.'},'empty'),
      ]},'tools'),
      onNavigate&&sites.length>0&&h('section',{'aria-label':'Suggested',children:[
        h('h3',{children:'Suggested'},'heading'),
        h('div',{className:'e1-browser-sites',children:sites.map(site=>{
          const label=new URL(site.url).hostname.replace(/^www\./,'');
          return h('div',{className:'e1-browser-site',children:[
            h('button',{type:'button',className:'e1-browser-site-open',title:site.url,onClick:()=>void run(()=>onNavigate(site.url)),children:[h('span',{className:'e1-browser-site-icon',children:h(Icon,{name:'Globe',size:'xl','aria-hidden':true})},'icon'),h('span',{className:'e1-browser-site-label',children:label},'label')]},'open'),
            h('button',{type:'button',className:'e1-browser-site-dismiss','aria-label':`Dismiss ${label}`,onClick:()=>dismiss(site.url),children:h(Icon,{name:'X',size:'sm','aria-hidden':true})},'dismiss'),
          ]},site.url);
        })},'sites'),
      ]},'suggested'),
      dismissed&&h('p',{role:'status',className:'e1-browser-note',children:['Suggestion hidden.',h('button',{type:'button',className:'e1-browser-undo',onClick:()=>dismiss(dismissed,false),children:'Undo'},'undo')]},'undo'),
      // Keep the original detector mounted: it registers the setup action asynchronously.
      detection&&h('div',{hidden:!detectionActive,children:detection},'detection'),
      children&&h('section',{'aria-label':'Dev servers',children:[h('h3',{children:'Dev servers'},'heading'),children]},'servers'),
      error&&h('p',{role:'alert',className:'e1-browser-error',children:error},'error'),
    ]},'content'),
  ]});
}
