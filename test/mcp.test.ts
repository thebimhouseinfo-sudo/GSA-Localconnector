import {plannedTools} from "../src/mcp/catalog.js";
import assert from "node:assert/strict";
import {test} from "node:test";
import {createReadOnlyTools,toolDefinitions} from "../src/mcp/server.js";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("BUG-02: signed backend may be blocked while grant-scoped file reads work",async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-file-read-status-"));
  try{
    const work=path.join(tmp,"Ke-chinhta"),ref=path.join(tmp,"KE-dictation");
    await fs.mkdir(work);await fs.mkdir(ref);
    await fs.writeFile(path.join(ref,"README.md"),"reference\n");
    const registry=new WorkspaceRegistry();
    await registry.enrollRolesTrusted([{id:"work",root:work,role:"workspace"},{id:"ref",root:ref,role:"reference"}]);
    const invoke=createReadOnlyTools(registry,null,null,null,null,null,null,null,null,null,null,{fileBlockedReason:"Scoped file grant set changed"});
    const capabilities=JSON.parse((await invoke({name:"list_capabilities"})).content[0]!.text).result;
    assert.equal(capabilities.fileBackendAvailable,false);
    assert.equal(capabilities.fileReadAvailable,true);
    assert.equal(capabilities.fileWriteBackendAvailable,false);
    assert.equal(capabilities.fileGrantSyncRequired,true);
    assert.equal(capabilities.fileGrantSyncState,"REQUIRES_SIGNED_REINSTALL");
    assert.ok(capabilities.fileReadOperations.includes("fetch_file"));
    assert.deepEqual(capabilities.fileOperations,[]);
    assert.notEqual((await invoke({name:"list_directory",arguments:{workspace_id:"ref",path:"."}})).isError,true);
    assert.notEqual((await invoke({name:"fetch_file",arguments:{workspace_id:"ref",path:"README.md"}})).isError,true);
    assert.equal(registry.get("ref")!.permissions.includes("write"),false);
    assert.equal((await invoke({name:"fetch_file",arguments:{workspace_id:"ungranted",path:"README.md"}})).isError,true);
  }finally{await fs.rm(tmp,{recursive:true,force:true});}
});


test("full direct tool catalog is discoverable but unsafe operations are blocked",()=>{
 const names: string[]=toolDefinitions().map(t=>t.name);
 assert.deepEqual(names,["connector_status","list_workspaces","get_workspace","inspect_workspace_recovery","list_directory","bind_workspaces","unbind_workspace","get_file_info","search","fetch_file_bytes","fetch_file",...plannedTools.map(t=>t.name)]);
 assert.equal(names.includes("run_command"),true);
 assert.equal(names.includes("ci_run"),true);
});
test("unauthorized Workspace is never exposed",async()=>{
 const invoke=createReadOnlyTools(new WorkspaceRegistry());
 const x=await invoke({name:"list_workspaces"});
 assert.deepEqual(JSON.parse(x.content[0].text).result,[]);
 const y=await invoke({name:"get_workspace",arguments:{workspace_id:"arbitrary"}});
 assert.equal(y.isError,true);
 assert.equal(JSON.parse(y.content[0].text).code,"WORKSPACE_NOT_FOUND");
 const z=await invoke({name:"connector_status"});
 if(process.platform==="win32"||process.platform==="darwin") assert.equal(JSON.parse(z.content[0].text).result.readyForShell,false);
 else assert.equal(z.isError,true);
});

test("partial scoped-file backends report only supported mutations",async()=>{
 const registry=new WorkspaceRegistry();
 const partial:any={supportedOperations:["create_file","create_directory","copy_file"],read:async()=>{throw Error("unused");},createExclusive:async()=>{},replaceIfHash:async()=>{},makeDirectory:async()=>{},copyExclusive:async()=>{},moveExclusive:async()=>{},trashIfHash:async()=>{}};
 const invoke=createReadOnlyTools(registry,partial);
 const result=JSON.parse((await invoke({name:"list_capabilities"})).content[0].text).result;
 assert.equal(result.fileBackendAvailable,true);
 assert.deepEqual(result.fileOperations,["create_file","create_directory","copy_file"]);
 assert.equal(result.hostFileWrites,false);
 assert.equal(result.files.length===0||JSON.stringify(result.files)===JSON.stringify(["create_file","create_directory","copy_file","create_file_bytes"]),true);
 for(const name of ["update_file_bytes","update_file","edit_file","apply_patch","delete_file","move_file","batch_file_operations"])assert.ok(result.blocked.includes(name),`${name} must remain blocked`);
 assert.equal(result.shellIsolation,"blocked");assert.equal(result.git,"blocked");
});

test("legacy scoped-file backends keep base mutations and batch support while directory copy stays blocked",async()=>{
 const registry=new WorkspaceRegistry();
 const legacy:any={read:async()=>{throw Error("unused");},createExclusive:async()=>{},replaceIfHash:async()=>{},makeDirectory:async()=>{},copyExclusive:async()=>{},moveExclusive:async()=>{},trashIfHash:async()=>{}};
 const result=JSON.parse((await createReadOnlyTools(registry,legacy)({name:"list_capabilities"})).content[0].text).result;
 assert.equal(result.fileBackendAvailable,true);
 assert.equal(result.hostFileWrites,false);
 assert.deepEqual(result.fileOperations,["create_file","update_file","edit_file","apply_patch","create_directory","delete_file","copy_file","move_file"]);
 assert.equal(result.directoryCopyAvailable,false);
 assert.ok(result.directoryCopyBlockedReason);
 assert.ok(result.blocked.includes("copy_directory"));
 assert.ok(result.files.includes("batch_file_operations"));
});
