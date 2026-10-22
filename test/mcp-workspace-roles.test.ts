import {test as platformTest} from "node:test";
import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {promisify} from "node:util";
import {pathToFileURL} from "node:url";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {createReadOnlyTools,toolDefinitions} from "../src/mcp/server.js";
import {ControlLeaseStore} from "../src/local/control-lease.js";
import {identityDirectory} from "../src/local/identity.js";
import {enrollRolesTrustedBatch} from "../src/local/grants.js";
import {loadTrustedRegistry} from "../src/local/grants.js";

type FutureFactory=(registry:WorkspaceRegistry,nativeFiles?:null,sandbox?:null,ciStore?:null,artifacts?:null,logs?:null,nativeProcesses?:null,snapshots?:null,sourceCapture?:null,ciExecutor?:null,controlStore?:ControlLeaseStore|null,options?:{grantDirectory?:string})=>(call:any)=>Promise<any>;
function createTools(registry:WorkspaceRegistry,grantDirectory:string,controlStore:ControlLeaseStore|null=null){
 const factory=createReadOnlyTools as unknown as FutureFactory;
 return factory(registry,null,null,null,null,null,null,null,null,null,controlStore,{grantDirectory});
}

async function isolated(fn:(root:string,home:string)=>Promise<void>):Promise<void> {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-mcp-roles-")),home=path.join(root,"home");
 await fs.mkdir(home,{mode:0o700});
 const original=os.homedir;os.homedir=()=>home;
 try{await fn(root,home);}finally{os.homedir=original;await fs.rm(root,{recursive:true,force:true});}
}
async function dir(parent:string,name:string):Promise<string>{const value=path.join(parent,name);await fs.mkdir(value,{recursive:true,mode:0o700});return value;}
function body(result:{content:Array<{text:string}>}):any{return JSON.parse(result.content[0]!.text);}
async function call(invoke:(value:any)=>Promise<any>,name:string,args:Record<string,unknown>={}){return body(await invoke({name,arguments:args}));}
function definitions():any{return toolDefinitions().find(item=>item.name==="bind_workspaces");}
const execFileAsync=promisify(execFile);
const test=(name:string,fn:()=>void|Promise<void>)=>platformTest(name,{skip:process.platform==="win32"?"POSIX protected-store fixture; Windows ACL backend unverified":false},fn);

test("bind schema accepts either legacy paths or explicit roles and rejects malformed scope forms",async()=>isolated(async root=>{
 const schema=definitions().inputSchema;
 assert.ok(Array.isArray(schema.oneOf),"bind_workspaces schema must express the legacy and role forms");
 const work=await dir(root,"work"),registry=new WorkspaceRegistry(),invoke=createTools(registry,path.join(root,"identity"));
 for(const args of [
  {},{paths:[]},{paths:["relative"]},{paths:[work],roots:[{path:work,role:"workspace"}]},
  {roots:[]},{roots:[{path:work,role:"admin"}]},{roots:[{path:work,role:"workspace",id:"invented"}]},
  {roots:[{path:work,role:"reference"}],extra:true}
 ]){
  const result=await call(invoke,"bind_workspaces",args);
  assert.equal(result.code,"INVALID_ARGUMENTS",JSON.stringify(args));
 }
 assert.equal((await fs.stat(path.join(root,"identity","trusted-workspaces.json")).catch(()=>null)),null);
}));

