// Bridge the official CLI's BROWSER launch back to E1. The URL stays private and
// temporary; it is never placed in account metadata, renderer state, or logs.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const quote=value=>"'"+value.replace(/'/g,"'\\''")+"'";
function createAuthBrowser(onUrl){
 if(process.platform==='win32')return null;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'e1-auth-browser-'));fs.chmodSync(dir,0o700);
 const file=path.join(dir,'url'),command=path.join(dir,'open');fs.writeFileSync(file,'',{mode:0o600});
 fs.writeFileSync(command,'#!/bin/sh\nfor arg in "$@"; do\n  case "$arg" in https://*) printf \'%s\' "$arg" > '+quote(file)+'; exit 0;; esac\ndone\nexit 1\n',{mode:0o700});
 let last='',closed=false;
 const poll=setInterval(()=>{if(closed)return;let value;try{value=fs.readFileSync(file,'utf8').trim();}catch{return;}
  if(!value||value===last)return;
  try{const url=new URL(value);if(url.protocol!=='https:'||!['claude.ai','claude.com','platform.claude.com','console.anthropic.com'].includes(url.hostname)||url.username||url.password)return;}catch{return;}
  last=value;try{Promise.resolve(onUrl(value)).catch(()=>{});}catch{}
 },100);poll.unref();
 return{command,close(){if(closed)return;closed=true;clearInterval(poll);fs.rmSync(dir,{recursive:true,force:true});}};
}
module.exports={createAuthBrowser};
