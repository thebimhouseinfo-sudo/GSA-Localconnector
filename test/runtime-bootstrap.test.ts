import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {AddressInfo} from "node:net";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {bootstrapMcpTools,authorizeMcpWorkspace} from "../src/mcp/runtime-bootstrap.js";
import {createHttpMcpServer} from "../src/mcp/http.js";
import {ControlLeaseStore} from "../src/local/control-lease.js";
import {withControlToken} from "../src/mcp/control-context.js";
import {identityDirectory} from "../src/local/identity.js";
import {enrollRolesTrustedBatch} from "../src/local/grants.js";

test("production bootstrap keeps controller enforcement when native installation is absent",{skip:process.platform==="win32"?"POSIX controller store; Windows ACL backend unverified":false},async()=>{
 const identity=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"gsa-bootstrap-")));
 try{
  const {invoke,nativeAvailable,fileNativeAvailable,fileBlockedReason}=await bootstrapMcpTools(new WorkspaceRegistry(),identity);
  assert.equal(nativeAvailable,false);
  assert.equal(fileNativeAvailable,false);
  assert.match(fileBlockedReason??"",/owner|installation/i);
  const call=async(name:string,args:Record<string,unknown>={})=>JSON.parse((await invoke({name,arguments:args})).content[0].text);
  const status=await call("connector_status");
  if(process.platform==="darwin"){
   assert.equal(status.ok,true);assert.equal(status.result.readyForShell,false);
  }else{
   assert.equal(status.ok,false);assert.equal(status.code,"UNSUPPORTED_PLATFORM");
  }
  const control=await call("acquire_control");assert.equal(control.ok,true);
  const capabilities=await call("list_capabilities");
  assert.equal(capabilities.result.fileBackendAvailable,false);
  assert.deepEqual(capabilities.result.fileOperations,[]);
  assert.equal(capabilities.result.hostFileWrites,false);
  assert.equal(capabilities.result.shellIsolation,"blocked");
  assert.equal(capabilities.result.git,"blocked");
  const denied=await call("run_command",{workspace_id:"fixture",command:"/bin/echo",args:[]});assert.equal(denied.code,"SESSION_INVALID");
  const blocked=await call("git_status",{workspace_id:"fixture",control_token:control.result.control_token});assert.equal(blocked.code,"SECURITY_BLOCKED");
  await call("release_control",{control_token:control.result.control_token});
 }finally{await fs.rm(identity,{recursive:true,force:true});}
});
test("bootstrap routes workspace role binding through its selected identity directory",{skip:process.platform==="win32"?"POSIX protected store; Windows ACL backend unverified":false},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-bootstrap-roles-")),home=path.join(root,"home"),identity=path.join(root,"selected-identity"),project=path.join(root,"project");
 await fs.mkdir(home,{mode:0o700});await fs.mkdir(project,{mode:0o700});
 const original=os.homedir;os.homedir=()=>home;
 try{
  const registry=new WorkspaceRegistry(),{invoke,nativeAvailable}=await bootstrapMcpTools(registry,identity,path.join(root,"missing-installation"));
  assert.equal(nativeAvailable,false);
  const call=async(name:string,args:Record<string,unknown>={})=>JSON.parse((await invoke({name,arguments:args})).content[0].text);
  const lease=await call("acquire_control");assert.equal(lease.ok,true);
  const bound=await call("bind_workspaces",{roots:[{path:project,role:"workspace"}],control_token:lease.result.control_token});
  assert.equal(bound.ok,true);
  assert.ok(await fs.stat(path.join(identity,"trusted-workspaces.json")));
  assert.equal(await fs.stat(path.join(identityDirectory("darwin",home),"trusted-workspaces.json")).then(()=>true,()=>false),false);
  assert.equal(registry.list()[0]!.role,"workspace");
  await call("release_control",{control_token:lease.result.control_token});
 }finally{os.homedir=original;await fs.rm(root,{recursive:true,force:true});}
});
test("confirmed explicit workspace binding clears the stale startup selection warning",{skip:process.platform==="win32"?"POSIX protected store; Windows ACL backend unverified":false},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-bootstrap-reselect-")),identity=path.join(root,"identity"),project=path.join(root,"project");
 await fs.mkdir(project,{mode:0o700});
 try{
  const registry=new WorkspaceRegistry(),{invoke}=await bootstrapMcpTools(registry,identity,path.join(root,"missing-installation"),undefined,"WORKSPACE_ROOT_CHANGED");
  const call=async(name:string,args:Record<string,unknown>={})=>JSON.parse((await invoke({name,arguments:args})).content[0].text);
  const lease=await call("acquire_control");assert.equal(lease.ok,true);
  const before=await call("list_capabilities");assert.equal(before.result.workspaceSelectionRequired,true);
  const invalid=await call("bind_workspaces",{roots:[{path:path.join(root,"missing"),role:"workspace"}],control_token:lease.result.control_token});assert.equal(invalid.ok,false);
  assert.equal((await call("list_capabilities")).result.workspaceSelectionRequired,true,"failed binding must retain the startup warning");
  const bound=await call("bind_workspaces",{roots:[{path:project,role:"workspace"}],control_token:lease.result.control_token});assert.equal(bound.ok,true);
  assert.equal((await call("list_capabilities")).result.fileBackendAvailable,false,"successful durable selection remains successful when verified installation is unavailable");
  const after=await call("list_capabilities");
  assert.notEqual(after.result.workspaceSelectionRequired,true,"successful durable re-selection must clear historical root-change warning");
  assert.ok(after.result.workspaceStartupIssue===null||after.result.workspaceStartupIssue===undefined);
  await call("release_control",{control_token:lease.result.control_token});
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test("unbind refresh preserves an unresolved startup selection warning",{skip:process.platform==="win32"?"POSIX protected store; Windows ACL backend unverified":false},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-bootstrap-unbind-warning-")),identity=path.join(root,"identity"),project=path.join(root,"project");
 await fs.mkdir(project,{mode:0o700});
 try{
  const [enrolled]=await enrollRolesTrustedBatch([{id:"preexisting-selected-root",root:project,role:"workspace"}],identity);
  const registry=new WorkspaceRegistry();await registry.importTrusted(enrolled!.grant);
  const {invoke}=await bootstrapMcpTools(registry,identity,path.join(root,"missing-installation"),undefined,"WORKSPACE_ROOT_CHANGED");
  const call=async(name:string,args:Record<string,unknown>={})=>JSON.parse((await invoke({name,arguments:args})).content[0].text);
  const lease=await call("acquire_control");assert.equal(lease.ok,true);
  const unbound=await call("unbind_workspace",{workspace_id:"preexisting-selected-root",control_token:lease.result.control_token});assert.equal(unbound.ok,true);
  const status=await call("list_capabilities");
  assert.equal(status.result.workspaceSelectionRequired,true,"revocation alone must not clear unresolved initial selection warning");
  assert.equal(status.result.workspaceStartupIssue,"WORKSPACE_ROOT_CHANGED");
  assert.deepEqual((await call("list_workspaces")).result,[]);
  await call("release_control",{control_token:lease.result.control_token});
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test("HTTP transport invokes the supplied production tool dispatcher",async()=>{
 let calls=0;
 const server=createHttpMcpServer("ephemeral-test-token-at-least-32-characters",new WorkspaceRegistry(),async call=>{calls++;return {content:[{type:"text",text:JSON.stringify({ok:true,result:call.name})}]};});
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 try{
  const port=(server.address() as AddressInfo).port;
  const response=await fetch(`http://127.0.0.1:${port}/mcp`,{method:"POST",headers:{authorization:"Bearer ephemeral-test-token-at-least-32-characters","content-type":"application/json",accept:"application/json, text/event-stream","mcp-protocol-version":"2025-03-26"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"connector_status",arguments:{}}})});
  const value=await response.json() as any;assert.equal(JSON.parse(value.result.content[0].text).result,"connector_status");assert.equal(calls,1);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
test("native authorization tolerates a transient controller lock but rejects released credentials",{skip:process.platform==="win32"},async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"gsa-auth-contention-")));
 const identity=path.join(root,"identity"),project=path.join(root,"project");
 await fs.mkdir(identity,{mode:0o700});await fs.mkdir(project,{mode:0o700});
 try{
  const registry=new WorkspaceRegistry(),grant=await registry.enrollTrusted("fixture",project,["read","execute"]);
  await fs.writeFile(path.join(identity,"trusted-workspaces.json"),JSON.stringify([{id:grant.id,root:grant.canonicalRoot,rootIdentity:grant.rootIdentity,permissions:grant.permissions,revision:grant.revision}]),{mode:0o600});
  const store=new ControlLeaseStore(identity),lease=await store.acquire();
  await withControlToken(store,lease.control_token,async()=>{
   const lock=path.join(identity,"control-lease.lock");await fs.writeFile(lock,"",{mode:0o600,flag:"wx"});
   const release=new Promise<void>((resolve,reject)=>setTimeout(()=>{void fs.unlink(lock).then(()=>resolve(),reject);},25));
   await authorizeMcpWorkspace(registry,"fixture",identity);await release;
   await store.release(lease.control_token);
   await assert.rejects(authorizeMcpWorkspace(registry,"fixture",identity),(error:any)=>error.code==="SESSION_INVALID");
  });
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