platformTest("read-only factory does not resolve an unsupported default identity eagerly",async()=>{
 const script=`
  import {pathToFileURL} from "node:url"; import path from "node:path";
  const {WorkspaceRegistry}=await import(pathToFileURL(path.resolve("dist/src/core/workspace.js")));
  const {createReadOnlyTools}=await import(pathToFileURL(path.resolve("dist/src/mcp/server.js")));
  Object.defineProperty(process,"platform",{value:"linux"});
  const invoke=createReadOnlyTools(new WorkspaceRegistry());
  const list=JSON.parse((await invoke({name:"list_workspaces"})).content[0].text);
  const status=JSON.parse((await invoke({name:"connector_status"})).content[0].text);
  process.stdout.write(JSON.stringify({list,status}));
 `;
 const {stdout}=await execFileAsync(process.execPath,["--input-type=module","-e",script],{cwd:process.cwd(),encoding:"utf8"});
 const result=JSON.parse(String(stdout));
 assert.deepEqual(result.list.result,[]);
 assert.equal(result.status.code,"UNSUPPORTED_PLATFORM");
});

test("explicit workspace/reference binding round-trips role metadata without enabling unsupported backends",async()=>isolated(async(root,home)=>{
 const work=await dir(root,"work"),reference=await dir(root,"reference"),identity=path.join(root,"identity"),registry=new WorkspaceRegistry();
 const invoke=createTools(registry,identity);
 const bound=await call(invoke,"bind_workspaces",{roots:[{path:work,role:"workspace"},{path:reference,role:"reference"}]});
 assert.equal(bound.ok,true);
 assert.deepEqual(bound.result.map((x:any)=>x.role),["workspace","reference"]);
 assert.deepEqual(bound.result.map((x:any)=>x.permissions),[["read","write","execute"],["read"]]);
 const listed=await call(invoke,"list_workspaces"),got=await call(invoke,"get_workspace",{workspace_id:bound.result[0].workspace_id});
 assert.deepEqual(listed.result.map((x:any)=>x.role),["workspace","reference"]);assert.equal(got.result.role,"workspace");
 const status=await call(invoke,"connector_status");
 if(process.platform==="darwin"){
  assert.deepEqual(status.result.workspace_roles,["workspace","reference"]);
  assert.equal(status.result.workspace_role_semantics,"grant-intent; backend-availability-reported-separately");
  assert.equal(status.result.hostFileWrites,false);assert.equal(status.result.readyForShell,false);assert.equal(status.result.git,"blocked");
 }else assert.equal(status.code,"UNSUPPORTED_PLATFORM");
 assert.equal((await call(invoke,"run_command",{workspace_id:bound.result[0].workspace_id,command:"/bin/echo",args:["x"]})).code,"SECURITY_BLOCKED");
 assert.ok(await fs.stat(path.join(identity,"trusted-workspaces.json")));
 assert.equal(await fs.stat(path.join(identityDirectory("darwin",home),"trusted-workspaces.json")).then(()=>true,()=>false),false,"default identity location must remain untouched");
}));

test("explicit binding is idempotent, preserves custom root IDs and rejects mixed-role nesting atomically",async()=>isolated(async root=>{
 const identity=path.join(root,"identity"),parent=await dir(root,"parent"),child=await dir(parent,"child");
 await enrollRolesTrustedBatch([{id:"custom-project-id",root:parent,role:"workspace"}],identity);
 const registry=new WorkspaceRegistry(),invoke=createTools(registry,identity);
 const first=await call(invoke,"bind_workspaces",{roots:[{path:parent,role:"workspace"}]});
 assert.equal(first.result[0].workspace_id,"custom-project-id");
 const again=await call(invoke,"bind_workspaces",{roots:[{path:parent,role:"workspace"}]});
 assert.equal(again.result[0].revision,first.result[0].revision);
 const before=await fs.readFile(path.join(identity,"trusted-workspaces.json"),"utf8");
 const conflict=await call(invoke,"bind_workspaces",{roots:[{path:parent,role:"workspace"},{path:child,role:"reference"}]});
 assert.equal(conflict.code,"PERMISSION_DENIED");
 assert.equal(await fs.readFile(path.join(identity,"trusted-workspaces.json"),"utf8"),before);
 assert.deepEqual(registry.list().map(g=>g.id),["custom-project-id"]);
}));

