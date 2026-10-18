// Read the official CLI's structured /usage response. No prompt or inference.
const {spawn}=require('node:child_process');
const os=require('node:os');
const {cliEnvironment}=require('./claude-accounts.cjs');
function readClaudeUsage(executable,account,launch=spawn){return new Promise((resolve,reject)=>{
 const child=launch(executable,['-p','--safe-mode','--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--tools','','--permission-mode','dontAsk','--no-session-persistence','--input-format','stream-json','--output-format','stream-json','--verbose'],{cwd:os.tmpdir(),env:cliEnvironment(account.configDir,process.env,account.profileDir),stdio:['pipe','pipe','pipe']});
 let buffer='',size=0,settled=false;
 const timer=setTimeout(()=>finish(Error('Claude usage timed out.')),20000);
 function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);child.kill('SIGKILL');error?reject(error):resolve(value);}
 child.stderr.resume();child.stdin.on('error',()=>{});child.on('error',()=>finish(Error('Claude usage helper could not start.')));child.on('close',()=>finish(Error('Claude usage helper stopped.')));
 const send=(id,request)=>child.stdin.write(JSON.stringify({type:'control_request',request_id:id,request})+'\n');
 child.stdout.on('data',chunk=>{size+=chunk.length;if(size>2e6)return finish(Error('Claude usage response was too large.'));buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){let event;try{event=JSON.parse(buffer.slice(0,end));}catch{}buffer=buffer.slice(end+1);if(event?.type!=='control_response')continue;const r=event.response;if(r.request_id==='usage-init'){if(r.subtype==='error')return finish(Error('Claude usage initialization failed.'));send('usage-read',{subtype:'get_usage',skip_behaviors:true});}else if(r.request_id==='usage-read'){return r.subtype==='error'?finish(Error('Claude usage is unavailable.')):finish(null,r.response);}}});
 send('usage-init',{subtype:'initialize'});
});}
module.exports={readClaudeUsage};
