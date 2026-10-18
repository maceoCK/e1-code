import {aa as h,Na as useEffect,Va as useRef,Ha as useState} from './vendor-frame-Bk3oL3Qp.js';
const pages={accounts:{title:'Accounts',panel:'accounts-panel'},models:{title:'Models & connections',panel:'models-panel'},usage:{title:'Usage & fallback',panel:'usage-panel'}};
function SettingsPage({page}) {
 const host=useRef(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  const node=host.current;let disposed=false,cleanup;
  (async()=>{
   const assets=await window.e1Settings.request('assets');if(disposed)return;
   const parsed=new DOMParser().parseFromString(assets.html,'text/html');
   parsed.querySelectorAll('script,.settings-heading,img').forEach(n=>n.remove());
   const style=document.createElement('style');
   style.textContent='[data-e1-settings-body]{'+assets.css+'}\n[data-e1-settings-page]{display:block!important;height:auto!important;min-height:0!important;padding-bottom:16px}\n[data-e1-settings-page]>.settings-tabs{display:none!important}\n[data-e1-settings-page] #settings{overflow:visible;padding:0}\n[data-e1-settings-page]>.e1-page-heading{font-size:20px;font-weight:600;margin:8px 0 24px}';
   const title=document.createElement('h2');title.className='e1-page-heading';title.textContent=pages[page].title;
   node.replaceChildren(style,title,...Array.from(parsed.body.childNodes));
   const linkHandler=event=>{const link=event.target.closest('a[href]');if(link){event.preventDefault();void window.e1Settings.request('external',{url:link.href}).catch(e=>setError(e.message));}};
   node.addEventListener('click',linkHandler);
   const unmount=window.e1MountSettings(node,(route,data)=>window.e1Settings.request('api',{route,data}));
   node.querySelector('[data-panel="'+pages[page].panel+'"]').click();
   for(const section of node.querySelectorAll('[role=tabpanel]')){section.removeAttribute('aria-labelledby');section.setAttribute('role','region');section.setAttribute('aria-label',pages[page].title);}
   cleanup=()=>{node.removeEventListener('click',linkHandler);unmount();};
  })().catch(e=>{if(!disposed)setError(e.message||'Could not load settings.');});
  return()=>{disposed=true;cleanup?.();node.replaceChildren();};
 },[page,attempt]);
 return h('section',{'aria-label':pages[page].title,children:[error&&h('div',{role:'alert',children:[error,h('button',{onClick:()=>{setError('');setAttempt(n=>n+1);},children:'Try again'})]}),h('div',{ref:host,'data-e1-settings-body':'','data-e1-settings-page':page})]});
}
export function Accounts(){return h(SettingsPage,{page:'accounts'});}
export function Models(){return h(SettingsPage,{page:'models'});}
export function Usage(){return h(SettingsPage,{page:'usage'});}
