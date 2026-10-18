const disposable=(value,dispose=()=>{})=>Object.assign(value,{[Symbol.dispose]:dispose});
export function createHost(api,sessionId){
 const active=new Set();
 const call=(op,args={})=>api(op,{sessionId,...args});
 const host={httpFetch:{
  fetch(requestId,request){
   active.add(requestId);
   const promise=call('native-fetch',{requestId,request}).then(meta=>{
    const body=meta.stream?new ReadableStream({
     async pull(controller){try{const chunk=await call('native-pull',{requestId});if(chunk.done){active.delete(requestId);controller.close();}else controller.enqueue(new Uint8Array(chunk.bytes));}catch(error){active.delete(requestId);controller.error(error);}},
     cancel(){active.delete(requestId);return call('native-cancel',{requestId});}
    }):null;
    return disposable({response:new Response(body,{status:meta.status,statusText:meta.statusText,headers:meta.headers})},()=>{void host.httpFetch.cancel(requestId).catch(()=>{});});
   }).catch(error=>{active.delete(requestId);throw error;});return disposable(promise,()=>{void host.httpFetch.cancel(requestId).catch(()=>{});});
  },
  async cancel(requestId){active.delete(requestId);await call('native-cancel',{requestId});}
 }};
 return {host,close:()=>{for(const requestId of active)void host.httpFetch.cancel(requestId).catch(()=>{});void call('native-close').catch(()=>{});}};
}
// The recovered renderer also has a small legacy host-message channel.
export function installLegacyBridge(){
 window.electronBridge={
  getAppVersion:()=> '0.1.0',getPlatform:()=> 'darwin',
  isDeviceCheckSupported:()=>false,
  async sendMessageFromView(message){
   const send=data=>window.dispatchEvent(new MessageEvent('message',{data}));
   if(message.type==='fetch'){
    let body;
    if(message.url==='vscode://codex/get-settings')body={values:{},configuredValues:{}};
    else if(message.url==='vscode://codex/get-global-state')body={value:null};
    else if(message.url==='vscode://codex/os-info')body={platform:'darwin',arch:'arm64'};
    else{send({type:'fetch-response',requestId:message.requestId,responseType:'error',error:'This host operation is not connected to E1 yet.'});return;}
    send({type:'fetch-response',requestId:message.requestId,responseType:'success',status:200,headers:{},body});
   }else if(message.type==='mcp-request'){
    send({type:'mcp-response',hostId:message.hostId,response:{id:message.request.id,error:{code:-32601,message:'This host operation is not connected to E1 yet.'}}});
   }
  }
 };
}
