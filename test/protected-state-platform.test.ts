import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {protectedStateCapability} from "../src/local/protected-state.js";
import {loadTrustedRegistry,enrollReadOnly,enrollExecute} from "../src/local/grants.js";
import {ControlLeaseStore} from "../src/local/control-lease.js";
import {createReadOnlyTools} from "../src/mcp/server.js";

test("Windows protected storage is explicitly unavailable without verified ACL support",()=>{
 const capability=protectedStateCapability("win32");
 assert.equal(capability.available,false);assert.match(capability.reason!,/Windows ACL/);
});
test("Windows starts status-only and refuses unverified persisted grants and controllers",{skip:process.platform!=="win32"},async()=>{
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-windows-status-"));
 try{
  const root=path.join(temporary,"project");await fs.mkdir(root);
  const identity=path.join(temporary,"local","GSA-Localconnector");await fs.mkdir(identity,{recursive:true});
  await fs.writeFile(path.join(identity,"trusted-workspaces.json"),JSON.stringify([{id:"A",root,permissions:["read","execute"]}]));
  const registry=await loadTrustedRegistry(identity);assert.deepEqual(registry.list(),[]);
  const invoke=createReadOnlyTools(registry);
  const status=JSON.parse((await invoke({name:"connector_status"})).content[0].text);
  assert.equal(status.ok,true);assert.equal(status.result.readyForShell,false);
  assert.equal(status.result.protected_state_available,false);
  assert.equal(JSON.parse((await invoke({name:"list_workspaces"})).content[0].text).result.length,0);
  const child=spawnSync(process.execPath,[fileURLToPath(new URL("../src/mcp/cli.js",import.meta.url))],{
   env:{...process.env,HOME:temporary,USERPROFILE:temporary,LOCALAPPDATA:path.join(temporary,"local")},
   input:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"connector_status",arguments:{}}})+"\n",
   encoding:"utf8",timeout:10000,maxBuffer:65536
  });
  assert.equal(child.status,0,child.stderr);
  const wire=JSON.parse(child.stdout.trim());const childStatus=JSON.parse(wire.result.content[0].text);
  assert.equal(childStatus.ok,true);assert.equal(childStatus.result.protected_state_available,false);
  const absent=path.join(temporary,"new-identity");
  for(const operation of [()=>enrollReadOnly("A",root,absent),()=>enrollExecute("A",root,absent),()=>new ControlLeaseStore(absent).acquire()])
   await assert.rejects(operation(),(error:any)=>error.code==="SECURITY_BLOCKED");
  await assert.rejects(fs.lstat(absent),(error:any)=>error.code==="ENOENT");
 }finally{await fs.rm(temporary,{recursive:true,force:true});}
});