test("explicit binding repairs a replaced selected root using its stored custom ID and advances its epoch",async()=>isolated(async root=>{
 const identity=path.join(root,"identity"),selected=await dir(root,"selected"),moved=path.join(root,"selected-old");
 const [old]=await enrollRolesTrustedBatch([{id:"custom-stable-id",root:selected,role:"workspace"}],identity);
 const registry=new WorkspaceRegistry();await registry.importTrusted(old!.grant);
 await fs.rename(selected,moved);await fs.mkdir(selected,{mode:0o700});
 const invoke=createTools(registry,identity),result=await call(invoke,"bind_workspaces",{roots:[{path:selected,role:"workspace"}]});
 assert.equal(result.ok,true);assert.equal(result.result[0].workspace_id,"custom-stable-id");
 assert.equal(result.result[0].revision,old!.grant.revision+1);
 assert.notDeepEqual(registry.get("custom-stable-id")!.rootIdentity,old!.grant.rootIdentity);
}));

test("one binding applies a final parent-child workspace-to-reference transition",async()=>isolated(async root=>{
 const identity=path.join(root,"identity"),parent=await dir(root,"parent"),child=await dir(parent,"child");
 const grants=await enrollRolesTrustedBatch([{id:"parent",root:parent,role:"workspace"},{id:"child",root:child,role:"workspace"}],identity);
 const registry=new WorkspaceRegistry();for(const item of grants)await registry.importTrusted(item.grant);
 const invoke=createTools(registry,identity),result=await call(invoke,"bind_workspaces",{roots:[{path:parent,role:"reference"},{path:child,role:"reference"}]});
 assert.equal(result.ok,true);assert.deepEqual(registry.list().map(g=>g.role),["reference","reference"]);
 assert.deepEqual(result.result.map((item:any)=>item.workspace_id),["parent","child"]);
 assert.deepEqual(registry.list().map(g=>g.revision),[2,2]);
}));

test("legacy path binding remains role-less and cannot downgrade an explicit workspace",async()=>isolated(async root=>{
 const identity=path.join(root,"identity"),work=await dir(root,"work"),other=await dir(root,"other");
 await enrollRolesTrustedBatch([{id:"fixed-explicit-id",root:work,role:"workspace"}],identity);
 const registry=new WorkspaceRegistry(),invoke=createTools(registry,identity);
 const downgraded=await call(invoke,"bind_workspaces",{paths:[work]});
 assert.equal(downgraded.ok,false);
 assert.match(downgraded.message??downgraded.code,/explicit|role|workspace/i);
 const legacy=await call(invoke,"bind_workspaces",{paths:[other]});
 assert.equal(legacy.ok,true);assert.equal(legacy.result[0].role,null);
 assert.deepEqual(legacy.result[0].permissions,["read"]);
}));

test("controller credentials are checked for role binding before publication",async()=>isolated(async root=>{
 const identity=path.join(root,"identity"),work=await dir(root,"work"),store=new ControlLeaseStore(path.join(root,"control")),registry=new WorkspaceRegistry();
 const invoke=createTools(registry,identity,store);
 assert.equal((await call(invoke,"bind_workspaces",{roots:[{path:work,role:"workspace"}]})).code,"SESSION_INVALID");
 assert.equal((await call(invoke,"bind_workspaces",{roots:[{path:work,role:"workspace"}],control_token:"wrong-token"})).code,"SESSION_INVALID");
 assert.equal(await fs.stat(path.join(identity,"trusted-workspaces.json")).then(()=>true,()=>false),false);
 const lease=await store.acquire();
 const valid=await call(invoke,"bind_workspaces",{roots:[{path:work,role:"workspace"}],control_token:lease.control_token});
 assert.equal(valid.ok,true);
 await store.release(lease.control_token);
}));

