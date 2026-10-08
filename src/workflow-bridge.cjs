const path = require('node:path');
const { WorkflowPreferences } = require('./workflow-preferences.cjs');
const { supportedEfforts } = require('./model-effort.cjs');
function installWorkflowBridge(app, dir, gateway, store) {
  const preferences = new WorkflowPreferences(dir), sessions = new WeakSet();
  const Speed=require('./speed-preferences.cjs'), speedPreferences=new Speed.SpeedPreferences(dir);
  app.on('web-contents-created', (_event, contents) => {
    if (!sessions.has(contents.session)) {
      contents.session.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'workflow-preload.cjs') });
      sessions.add(contents.session);
    }
    function allowed(event) {
      const frame = event.senderFrame;
      if (!frame || frame !== contents.mainFrame || !/^app:\/\/localhost\//.test(frame.url))
        throw Error('Workflow preferences are only available in the local workspace.');
    }
    const snapshot = () => ({ preferences: preferences.read(), models: gateway.catalog().map(r => ({
      id: r.id, name: r.display_name, model: r.model, aliases: r.aliases || [],
      efforts: supportedEfforts(r.model, r.meta),
    })) });
    contents.ipc.handle('e1:workflow:read', event => { allowed(event); return snapshot(); });
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
