#!/usr/bin/env node
// Explicit native end-to-end fixture: installed adapter -> HTTP MCP -> guest VM.
// All grants, controller state, projects, canaries and CI evidence are temporary.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {WorkspaceRegistry} from '../dist/src/core/workspace.js';
import {identityDirectory} from '../dist/src/local/identity.js';
import {revokeTrusted} from '../dist/src/local/grants.js';
import {bootstrapMcpTools} from '../dist/src/mcp/runtime-bootstrap.js';
import {createHttpMcpServer} from '../dist/src/mcp/http.js';

if(process.platform!=='darwin'||process.arch!=='arm64'||process.argv.slice(2).join(' ')!=='--run')throw Error('Usage: npm run build && node scripts/test-vm-runtime-native.mjs --run (Apple Silicon, installed native runtime required)');
const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-runtime-native-')));
const project=path.join(root,'project'),identity=path.join(root,'identity');
await fs.mkdir(project,{mode:0o700});await fs.mkdir(identity,{mode:0o700});await fs.mkdir(path.join(project,'.gsa'),{mode:0o700});
const canary=path.join(root,'outside-canary');await fs.writeFile(canary,'outside-'+randomBytes(16).toString('hex'),{mode:0o600});
const original=await fs.readFile(canary);
const source=`from pathlib import Path\nassert not Path('.env').exists()\ntry:\n Path(${JSON.stringify(canary)}).read_text()\n raise AssertionError('outside read allowed')\nexcept (PermissionError,FileNotFoundError): pass\nprint(42)\n`;
await fs.writeFile(path.join(project,'hello.py'),source);
await fs.writeFile(path.join(project,'.env'),'NATIVE_FIXTURE_SECRET=must-never-enter-guest\n',{mode:0o600});
const workflow={name:'native-mcp-build',jobs:[{id:'build',steps:[{id:'prepare',command:'/usr/bin/python3',args:['-I','-c',"from pathlib import Path; Path('generated').write_text('guest-only')"]},{id:'verify',command:'/usr/bin/python3',args:['-I','-c',"from pathlib import Path; assert Path('generated').read_text()=='guest-only'; exec(Path('hello.py').read_text())"]}]}]};
await fs.writeFile(path.join(project,'.gsa/ci.json'),JSON.stringify(workflow));
const registry=new WorkspaceRegistry();const grant=await registry.enrollTrusted('fixture',project,['read','execute']);
await fs.writeFile(path.join(identity,'trusted-workspaces.json'),JSON.stringify([{id:grant.id,root:grant.canonicalRoot,rootIdentity:grant.rootIdentity,permissions:grant.permissions,revision:grant.revision}]),{mode:0o600});
const tools=await bootstrapMcpTools(registry,identity,path.join(identityDirectory(),'native-vm'));
assert.equal(tools.nativeAvailable,true,tools.blockedReason);
const bearer=randomBytes(32).toString('hex');const server=createHttpMcpServer(bearer,registry,tools.invoke);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const endpoint=`http://127.0.0.1:${server.address().port}/mcp`;let sequence=0;let token;
async function call(name,args={}){
 const response=await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+bearer,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-03-26'},body:JSON.stringify({jsonrpc:'2.0',id:++sequence,method:'tools/call',params:{name,arguments:args}})});
 assert.equal(response.status,200);const envelope=await response.json();assert.ok(envelope.result,JSON.stringify(envelope.error));return JSON.parse(envelope.result.content[0].text);
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function control(name,args={}){
 for(let attempt=0;attempt<10;attempt++){
  const result=await call(name,{...args,control_token:token});
  if(result.code==='CONTROL_LEASE_LOCKED'){await sleep(50);continue;}
  assert.equal(result.ok,true,JSON.stringify(result));return result.result;
 }
 throw Error('Controller lease stayed locked');
}
async function finished(runId){
 const end=Date.now()+200000;
 while(Date.now()<end){const out=await call('ci_status',{workspace_id:'fixture',run_id:runId});assert.equal(out.ok,true,JSON.stringify(out));if(!['QUEUED','PREPARING','RUNNING'].includes(out.result.state))return out.result;await sleep(500);}
 throw Error('CI completion deadline exceeded');
}
async function waitProcess(id,state){
 const end=Date.now()+200000;
 while(Date.now()<end){const out=await call('process_status',{workspace_id:'fixture',process_id:id});assert.equal(out.ok,true,JSON.stringify(out));if(state(out.result.state))return out.result;await sleep(250);}
 throw Error('Process state deadline exceeded');
}
try{
 const status=await call('connector_status');assert.equal(status.result.readyForShell,true);assert.equal(status.result.hostFileWrites,false);assert.equal(status.result.git,'blocked');assert.equal(status.result.workspaceMode,'disposable-snapshot');
 const acquired=await call('acquire_control');assert.equal(acquired.ok,true);token=acquired.result.control_token;
 assert.equal((await call('run_command',{workspace_id:'fixture',command:'/usr/bin/python3',args:['hello.py']})).code,'SESSION_INVALID');
 assert.equal((await call('git_status',{workspace_id:'fixture',control_token:token})).code,'SECURITY_BLOCKED');
 console.log('NATIVE_RUNTIME_PHASE=HTTP_COMMAND');
 const command=await control('run_command',{workspace_id:'fixture',command:'/usr/bin/python3',args:['-I','hello.py']});
 assert.equal(command.state,'SUCCEEDED',JSON.stringify(command));assert.equal(command.receipt.stdout.trim(),'42');assert.equal(command.host_workspace_mutated,false);
 await control('renew_control');
 console.log('NATIVE_RUNTIME_PHASE=PINNED_CI');
 const captured=await control('ci_prepare_source',{workspace_id:'fixture'});
 await fs.writeFile(path.join(project,'hello.py'),'print(99)\n');
 const queued=await control('ci_run',{workspace_id:'fixture',workflow:'.gsa/ci.json',source_run_id:captured.source_run_id});
 const passed=await finished(queued.run_id);assert.equal(passed.state,'PASSED',JSON.stringify(passed));
 const logs=await call('ci_logs',{workspace_id:'fixture',run_id:queued.run_id});assert.equal(logs.ok,true);assert.ok(logs.result.entries.some(entry=>entry.text.includes('42')),JSON.stringify(logs));
 assert.equal(await fs.readFile(path.join(project,'hello.py'),'utf8'),'print(99)\n');await assert.rejects(fs.stat(path.join(project,'generated')),{code:'ENOENT'});
 const artifacts=await call('ci_artifacts',{workspace_id:'fixture',run_id:queued.run_id});assert.ok(artifacts.result.some(item=>item.name==='execution.json'));
 await control('renew_control');
 console.log('NATIVE_RUNTIME_PHASE=FAILED_RERUN');
 const failure={name:'pinned-failure',jobs:[{id:'fail',steps:[{id:'exit-seven',command:'/usr/bin/python3',args:['-I','-c','raise SystemExit(7)']}]}]};
 await fs.writeFile(path.join(project,'.gsa/ci.json'),JSON.stringify(failure));
 const failingSource=await control('ci_prepare_source',{workspace_id:'fixture'});
 const failingRun=await control('ci_run',{workspace_id:'fixture',workflow:'.gsa/ci.json',source_run_id:failingSource.source_run_id});
 const failed=await finished(failingRun.run_id);assert.equal(failed.state,'FAILED',JSON.stringify(failed));
 await control('renew_control');
 await fs.writeFile(path.join(project,'.gsa/ci.json'),JSON.stringify(workflow));
 const rerun=await control('ci_rerun_failed',{workspace_id:'fixture',run_id:failingRun.run_id});assert.notEqual(rerun.run_id,failingRun.run_id);
 const rerunResult=await finished(rerun.run_id);assert.equal(rerunResult.state,'FAILED',JSON.stringify(rerunResult));assert.equal(rerunResult.workflow,'pinned-failure');
 await control('renew_control');
 console.log('NATIVE_RUNTIME_PHASE=CONTROLLER_REVOCATION');
 const active=await control('start_process',{workspace_id:'fixture',command:'/usr/bin/python3',args:['-I','-c','import time; time.sleep(25)']});
 await waitProcess(active.process_id,state=>state==='RUNNING');await sleep(500);
 await control('release_control');
 const revoked=await waitProcess(active.process_id,state=>!['QUEUED','RUNNING'].includes(state));assert.equal(revoked.state,'UNKNOWN');
 const invalid=await call('run_command',{workspace_id:'fixture',command:'/usr/bin/python3',args:['-c','print(1)'],control_token:token});assert.equal(invalid.code,'SESSION_INVALID');
 console.log('NATIVE_RUNTIME_PHASE=PERSISTED_GRANT_REVOCATION');
 const renewed=await call('acquire_control');assert.equal(renewed.ok,true);token=renewed.result.control_token;
 const activeGrant=await control('start_process',{workspace_id:'fixture',command:'/usr/bin/python3',args:['-I','-c','import time; time.sleep(25)']});
 await waitProcess(activeGrant.process_id,state=>state==='RUNNING');await sleep(500);
 await revokeTrusted('fixture',identity);
 const grantRevoked=await waitProcess(activeGrant.process_id,state=>!['QUEUED','RUNNING'].includes(state));assert.equal(grantRevoked.state,'UNKNOWN');
 assert.deepEqual(await fs.readFile(canary),original);
 console.log(JSON.stringify({state:'NATIVE_RUNTIME_MCP_TESTS_PASSED',http_command:true,source_filtered:true,pinned_ci:true,failed_rerun_pinned:true,controller_revocation:true,persisted_grant_revocation:true,host_workspace_unchanged_by_guest:true}));
}finally{
 if(token){try{await call('release_control',{control_token:token});}catch{}}
 await new Promise(resolve=>server.close(resolve));
 await fs.rm(root,{recursive:true,force:true});
}
