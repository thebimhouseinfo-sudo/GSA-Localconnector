import assert from "node:assert/strict";
import {test} from "node:test";
import {createReadOnlyTools,toolDefinitions} from "../src/mcp/server.js";
import {WorkspaceRegistry} from "../src/core/workspace.js";

test("bootstrap tool catalog is read-only and direct",()=>{
 const names=toolDefinitions().map(t=>t.name);
 assert.deepEqual(names,["connector_status","list_workspaces","get_workspace"]);
 assert.equal(names.includes("run_command"),false);
 assert.equal(names.includes("ci_run"),false);
});
test("unauthorized Workspace is never exposed",async()=>{
 const invoke=createReadOnlyTools(new WorkspaceRegistry());
 const x=await invoke({name:"list_workspaces"});
 assert.deepEqual(JSON.parse(x.content[0].text).result,[]);
 const y=await invoke({name:"get_workspace",arguments:{workspace_id:"arbitrary"}});
 assert.equal(y.isError,true);
 assert.equal(JSON.parse(y.content[0].text).code,"WORKSPACE_NOT_FOUND");
 const z=await invoke({name:"connector_status"});
 assert.equal(JSON.parse(z.content[0].text).result.readyForShell,false);
});
