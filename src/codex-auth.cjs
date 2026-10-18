const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn}=require('node:child_process');
const {EventEmitter}=require('node:events');
const readline=require('node:readline');
const ALLOWED=new Set(['account/read','account/rateLimits/read','account/login/start','account/login/cancel','account/logout','getAuthStatus']);
function findBinary(){return ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',path.join(os.homedir(),'Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'),'/opt/homebrew/bin/codex','/usr/local/bin/codex'].find(file=>{try{fs.accessSync(file,fs.constants.X_OK);return true;}catch{return false;}});}
async function checkLoginPort(){await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',()=>reject(Error('Another Codex sign-in is active. Finish or cancel it, then try again.')));probe.listen(1455,'127.0.0.1',()=>probe.close(resolve));});}
class CodexAuth extends EventEmitter {
  constructor({binary,dir}){
    super();this.pending=new Map();this.serial=0;this.closed=false;
    const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,CODEX_HOME:dir};
    this.child=spawn(binary,['app-server','--listen','stdio://'],{cwd:dir,env,stdio:['pipe','pipe','pipe']});
    this.child.stderr.resume(); // OAuth URLs and credentials must never enter app logs.
    readline.createInterface({input:this.child.stdout}).on('line',line=>{
      let msg;try{msg=JSON.parse(line);}catch{return;}
      const p=this.pending.get(msg.id);
      if(p){clearTimeout(p.timer);this.pending.delete(msg.id);msg.error?p.reject(Error('Codex authentication request failed: '+msg.error.code)):p.resolve(msg.result);}
      else if(msg.method==='account/login/completed')this.emit('login',msg.params);
    });
    this.child.on('error',()=>this.fail());this.child.on('exit',()=>this.fail());
  }
  fail(){if(this.closed)return;this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Codex authentication helper stopped. Try signing in again.'));}this.pending.clear();this.emit('stopped');}
  async request(method,params){
    if(method!=='initialize'&&!ALLOWED.has(method))throw Error('Only authentication and account usage methods are permitted.');
    if(this.closed)throw Error('Codex authentication helper is not running.');
    if(method==='account/login/start'&&params.type==='chatgpt')await checkLoginPort();
    const id=++this.serial;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Codex authentication timed out. Try again.'));},30000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,method,params})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(Error('Could not contact Codex authentication.'));}});});
  }
  async initialize(){const value=await this.request('initialize',{clientInfo:{name:'e1_code',title:'E1 Code',version:'0.1.0'},capabilities:{experimentalApi:true}});this.child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');return value;}
  close(){this.child.kill('SIGTERM');this.fail();}
}
module.exports={CodexAuth,findBinary,checkLoginPort};
