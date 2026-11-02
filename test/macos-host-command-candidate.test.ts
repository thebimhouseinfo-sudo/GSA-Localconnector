import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {runMacHostCommandCandidate} from "../src/hosts/macos-host-command-candidate.js";
test("M3 unregistered host candidate runs bounded user command with truthful disclosure",{skip:process.platform!=="darwin"},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-m3-exec-"));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const work=path.join(root,"work");await fs.mkdir(work);
 const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:"work",root:work,role:"workspace"}]);
 const result=await runMacHostCommandCandidate(registry,{workspace_id:"work",executable:process.execPath,argv:["-e",'process.stdout.write("hello");process.stderr.write("bye")'],cwd_relative:".",time_limit_ms:5000,max_output_bytes:1024});
 assert.equal(result.state,"SUCCEEDED");
 assert.equal(result.stdout,"hello");assert.equal(result.stderr,"bye");
 assert.equal(result.process_group_stop_verified,true);
 assert.equal(result.command_confinement,"none (user account)");
 assert.equal(result.state_integrity_vs_commands,"not_protected");
});
test("M3 candidate bounds shared stdout stderr and reports uncertain results",{skip:process.platform!=="darwin"},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-m3-output-"));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:"work",root,role:"workspace"}]);
 const result=await runMacHostCommandCandidate(registry,{workspace_id:"work",executable:process.execPath,argv:["-e",'process.stdout.write("A".repeat(10000));process.stderr.write("B".repeat(10000))'],cwd_relative:".",time_limit_ms:5000,max_output_bytes:1024});
 assert.equal(Buffer.byteLength(result.stdout)+Buffer.byteLength(result.stderr),1024);
 assert.equal(result.stdout_truncated||result.stderr_truncated,true);
 assert.equal(result.state,"UNKNOWN");
});
