const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');const {createAuthBrowser}=require('../src/auth-browser.cjs');
test('official browser handoff preserves literal URL, rejects foreign origins, and cleans up',async()=>{
 const urls=[];let release;const observed=new Promise(resolve=>release=resolve);
 const relay=createAuthBrowser(url=>{urls.push(url);release();});
 if(!relay)return;
 let timeout;
 try{
  execFileSync(relay.command,['https://unrelated.test/authorize']);
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(urls.length,0);
  const url='https://claude.com/cai/oauth/authorize?state=a%20b&literal=$(not-a-command)';
  execFileSync(relay.command,[url]);await Promise.race([observed,new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('No browser handoff')),2000))]);
  assert.deepEqual(urls,[url]);assert.equal(fs.statSync(path.dirname(relay.command)).mode&0o777,0o700);
 }finally{clearTimeout(timeout);relay.close();}
 assert.equal(fs.existsSync(relay.command),false);relay.close();
});
