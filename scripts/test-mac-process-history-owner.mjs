#!/usr/bin/env node
// Synthetic process records; real isolated owner fencing and production bootstrap.
// No VM, recovery broker, arbitrary project command, live identity or credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {ProcessJournalStore} from '../dist/src/local/process-store.js';
import {ControlLeaseStore} from '../dist/src/local/control-lease.js';
import {enrollRolesTrustedBatch,loadTrustedRegistry} from '../dist/src/local/grants.js';
import {verifyMacOwner} from '../dist/src/local/mac-owner.js';
import {bootstrapMcpTools} from '../dist/src/mcp/runtime-bootstrap.js';

const execute=promisify(execFile),script=fileURLToPath(import.meta.url);
const launcher=fileURLToPath(new URL('./macos-owner-launcher.py',import.meta.url));
const env={PATH:'/usr/bin:/bin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp'};
const decode=result=>JSON.parse(result.content[0].text);
async function readMeta(root){
 assert.ok(root.startsWith('/private/tmp/gsa-process-history-owner-'));
 assert.equal(await fs.realpath(root),root);
 const stat=await fs.lstat(root);assert.ok(stat.isDirectory());assert.equal(stat.mode&0o777,0o700);
 return JSON.parse(await fs.readFile(path.join(root,'fixture.json'),'utf8'));
}
async function owned(root){
 const meta=await readMeta(root),identity=path.join(root,'identity');
 const owner=await verifyMacOwner(identity);
 const registry=await loadTrustedRegistry(identity);
 const tools=await bootstrapMcpTools(registry,identity,path.join(root,'missing-vm-installation'),owner);
 const call=async(name,arguments_={})=>decode(await tools.invoke({name,arguments:arguments_}));
 const capabilities=await call('list_capabilities');assert.equal(capabilities.ok,true);
 assert.equal(capabilities.result.restartRecovery,'ci-journal-reconciled; async-process-journal-reconciled; native-tree-recovery-not-certified');
 assert.equal(capabilities.result.processHistory,'persisted-start_process; synchronous-run_command-history-pending');
 assert.equal(tools.nativeAvailable,false);assert.equal(tools.fileNativeAvailable,false);
 assert.ok(!capabilities.result.execution.includes('start_process'));
 const list=await call('list_processes',{workspace_id:'work'});assert.equal(list.ok,true);
 assert.deepEqual(new Set(list.result.map(p=>p.process_id)),new Set([meta.terminal,meta.active]));
 const terminal=await call('process_status',{workspace_id:'work',process_id:meta.terminal});
 assert.equal(terminal.ok,true);assert.equal(terminal.result.state,'SUCCEEDED');
 const active=await call('process_status',{workspace_id:'work',process_id:meta.active});
 assert.equal(active.ok,true);assert.equal(active.result.state,'UNKNOWN');assert.equal(active.result.stopped,true);
 const output=await call('process_output',{workspace_id:'work',process_id:meta.active});
 assert.equal(output.ok,true);assert.equal(output.result.stdout,'partial π');assert.equal(output.result.complete,false);
 const stale=await call('stop_process',{workspace_id:'work',process_id:meta.active,control_token:meta.staleToken});
 assert.equal(stale.code,'SESSION_INVALID');
 const acquired=await call('acquire_control');assert.equal(acquired.ok,true);
 const denied=await call('start_process',{workspace_id:'work',command:'/bin/echo',args:[],control_token:acquired.result.control_token});
 assert.equal(denied.code,'SECURITY_BLOCKED');
 await call('release_control',{control_token:acquired.result.control_token});
 // A separate open-file description must not acquire the held kernel fence.
 await assert.rejects(execute('/usr/bin/python3',[launcher,'--identity',identity,'--node',process.execPath,'--entry',script],
  {env,timeout:5000,maxBuffer:8192}),error=>error.code===75&&error.stderr.includes('OWNER_BLOCKED'));
 const store=new ProcessJournalStore(path.join(identity,'process-runs'));
 const persisted=await store.load(meta.active);assert.equal(persisted.status.state,'UNKNOWN');
 assert.equal(persisted.output_complete,false);assert.equal(persisted.stopped,true);
 console.log(JSON.stringify({state:'OWNER_HISTORY_CHECK_PASS',nativeWorkloads:0,oldControlDenied:true,concurrentOwnerDenied:true}));
}
async function main(){
 if(process.platform!=='darwin')throw Error('MAC_ONLY');
 if(process.env.GSA_PROCESS_HISTORY_FIXTURE){
  if(process.env.GSA_OWNER_LOCK_FD!=='3')throw Error('REAL_OWNER_REQUIRED');
  return owned(process.env.GSA_PROCESS_HISTORY_FIXTURE);
 }
 if(process.argv.slice(2).join(' ')!=='--run')throw Error('Use --run for the isolated owner fixture');
 const root=await fs.realpath(await fs.mkdtemp('/private/tmp/gsa-process-history-owner-'));
 await fs.chmod(root,0o700);
 const identity=path.join(root,'identity'),workspace=path.join(root,'workspace');
 await fs.mkdir(identity,{mode:0o700});await fs.mkdir(workspace,{mode:0o700});
 await enrollRolesTrustedBatch([{id:'work',root:workspace,role:'workspace'}],identity);
 const store=new ProcessJournalStore(path.join(identity,'process-runs')),priorOwner=randomUUID();
 const terminal=randomUUID(),active=randomUUID();
 await store.create({format:'gsa-process-v1',process_id:terminal,workspace_id:'work',native_id:'synthetic-finished',owner_session:priorOwner,revision:1,
  status:{state:'SUCCEEDED',exit_code:0,started_at:'synthetic-start',ended_at:'synthetic-end'},stopped:true,stdout:'done π',stderr:'',output_complete:true});
 await store.create({format:'gsa-process-v1',process_id:active,workspace_id:'work',native_id:'synthetic-unknown',owner_session:priorOwner,revision:1,
  status:{state:'RUNNING',exit_code:null,started_at:'synthetic-start',ended_at:null},stopped:false,stdout:'partial π',stderr:'',output_complete:false});
 const terminalFile=path.join(identity,'process-runs',terminal+'.json');
 const sealed=await fs.readFile(terminalFile);
 const stale=await new ControlLeaseStore(identity).acquire();
 await fs.writeFile(path.join(root,'fixture.json'),JSON.stringify({terminal,active,staleToken:stale.control_token}),{mode:0o600,flag:'wx'});
 const results=[];
 try{
  for(let index=0;index<2;index++){
   const result=await execute('/usr/bin/python3',[launcher,'--identity',identity,'--node',process.execPath,'--entry',script],
    {env:{...env,GSA_PROCESS_HISTORY_FIXTURE:root},timeout:20000,maxBuffer:16384});
   results.push(JSON.parse(result.stdout.trim()));
   assert.deepEqual(await fs.readFile(terminalFile),sealed);
  }
  const report={state:'PASS_ISOLATED_OWNER_HISTORY',root,ownerStarts:2,syntheticRecords:true,vmLaunches:0,recoveryBrokerLaunches:0,results};
  await fs.writeFile(path.join(root,'result.json'),JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify(report));
 }catch(error){console.error('Preserved isolated fixture '+root);throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===script)main().catch(error=>{console.error(error.message);process.exitCode=1;});
