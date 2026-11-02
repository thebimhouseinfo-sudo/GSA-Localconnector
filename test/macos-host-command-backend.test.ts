import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {MacSameUserHostCommands} from "../src/hosts/macos-host-command-backend.js";
test("M3 same-user backend owns stable IDs and denies foreign workspace cancellation",{skip:process.platform!=="darwin"},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-m3-backend-"));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const work=path.join(root,"work");await fs.mkdir(work);
 const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:"work",root:work,role:"workspace"}]);
 const backend=new MacSameUserHostCommands(registry),process_id=randomUUID();
 assert.equal(backend.command_confinement,"none (user account)");
 assert.equal(await backend.cancel(process_id,"work"),false);
 assert.equal(await backend.cancel(process_id,"other"),false);
 const receipt=await backend.execute({
  process_id,workspace_id:"work",executable:process.execPath,argv:["-e",'process.stdout.write("OK")'],
  cwd_relative:".",time_limit_ms:5000,max_output_bytes:1024,network_allowed:true
 });
 assert.equal(receipt.exit_code,0);assert.equal(receipt.stdout,"OK");
 assert.equal(receipt.cancelled,false);assert.equal(receipt.output_limited,false);
 assert.equal(await backend.cancel(process_id,"work"),false);
});
test("M3 backend never silently promises network denial",{skip:process.platform!=="darwin"},async()=>{
 const backend=new MacSameUserHostCommands(new WorkspaceRegistry());
 await assert.rejects(backend.execute({
  process_id:randomUUID(),workspace_id:"missing",executable:process.execPath,argv:[],
  cwd_relative:".",time_limit_ms:1000,max_output_bytes:1024,network_allowed:false
 }),{code:"INVALID_PROCESS"});
});
