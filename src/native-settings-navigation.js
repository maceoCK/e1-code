(() => {
 if(!window.e1Settings||window.e1SettingsNavigation)return;
 const sections={accounts:'e1-accounts',models:'e1-models',usage:'e1-usage'};
 let storePromise;
 // Native Settings dialog store (zustand): Claude 3.1623.0 exports it from shared-156 as `bg`.
 function settingsStore(){return storePromise ||= import('/assets/v1/shared-156-DPjCa3x4.js').then(module=>{
  const store=module.bg;
  if(typeof store?.getState?.().open!=='function')throw Error('Native Settings store not found.');
  const sync=state=>void window.e1NewTab?.overlay('settings',state.section!==null);
  store.subscribe(sync);sync(store.getState());return store;
 }).catch(error=>{storePromise=null;throw error;});}
 async function open(page='models'){
  const section=sections[page]||sections.models;
  const store=await settingsStore();store.getState().open(section);
 }
 window.e1SettingsNavigation={open};
 // Keep old callers working while routing them into the one native Settings UI.
 window.e1SettingsModal={open};
 window.e1Settings.onShow(page=>void open(page).catch(error=>console.error('Could not open E1 settings:',error.message)));
 void settingsStore().catch(()=>{});
})();
