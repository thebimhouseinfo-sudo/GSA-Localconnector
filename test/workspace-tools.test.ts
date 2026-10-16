import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createReadOnlyTools} from "../src/mcp/server.js";
import {WorkspaceRegistry} from "../src/core/workspace.js";
test("Workspace metadata and search are bounded and reject traversal",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-search-"));
 try {
  const root=path.join(tmp,"root");await fs.mkdir(root);
  await fs.mkdir(path.join(root,"src"));
  await fs.writeFile(path.join(root,"src","a.ts"),"const needle = 1;\nconst other = 2;\n");
  await fs.writeFile(path.join(tmp,"secret.txt"),"needle outside");
  const registry=new WorkspaceRegistry();await registry.enrollTrusted("w",root,["read"]);
  const call=createReadOnlyTools(registry);
  const info=JSON.parse((await call({name:"get_file_info",arguments:{workspace_id:"w",path:"src/a.ts"}})).content[0].text);
  assert.equal(info.result.kind,"file");assert.match(info.result.sha256,/^[a-f0-9]{64}$/);
  const match=JSON.parse((await call({name:"search",arguments:{workspace_id:"w",path:".",query:"needle"}})).content[0].text);
  assert.equal(match.result.matches.length,1);
  assert.equal(match.result.matches[0].path,"src/a.ts");
  const ranged=JSON.parse((await call({name:"fetch_file",arguments:{workspace_id:"w",path:"src/a.ts",start_line:2,max_lines:1}})).content[0].text);
  assert.equal(ranged.result.text,"const other = 2;");
  assert.equal(ranged.result.start_line,2);
  const forbidden=await call({name:"get_file_info",arguments:{workspace_id:"w",path:"../secret.txt"}});
  assert.equal(forbidden.isError,true);
  const capability=JSON.parse((await call({name:"list_capabilities",arguments:{workspace_id:"w"}})).content[0].text);
  assert.equal(capability.ok,true);
  assert.equal(capability.result.shellIsolation,"blocked");
  const glob=JSON.parse((await call({name:"glob",arguments:{workspace_id:"w",path:"src",pattern:"*.ts"}})).content[0].text);
  assert.deepEqual(glob.result.entries.map((x:any)=>x.name),["a.ts"]);
  const blocked=await call({name:"run_command",arguments:{workspace_id:"w",command:"node",args:[]}});
  assert.equal(blocked.isError,true);
  assert.equal(JSON.parse(blocked.content[0].text).code,"SECURITY_BLOCKED");
  await fs.writeFile(path.join(root,"ci.json"),JSON.stringify({name:"check",jobs:[{id:"build",steps:[{id:"s",command:"node",args:["--version"]}]}]}));
  const validation=JSON.parse((await call({name:"ci_validate_workflow",arguments:{workspace_id:"w",workflow:"ci.json"}})).content[0].text);
  assert.deepEqual(validation.result.job_order,["build"]);
  assert.equal(validation.result.execution_allowed,false);
  const emptyWorkflows=JSON.parse((await call({name:"ci_list_workflows",arguments:{workspace_id:"w"}})).content[0].text);
  assert.deepEqual(emptyWorkflows.result.workflows,[]);
  await fs.mkdir(path.join(root,".gsa"));
  await fs.writeFile(path.join(root,".gsa","ci.json"),JSON.stringify({name:"build",jobs:[{id:"compile",steps:[{id:"check",command:"node"}]}]}));
  const workflows=JSON.parse((await call({name:"ci_list_workflows",arguments:{workspace_id:"w"}})).content[0].text);
  assert.equal(workflows.result.workflows[0].name,"build");
  assert.deepEqual(workflows.result.workflows[0].job_order,["compile"]);
  assert.equal(workflows.result.execution_allowed,false);
  await fs.writeFile(path.join(root,".gsa","ci.yaml"),[
    "name: yamlcheck","jobs:","  - id: verify","    steps:","      - id: node",
    "        command: node","        args: [\\"--version\\"]",""
  ].join("\\n"));
  const yaml=JSON.parse((await call({name:"ci_list_workflows",arguments:{workspace_id:"w"}})).content[0].text);
  assert.ok(yaml.result.workflows.some((x:any)=>x.path===".gsa/ci.yaml"&&x.name==="yamlcheck"));
  const invalid=await call({name:"search",arguments:{workspace_id:"w",path:".",query:""}});
  assert.equal(invalid.isError,true);
 } finally {await fs.rm(tmp,{recursive:true,force:true});}
});
