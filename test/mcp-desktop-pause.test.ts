import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";

const run=promisify(execFile);
test("desktop Pause blocks new MCP effects but permits diagnostics and Recovery readback",async()=>{
 if(process.platform!=="darwin")return; // macOS source acceptance exercises this path
 const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"gsa-mcp-pause-home-")));
 const dir=path.join(home,"Library/Application Support/GSA-Localconnector/desktop");
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 await fs.chmod(home,0o700);
 const file=path.join(dir,"pause-state.json");
 await fs.writeFile(file,JSON.stringify({format:"gsa-desktop-pause-v1",paused:true}),{mode:0o600});
 try{
  const script=`
   import path from "node:path";import {pathToFileURL} from "node:url";
   const {WorkspaceRegistry}=await import(pathToFileURL(path.resolve("dist/src/core/workspace.js")));
   const {createReadOnlyTools}=await import(pathToFileURL(path.resolve("dist/src/mcp/server.js")));
   const invoke=createReadOnlyTools(new WorkspaceRegistry());
   const parse=async(name,args={})=>JSON.parse((await invoke({name,arguments:args})).content[0].text);
   process.stdout.write(JSON.stringify({status:await parse("connector_status"),listed:await parse("list_workspaces"),blocked:await parse("bind_workspaces",{roots:[{path:"/private/tmp",role:"workspace"}]})}));
  `;
  const result=await run(process.execPath,["--input-type=module","-e",script],{cwd:process.cwd(),env:{...process.env,HOME:home},encoding:"utf8"});
  const observed=JSON.parse(result.stdout);
  assert.equal(observed.status.result.desktopPaused,true);
  assert.deepEqual(observed.listed.result,[]);
  assert.equal(observed.blocked.code,"SECURITY_BLOCKED");
  assert.match(observed.blocked.message??"",/CONNECTOR_PAUSED/);
 }finally{await fs.rm(home,{recursive:true,force:true});}
});
