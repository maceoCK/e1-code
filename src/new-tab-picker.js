(() => {
 if(window.e1TabPicker)return;
 const types=[
  ['chat','Chat','Start a new chat','Chat'],
  ['browser','Browser','Open a browser tab','Globe'],
  ['terminal','Terminal','Open a terminal tab','CommandLinePrompt'],
  ['files','Files','Browse the current folder','Folder'],
  ['changes','Changes','Review changes in this chat','Code'],
  ['dot','Your dot','Choose a connected subscription','Circle'],
 ];
 let loading,active,opening=false;
 const style=document.createElement('style');
 style.textContent=`
 [data-e1-tab-picker] .e1-tab-list{display:flex;flex-direction:column;gap:4px}
 [data-e1-tab-picker] .e1-tab-choice{width:100%;height:auto;min-height:58px;justify-content:flex-start;padding:10px 12px;text-align:left;gap:12px}
 [data-e1-tab-picker] .e1-tab-copy{flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:2px}
 [data-e1-tab-picker] .e1-tab-detail{font-size:12px;font-weight:400;color:var(--cds-text-secondary)}
 [data-e1-new-tab-hint]{font-size:11px;color:var(--cds-text-secondary);margin-left:auto;padding-left:12px}
 `;
 document.head.append(style);
 function newButton(){return [...document.querySelectorAll('[aria-label="Sidebar"] button,[aria-label="Sidebar"] [role=button],[aria-label="Sidebar"] a,[aria-label="Sidebar"] [data-row-main-button]')].find(node=>node.getAttribute('aria-label')==='New'||node.textContent.replace('⌘T','').trim()==='New'||[...node.querySelectorAll('span')].some(label=>label.textContent.trim()==='New'));}
 function available(id){return id==='dot'?!!window.e1DotView:id==='chat'?!!(window.e1NativeTabActions?.chat||newButton()):typeof window.e1NativeTabActions?.[id]==='function';}
 function reason(id){return id==='changes'?'Open a chat to review its changes':id==='files'?'Select a folder in a chat first':'Select a local folder in a chat first';}
 async function open(){
  if(active||opening)return;
  opening=true;
  const trigger=document.activeElement;
  try{
   await window.e1NewTab?.overlay('new-tab',true);
   const [react,cds]=await (loading||=Promise.all([import('/assets/v1/vendor-frame-CnSY1sxv.js'),import('/assets/v1/shared-frame-Xx-llYK5.js')]).catch(error=>{loading=null;throw error;}));
   const {Wa:createRoot,Ha:h}=react,{qc:Dialog,wu:Button,_d:Provider}=cds;
   const host=document.createElement('div');host.dataset.e1TabHost='';
   const theme=document.querySelector('[aria-label="Primary pane"]')?.closest('.cds-root')||document.querySelector('.cds-root')||document.documentElement;
   document.body.append(host);
   const root=createRoot(host);let opened=true,disposed=false,error='',chosen=false;
   function dispose(){if(disposed)return;disposed=true;observer.disconnect();window.removeEventListener('e1:tab-actions',render);root.unmount();host.remove();void window.e1NewTab?.overlay('new-tab',false);if(active?.host===host)active=null;}
   function close(){opened=false;render();}
   async function select(id){
    if(!available(id))return;
    try{
     if(id==='dot'){await window.e1DotView.show();}
     else{
      const action=window.e1NativeTabActions?.[id];
      window.e1DotView?.close({focus:false});
      if(action)await action();
      else if(id==='chat')newButton()?.click();
     }
     chosen=true;close();
    }catch(failure){error=failure.message||String(failure);render();}
   }
   function render(){
    if(disposed)return;
    root.render(h(Provider,{mode:theme.getAttribute('data-mode')||document.documentElement.getAttribute('data-mode')||'system',density:theme.getAttribute('data-density')||undefined,children:h(Dialog.Root,{
     open:opened,onOpenChange:next=>{if(!next)close();},onOpenChangeComplete:next=>{if(!next)queueMicrotask(dispose);},
     children:h(Dialog.Popup,{size:'sm','data-e1-tab-picker':'',finalFocus:()=>chosen?false:trigger?.isConnected?trigger:false,children:[
      h(Dialog.Header,{description:'Choose what to open.',children:'New tab'},'heading'),
      h('div',{className:'e1-tab-list',children:types.map(([id,label,detail])=>h(Button,{
       variant:'ghost',className:'e1-tab-choice',disabled:!available(id),onClick:()=>void select(id),'data-tab-type':id,
       children:h('span',{className:'e1-tab-copy',children:[h('span',{children:label},'label'),h('span',{className:'e1-tab-detail',children:available(id)?detail:reason(id)},'detail')]})},id))},'list'),
      error&&h('p',{role:'alert',className:'text-danger',children:error},'error'),
     ]}),
    })}));
   }
   const observer=new MutationObserver(render);
   observer.observe(theme,{attributes:true,attributeFilter:['data-mode','data-theme','data-density']});
   if(theme!==document.documentElement)observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-mode','data-theme']});
   window.addEventListener('e1:tab-actions',render);
   active={host,close};render();
  }catch(error){void window.e1NewTab?.overlay('new-tab',false);console.error('E1 could not open the tab selector:',error.message);}
  finally{opening=false;}
 }
 window.e1TabPicker={open};
 window.e1NewTab?.onShow(()=>void open());
 // Capture before the recovered per-pane browser shortcut; also supports
 // renderer-only windows. The native menu covers focused child web contents.
 window.addEventListener('keydown',event=>{
  if((event.metaKey||event.ctrlKey)&&!event.altKey&&!event.shiftKey&&event.key.toLowerCase()==='t'){
   event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)void open();
  }
 },true);
 document.addEventListener('click',event=>{
  if(event.isTrusted&&newButton()?.contains(event.target)){
   event.preventDefault();event.stopImmediatePropagation();void open();
  }
 },true);
 function mount(){
  const button=newButton();if(!button||button.querySelector('[data-e1-new-tab-hint]'))return;
  button.setAttribute('aria-label','New');button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-keyshortcuts',navigator.platform.includes('Mac')?'Meta+T':'Control+T');
  const hint=document.createElement('span');hint.dataset.e1NewTabHint='';hint.setAttribute('aria-hidden','true');hint.textContent=navigator.platform.includes('Mac')?'⌘T':'Ctrl+T';button.append(hint);
 }
 let scheduled=false;
 new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;mount();});}).observe(document.body,{childList:true,subtree:true});mount();
})();
