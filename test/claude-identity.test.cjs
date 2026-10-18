const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {consoleIdentity}=require('../src/claude-identity.cjs');
const {ClaudeAccounts}=require('../src/claude-accounts.cjs');
test('Console identity follows the active profile and exposes metadata only',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'e1-console-identity-'));
 const profileDir=path.join(dir,'anthropic');
 const write=(file,value)=>{const dest=path.join(profileDir,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,typeof value==='string'?value:JSON.stringify(value));};
 const config={organization_id:'work',workspace_id:'team',authentication:{type:'user_oauth'}};
 const credentials={organization_uuid:'work',workspace_id:'team',account_email:'person@work.test',organization_name:'Work',workspace_name:'Team',access_token:'NEVER_EXPOSE',refresh_token:'NEVER_EXPOSE'};
 try{
  write('active_config','work');write('configs/work.json',config);write('credentials/work.json',credentials);
  write('configs/default.json',{...config,organization_id:'other'});write('credentials/default.json',{...credentials,organization_uuid:'other',account_email:'other@example.test'});
  assert.deepEqual(consoleIdentity(profileDir),{email:'person@work.test',orgId:'work',orgName:'Work',workspaceId:'team',workspaceName:'Team'});
  let loggedIn=true;
  const accounts=new ClaudeAccounts(dir,{executable:'/fixture',run:async()=>({data:{loggedIn,authMethod:'oauth_token'}})});
  accounts.data.accounts.push({id:'work',method:'console',profileDir,configDir:dir});
  await accounts.refresh('work');assert.equal(accounts.snapshot().accounts[0].email,'person@work.test');assert.equal(accounts.snapshot().accounts[0].orgName,'Work');
  assert.equal(fs.readFileSync(accounts.file,'utf8').includes('NEVER_EXPOSE'),false);
  loggedIn=false;await accounts.refresh('work');assert.equal(accounts.snapshot().accounts[0].email,null);assert.equal(accounts.snapshot().accounts[0].workspaceId,null);
  write('credentials/work.json',{...credentials,organization_uuid:'wrong'});assert.equal(consoleIdentity(profileDir),null);
  write('credentials/work.json',{...credentials,workspace_id:'wrong'});assert.equal(consoleIdentity(profileDir),null);
  write('active_config','../default');assert.equal(consoleIdentity(profileDir),null);
  write('active_config','missing');assert.equal(consoleIdentity(profileDir),null);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
