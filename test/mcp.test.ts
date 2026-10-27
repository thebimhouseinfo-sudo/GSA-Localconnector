import {plannedTools} from "../src/mcp/catalog.js";
import assert from "node:assert/strict";
import {test} from "node:test";
import {createReadOnlyTools,toolDefinitions} from "../src/mcp/server.js";
import {WorkspaceRegistry} from "../src/core/workspace.js";

test("full direct tool catalog is discoverable but unsafe operations are blocked",()=>{
 const names: string[]=toolDefinitions().map(t=>t.name);
 assert.deepEqual(names,["connector_status","list_workspaces","get_workspace","list_directory","bind_workspaces","unbind_workspace","get_file_info","search","fetch_file",...plannedTools.map(t=>t.name)]);
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
 assert.equal(result.files.length===0||JSON.stringify(result.files)===JSON.stringify(["create_file","create_directory","copy_file"]),true);
 for(const name of ["update_file","edit_file","apply_patch","delete_file","move_file","batch_file_operations"])assert.ok(result.blocked.includes(name),`${name} must remain blocked`);
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