test("same-dispatcher concurrent same-root binds serialize and leave one durable selection",async()=>isolated(async root=>{
 const identity=path.join(root,"identity"),work=await dir(root,"work"),registry=new WorkspaceRegistry();
 const invoke=createTools(registry,identity);
 const results=await Promise.all([call(invoke,"bind_workspaces",{roots:[{path:work,role:"workspace"}]}),call(invoke,"bind_workspaces",{roots:[{path:work,role:"workspace"}]})]);
 assert.ok(results.every(value=>value.ok===true));
 assert.equal(results[0].result[0].workspace_id,results[1].result[0].workspace_id);
 const stored=JSON.parse(await fs.readFile(path.join(identity,"trusted-workspaces.json"),"utf8"));
 assert.equal(stored.length,1);assert.equal(stored[0].revision,1);
}));

test("unbind applies a complete snapshot and removes local authority without double-revoking",async()=>isolated(async root=>{
 const identity=path.join(root,"identity"),work=await dir(root,"work"),reference=await dir(root,"reference"),registry=new WorkspaceRegistry();
 const invoke=createTools(registry,identity);
 const bound=await call(invoke,"bind_workspaces",{roots:[{path:work,role:"workspace"},{path:reference,role:"reference"}]});
 assert.equal(bound.ok,true);const canonicalWork=await fs.realpath(work),removed=bound.result.find((item:any)=>item.root===canonicalWork);
 const result=await call(invoke,"unbind_workspace",{workspace_id:removed.workspace_id});
 assert.equal(result.ok,true);assert.equal(registry.get(removed.workspace_id),undefined);
 assert.deepEqual(registry.list().map(g=>g.id),[bound.result.find((item:any)=>item.role==="reference").workspace_id]);
 const durable=JSON.parse(await fs.readFile(path.join(identity,"trusted-workspaces.json"),"utf8"));
 const tombstone=durable.find((item:any)=>item.id===removed.workspace_id);
 assert.equal(tombstone.revoked,true);assert.equal(tombstone.role,"workspace");assert.deepEqual(tombstone.permissions,[]);
}));

test("post-publication snapshot failure latches scope as uncertain without retry and fresh load reconciles",async()=>isolated(async root=>{
 const identity=path.join(root,"identity"),work=await dir(root,"work"),registry=new WorkspaceRegistry(),controls=new ControlLeaseStore(path.join(root,"control")),invoke=createTools(registry,identity,controls);
 const runtime=registry as WorkspaceRegistry&{replaceTrustedSnapshot?:(grants:readonly any[])=>Promise<readonly any[]>};
 const original=runtime.replaceTrustedSnapshot;assert.equal(typeof original,"function","snapshot API must be available before MCP can reconcile durable roles");
 runtime.replaceTrustedSnapshot=async()=>{throw Error("injected apply failure after durable publication");};
 try{
  const lease=await controls.acquire();
  const uncertain=await call(invoke,"bind_workspaces",{roots:[{path:work,role:"workspace"}],control_token:lease.control_token});
  assert.equal(uncertain.code,"RESULT_UNKNOWN");
  const committed=await fs.readFile(path.join(identity,"trusted-workspaces.json"),"utf8");
  assert.equal(JSON.parse(committed).length,1);
  assert.equal((await call(invoke,"list_workspaces")).code,"RESULT_UNKNOWN");
  assert.equal((await call(invoke,"get_workspace",{workspace_id:"anything"})).code,"RESULT_UNKNOWN");
  assert.equal((await call(invoke,"connector_status")).ok,true);
  assert.equal((await call(invoke,"release_control",{control_token:lease.control_token})).ok,true);
  assert.equal(await fs.readFile(path.join(identity,"trusted-workspaces.json"),"utf8"),committed,"uncertain scope must not retry publication");
 }finally{if(original)runtime.replaceTrustedSnapshot=original;}
 const reloaded=await loadTrustedRegistry(identity);
 assert.equal(reloaded.list()[0]!.role,"workspace");
 const fresh=await call(createTools(reloaded,identity),"list_workspaces");assert.equal(fresh.result[0].role,"workspace");
}));

