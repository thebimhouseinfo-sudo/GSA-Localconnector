import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {test} from "node:test";
import assert from "node:assert/strict";
import {validateMacHostCommandRequest,resolveMacHostCommandCwd,MAC_HOST_COMMAND_DISCLOSURE} from "../src/hosts/macos-host-command-request.js";
const base={workspace_id:"work",executable:"/usr/bin/git",argv:["status","--short"],cwd_relative:".",time_limit_ms:10000,max_output_bytes:65536};
test("M3 same-user host request accepts nested workspace cwd and reports no confinement",()=>{
 for(const cwd_relative of [".","src","project/subdir"])assert.doesNotThrow(()=>validateMacHostCommandRequest({...base,cwd_relative}));
 assert.deepEqual(MAC_HOST_COMMAND_DISCLOSURE,{command_confinement:"none (user account)",state_integrity_vs_commands:"not_protected"});
});
test("M3 host request rejects path traversal, cross-root, malformed and unbounded requests",()=>{
 for(const cwd_relative of ["","..","../src","src/../other","/tmp","C:/Windows","src//nested","src/./nested","src\\nested"])assert.throws(()=>validateMacHostCommandRequest({...base,cwd_relative}),{code:"INVALID_PROCESS"});
 for(const patch of [{executable:""},{argv:["a\0b"]},{time_limit_ms:0},{time_limit_ms:120001},{max_output_bytes:0},{max_output_bytes:2097153},{workspace_id:"  "}])assert.throws(()=>validateMacHostCommandRequest({...base,...patch}),{code:"INVALID_PROCESS"});
});

test("M3 command cwd follows workspace execute role and canonical read boundary",async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-m3-cwd-"));
 t.after(()=>fs.rm(temp,{recursive:true,force:true}));
 const work=path.join(temp,"work"),ref=path.join(temp,"reference"),outside=path.join(temp,"outside");
 for(const p of [work,ref,outside])await fs.mkdir(p);
 await fs.mkdir(path.join(work,"sub"));
 await fs.writeFile(path.join(work,"notdir"),"x");
 await fs.symlink(outside,path.join(work,"escape"));
 const registry=new WorkspaceRegistry();
 await registry.enrollRolesTrusted([{id:"work",root:work,role:"workspace"},{id:"ref",root:ref,role:"reference"}]);
 assert.equal(await resolveMacHostCommandCwd(registry,{...base,cwd_relative:"sub"}),path.join(work,"sub"));
 await assert.rejects(resolveMacHostCommandCwd(registry,{...base,workspace_id:"ref"}),{code:"PERMISSION_DENIED"});
 await assert.rejects(resolveMacHostCommandCwd(registry,{...base,cwd_relative:"escape"}),{code:"PATH_OUTSIDE_SCOPE"});
 await assert.rejects(resolveMacHostCommandCwd(registry,{...base,cwd_relative:"notdir"}),{code:"INVALID_PROCESS"});
});
