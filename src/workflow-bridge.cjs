const path = require('node:path');
const { WorkflowPreferences } = require('./workflow-preferences.cjs');
const { supportedEfforts } = require('./model-effort.cjs');
function installWorkflowBridge(app, dir, gateway, store) {
  const preferences = new WorkflowPreferences(dir), sessions = new WeakSet();
  const browser = new (require('./model-browser-preferences.cjs').ModelBrowserPreferences)(store.dir);
  const contentsSet = new Set();
  const browserModels = (routes = gateway.catalog()) => routes.map(r => {
    const p=store.provider(r.provider);
    return {id:r.id,name:r.display_name,model:r.model,providerName:r.family==='claude-code'?'Claude':p.name,
      providerKind:p.protocol,connection:r.family==='claude-code'?'':p.name,meta:{legacy:r.meta?.legacy,deprecated:r.meta?.deprecated}};
  });
  const browserSnapshot = () => ({preferences:browser.read(),models:browserModels()});
  const changed = () => { for(const contents of contentsSet) if(!contents.isDestroyed()) contents.send('e1:models:changed'); };
  require('node:fs').watchFile(browser.file,{interval:500,persistent:false},changed);
  app.once('will-quit',()=>require('node:fs').unwatchFile(browser.file,changed));
  const Speed=require('./speed-preferences.cjs'), speedPreferences=new Speed.SpeedPreferences(dir);
  app.on('web-contents-created', (_event, contents) => {
    contentsSet.add(contents);contents.once('destroyed',()=>contentsSet.delete(contents));
    if (!sessions.has(contents.session)) {
      contents.session.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'workflow-preload.cjs') });
      sessions.add(contents.session);
    }
    function allowed(event) {
      const frame = event.senderFrame;
      if (!frame || frame !== contents.mainFrame || !/^app:\/\/localhost\//.test(frame.url))
        throw Error('Workflow preferences are only available in the local workspace.');
    }
    const snapshot = () => {
      const routes=gateway.catalog(), metadata=new Map(browserModels(routes).map(m=>[m.id,m]));
      return { preferences: preferences.read(), modelBrowser:browser.read(), models: routes.map(r => ({
      ...metadata.get(r.id),
      id: r.id, name: r.display_name, model: r.model, aliases: r.aliases || [],
      efforts: supportedEfforts(r.model, r.meta),
    })) }; };
    contents.ipc.handle('e1:workflow:read', event => { allowed(event); return snapshot(); });
    contents.ipc.handle('e1:models:read',event=>{allowed(event);return browserSnapshot();});
    contents.ipc.handle('e1:models:save',(event,value)=>{allowed(event);browser.save(value);changed();return browserSnapshot();});
    contents.ipc.handle('e1:workflow:save', (event, value) => {
      allowed(event); preferences.save(value, gateway.catalog()); return snapshot();
    });
    const speedSnapshot=()=>({preferences:speedPreferences.read(),models:gateway.catalog().map(r=>({
      id:r.id,name:r.display_name,model:r.model,aliases:r.aliases||[],modes:Speed.modesFor(r.model),
      connections:Speed.apiRoutes(r,gateway.routes(),store).map(api=>({id:api.provider,name:store.provider(api.provider).name})),
    }))});
    contents.ipc.handle('e1:speed:read',event=>{allowed(event);return speedSnapshot();});
    contents.ipc.handle('e1:speed:save',(event,value)=>{
      allowed(event);speedPreferences.save(value,gateway.catalog(),gateway.routes(),store);return speedSnapshot();
    });
  });
}
module.exports = { installWorkflowBridge };
