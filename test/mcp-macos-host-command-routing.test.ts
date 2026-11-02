import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {ProcessJournalStore} from "../src/local/process-store.js";
import {createReadOnlyTools} from "../src/mcp/server.js";
import type {ApprovedMacHostCommandBackend,SandboxedProcessRequest} from "../src/core/native-io.js";

test("M3 injected host commands are explicitly unconfined and persist UNKNOWN without full-tree proof",{skip:process.platform!=="darwin"},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-m3-mcp-"));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const work=path.join(root,"work");await fs.mkdir(work);await fs.mkdir(path.join(work,"nested"));
 const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:"work",root:work,role:"workspace"}]);
 const calls:SandboxedProcessRequest[]=[];
 const host:ApprovedMacHostCommandBackend={
  platform:"macos",execution_mode:"same-user-unconfined",
  command_confinement:"none (user account)",state_integrity_vs_commands:"not_protected",
  execute:async request=>{calls.push(request);return {
   exit_code:0,signal:null,stdout:"OK",stderr:"",cancelled:false,timed_out:false,
   process_group_stop_verified:true,process_tree_stop_verified:false
  };},
  cancel:async()=>false
 };
 const store=new ProcessJournalStore(path.join(root,"journal")),ownerSession=randomUUID();
 const invoke=createReadOnlyTools(registry,null,null,null,null,null,null,null,null,null,null,{
  processPersistence:{store,ownerSession},hostCommands:host
 });
 const call=async(name:string,args:Record<string,unknown>={})=>JSON.parse((await invoke({name,arguments:args})).content[0].text);
 const capability=await call("list_capabilities");
 assert.equal(capability.ok,true);assert.ok(capability.result.execution.includes("run_command"));
 assert.equal(capability.result.command_confinement,"none (user account)");
 assert.equal(capability.result.state_integrity_vs_commands,"not_protected");
 const result=await call("run_command",{workspace_id:"work",command:"/bin/echo",args:["hello"],cwd_relative:"nested",time_limit_ms:2000,max_output_bytes:512});
 assert.equal(result.ok,true);
 assert.equal(result.result.state,"UNKNOWN");
 assert.equal(calls.length,1);
 assert.equal(calls[0].cwd_relative,"nested");
 assert.equal(calls[0].network_allowed,true);
 assert.equal(calls[0].max_output_bytes,512);
 assert.equal((await store.list()).length,1);
});
