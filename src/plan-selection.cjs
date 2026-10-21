const path=require('node:path');
const {readJson,atomicJson}=require('./library-identity.cjs');
const R=require('./routing.cjs');
const {findRoute}=require('./workflow-preferences.cjs');
const validChat=value=>typeof value==='string'&&/^(?:local_)?[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
function eligiblePlans(selected,routes,store){
 const family=R.modelFamily(store.provider(selected.provider));
 return routes.filter(r=>{const p=store.provider(r.provider);return r.model===selected.model&&R.modelFamily(p)===family&&R.billingFor(p)==='subscription'&&p.signedIn===true;});
}
function pinnedRoutes(provider,selected,routes,store,health,now=Date.now()){
 const route=eligiblePlans(selected,routes,store).find(r=>r.provider===(store.resolveProviderId?.(provider)||provider));
 if(!route)return[];
 return R.routeHealth(route,health,now)?[]:[route];
}
class PlanSelection{
 constructor(dir){this.file=path.join(dir,'plan-selection.json');}
 read(){return readJson(this.file,{version:1,chats:{},models:{}});}
 choice(chatId,model){
  const data=this.read(),ids=[model.id,...(model.aliases||[])];
  for(const bucket of [data.chats?.[chatId],data.models])for(const id of ids)if(bucket&&Object.hasOwn(bucket,id))return bucket[id];
  return'';
 }
 snapshot(input,models,routes,store){
  const model=findRoute(models,input?.modelId);if(!model)throw Error('Choose an available model.');
  if(input.chatId!=null&&!validChat(input.chatId))throw Error('Invalid chat.');
  const selected=this.choice(input.chatId,model);
  return{modelId:model.id,model:model.display_name,selected,choices:eligiblePlans(model,routes,store).map(r=>{const p=store.provider(r.provider);return{id:p.id,...R.billingDetails(p)};})};
 }
 save(input,models,routes,store){
  const current=this.snapshot(input,models,routes,store);
  if(typeof input.provider!=='string'||input.provider&&!current.choices.some(c=>c.id===input.provider))throw Error('This plan is no longer connected or does not offer this exact model.');
  const data=this.read();data.chats||={};data.models||={};const bucket=input.chatId?(data.chats[input.chatId]||={}):data.models;
  bucket[current.modelId]=input.provider;atomicJson(this.file,data);
  return this.snapshot(input,models,routes,store);
 }
}
module.exports={PlanSelection,eligiblePlans,pinnedRoutes};
