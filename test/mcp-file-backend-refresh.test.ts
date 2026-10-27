import {test as platformTest} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {createReadOnlyTools} from "../src/mcp/server.js";

const test=(name:string,fn:()=>void|Promise<void>)=>platformTest(name,{skip:process.platform==="win32"?"POSIX protected-store fixture; Windows ACL backend unverified":false},fn);
const body=(result:{content:Array<{text:string}>})=>JSON.parse(result.content[0]!.text);
const call=async(invoke:(value:any)=>Promise<any>,name:string,args:Record<string,unknown>={})=>body(await invoke({name,arguments:args}));
type FutureOptions={
 grantDirectory?:string;
 fileBackendState?:()=>{files:any|null;fileBlockedReason?:string};
 onScopeChanged?:(kind:"bind"|"unbind")=>Promise<void>;
};
const makeTools=(registry:WorkspaceRegistry,identity:string,options:FutureOptions)=>{
 const factory=createReadOnlyTools as unknown as (...args:any[])=>((call:any)=>Promise<any>);
 return factory(registry,null,null,null,null,null,null,null,null,null,null,options);
};
function fakeFiles(name:string,calls:string[]){
 return {
  supportedOperations:["create_directory"],
  read:async()=>{throw Error(`${name}:unused`);},createExclusive:async()=>{},replaceIfHash:async()=>{},
  makeDirectory:async(ref:{path:string})=>{calls.push(`${name}:${ref.path}`);},copyExclusive:async()=>{},moveExclusive:async()=>{},trashIfHash:async()=>{}
 };
}

test("file dispatch and capability reporting follow null-to-partial-to-null backend refresh",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-file-refresh-")),identity=path.join(root,"identity"),project=path.join(root,"project");
 await fs.mkdir(project,{mode:0o700});
 try{
  const registry=new WorkspaceRegistry(),calls:string[]=[],first=fakeFiles("first",calls),second=fakeFiles("second",calls);
  let state:{files:any|null;fileBlockedReason?:string}={files:null,fileBlockedReason:"startup grant mismatch"};
  const invoke=makeTools(registry,identity,{grantDirectory:identity,fileBackendState:()=>state});
  const initial=await call(invoke,"list_capabilities");assert.equal(initial.result.fileBackendAvailable,false);assert.deepEqual(initial.result.fileOperations,[]);
  state={files:first};
  const bound=await call(invoke,"bind_workspaces",{roots:[{path:project,role:"workspace"}]});assert.equal(bound.ok,true);
  const current=await call(invoke,"list_capabilities");assert.equal(current.result.fileBackendAvailable,true);assert.deepEqual(current.result.fileOperations,["create_directory"]);
  const workspace=bound.result[0].workspace_id;
  assert.equal((await call(invoke,"create_directory",{workspace_id:workspace,path:"from-first"})).ok,true);
  state={files:second};
  assert.equal((await call(invoke,"create_directory",{workspace_id:workspace,path:"from-second"})).ok,true);
  assert.deepEqual(calls,["first:from-first","second:from-second"]);
  assert.equal((await call(invoke,"create_file",{workspace_id:workspace,path:"unsupported.txt",content:"x"})).code,"SECURITY_BLOCKED");
  state={files:null,fileBlockedReason:"refreshed backend unavailable"};
  const unavailable=await call(invoke,"list_capabilities");assert.equal(unavailable.result.fileBackendAvailable,false);assert.deepEqual(unavailable.result.fileOperations,[]);
  assert.equal(unavailable.result.fileBlockedReason,"refreshed backend unavailable");
  assert.equal((await call(invoke,"create_directory",{workspace_id:workspace,path:"blocked"})).code,"SECURITY_BLOCKED");
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test("scope refresh callback follows confirmed bind and unbind publication only",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-scope-refresh-")),identity=path.join(root,"identity"),project=path.join(root,"project");
 await fs.mkdir(project,{mode:0o700});
 try{
  const registry=new WorkspaceRegistry(),observed:Array<{kind:string;ids:string[]}> = [];
  const invoke=makeTools(registry,identity,{grantDirectory:identity,onScopeChanged:async kind=>{observed.push({kind,ids:registry.list().map(grant=>grant.id)});}});
  const bound=await call(invoke,"bind_workspaces",{roots:[{path:project,role:"workspace"}]});assert.equal(bound.ok,true);
  assert.deepEqual(observed,[{kind:"bind",ids:[bound.result[0].workspace_id]}],"callback must observe reconciled registry after durable binding");
  const invalid=await call(invoke,"bind_workspaces",{roots:[{path:path.join(root,"missing"),role:"workspace"}]});assert.equal(invalid.ok,false);
  assert.equal(observed.length,1,"failed publication must not refresh backend or startup diagnostics");
  const revoked=await call(invoke,"unbind_workspace",{workspace_id:bound.result[0].workspace_id});assert.equal(revoked.ok,true);
  assert.deepEqual(observed[1],{kind:"unbind",ids:[]},"unbind callback must observe revoked registry state");
  assert.equal((await call(invoke,"get_workspace",{workspace_id:bound.result[0].workspace_id})).code,"WORKSPACE_NOT_FOUND");
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test("one invocation keeps its captured backend while a later invocation sees the refresh",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-file-refresh-snapshot-")),identity=path.join(root,"identity"),project=path.join(root,"project");
 await fs.mkdir(project,{mode:0o700});
 try{
  const registry=new WorkspaceRegistry(),calls:string[]=[];
  let signalStarted!:()=>void,releaseFirst!:()=>void;
  const firstStarted=new Promise<void>(resolve=>{signalStarted=resolve}),continueFirst=new Promise<void>(resolve=>{releaseFirst=resolve});
  const first=fakeFiles("first",calls),second=fakeFiles("second",calls);
  first.makeDirectory=async(ref:{path:string})=>{calls.push(`first:${ref.path}`);signalStarted();await continueFirst;};
  let state:{files:any|null;fileBlockedReason?:string}={files:first},providerReads=0;
  const invoke=makeTools(registry,identity,{grantDirectory:identity,fileBackendState:()=>{providerReads++;return state;}});
  const bound=await call(invoke,"bind_workspaces",{roots:[{path:project,role:"workspace"}]});assert.equal(bound.ok,true);
  const workspace=bound.result[0].workspace_id;providerReads=0;
  const pending=call(invoke,"create_directory",{workspace_id:workspace,path:"in-flight"});
  await firstStarted;
  state={files:second};
  releaseFirst();
  assert.equal((await pending).ok,true);
  assert.equal(providerReads,1,"one backend state is captured for the complete in-flight operation");
  assert.equal((await call(invoke,"create_directory",{workspace_id:workspace,path:"after-refresh"})).ok,true);
  assert.deepEqual(calls,["first:in-flight","second:after-refresh"]);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