test("binding rejects a different publication before its first readback",async()=>isolated(async root=>{
 const identity=path.join(root,"identity"),work=await dir(root,"work"),concurrent=await dir(root,"concurrent"),registry=new WorkspaceRegistry(),invoke=createTools(registry,identity);
 const fsPatch=fs as unknown as {unlink:(...args:any[])=>Promise<any>},original=fsPatch.unlink,lock=path.join(identity,".trusted-workspaces.lock");
 let injected=false;
 fsPatch.unlink=async(...args:any[])=>{
  const value=await original.apply(fs,args);
  if(args[0]===lock&&!injected){
   injected=true;
   await enrollRolesTrustedBatch([{id:"independent-writer",root:concurrent,role:"reference"}],identity);
  }
  return value;
 };
 try{
  const result=await call(invoke,"bind_workspaces",{roots:[{path:work,role:"workspace"}]});
  assert.equal(injected,true,"the competing legitimate writer must publish between unlock and first readback");
  assert.equal(result.code,"RESULT_UNKNOWN","a different complete durable publication is not success for this bind");
  const bytes=await fs.readFile(path.join(identity,"trusted-workspaces.json"),"utf8"),stored=JSON.parse(bytes);
  const canonicalWork=await fs.realpath(work);
  assert.equal(stored.length,2);assert.ok(stored.some((entry:any)=>entry.id==="independent-writer"&&entry.role==="reference"));
  assert.ok(stored.some((entry:any)=>entry.root===canonicalWork&&entry.role==="workspace"));
  assert.equal((await call(invoke,"list_workspaces")).code,"RESULT_UNKNOWN");
  assert.equal(await fs.readFile(path.join(identity,"trusted-workspaces.json"),"utf8"),bytes,"desynchronized scope must not retry publication");
  const fresh=await loadTrustedRegistry(identity);assert.deepEqual(fresh.list().map(g=>g.id).sort(),stored.map((entry:any)=>entry.id).sort());
 }finally{fsPatch.unlink=original;}
}));

test("queued binding rechecks released controller, leaves no publication, then accepts a new lease",async()=>isolated(async root=>{
 const identity=path.join(root,"identity"),work=await dir(root,"work"),controls=new ControlLeaseStore(path.join(root,"control")),registry=new WorkspaceRegistry(),invoke=createTools(registry,identity,controls);
 assert.ok(Array.isArray(definitions().inputSchema.oneOf),"role binding queue test requires the explicit form schema");
 const lease=await controls.acquire(),fsPatch=fs as unknown as {realpath:(...args:any[])=>Promise<any>},original=fsPatch.realpath;
 let reached!:()=>void;const entered=new Promise<void>(resolve=>{reached=resolve;});let release!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;});
 fsPatch.realpath=async(...args:any[])=>{const value=await original.apply(fs,args);if(args[0]===work){reached();await hold;}return value;};
 try{
  const first=call(invoke,"bind_workspaces",{roots:[{path:work,role:"workspace"}],control_token:lease.control_token});
  await entered;
  const queued=call(invoke,"bind_workspaces",{roots:[{path:work,role:"workspace"}],control_token:lease.control_token});
  await call(invoke,"release_control",{control_token:lease.control_token});release();
  assert.equal((await first).code,"SESSION_INVALID");assert.equal((await queued).code,"SESSION_INVALID");
 }finally{release();fsPatch.realpath=original;}
 assert.equal(await fs.stat(path.join(identity,"trusted-workspaces.json")).then(()=>true,()=>false),false);
 const next=await controls.acquire(),recovered=await call(invoke,"bind_workspaces",{roots:[{path:work,role:"workspace"}],control_token:next.control_token});
 assert.equal(recovered.ok,true);await controls.release(next.control_token);
}));
