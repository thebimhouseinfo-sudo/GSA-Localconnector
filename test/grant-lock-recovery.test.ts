import {test as platformTest} from "node:test";
const test=(name:string,fn:()=>void|Promise<void>)=>platformTest(name,{skip:process.platform==="win32"?"POSIX ownership/mode storage test; Windows ACL backend unverified":false},fn);
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {enrollReadOnly,enrollReadOnlyBatch,loadTrustedRegistry,recoverServerGrantLock,recoverDesktopGrantLock,pruneInactiveWorkspaceRegistrations} from "../src/local/grants.js";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {createReadOnlyTools} from "../src/mcp/server.js";
import {bootstrapMcpTools} from "../src/mcp/runtime-bootstrap.js";

const LOCK=".trusted-workspaces.lock";
async function fixture(fn:(ctx:{store:string;lock:string;root:string})=>Promise<void>){
 const base=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"gsa-grantlock-recovery-"))),store=path.join(base,"identity"),root=path.join(base,"root");
 const oldFd=process.env.GSA_OWNER_LOCK_FD,oldSession=process.env.GSA_OWNER_SESSION;
 try{
  await fs.mkdir(root);await fs.mkdir(store,{mode:0o700});
  await fn({store,lock:path.join(store,LOCK),root});
 }finally{
  if(oldFd===undefined)delete process.env.GSA_OWNER_LOCK_FD;else process.env.GSA_OWNER_LOCK_FD=oldFd;
  if(oldSession===undefined)delete process.env.GSA_OWNER_SESSION;else process.env.GSA_OWNER_SESSION=oldSession;
  await fs.rm(base,{recursive:true,force:true});
 }
}
const writeLock=(lock:string,holder:string,session:string)=>fs.writeFile(lock,JSON.stringify({format:"gsa-grant-lock-v1",holder,session}),{mode:0o600,flag:"wx"});
const exists=async(file:string)=>fs.lstat(file).then(()=>true,()=>false);

test("lock of an earlier server session is removed by startup recovery and enroll then succeeds",async()=>fixture(async({store,lock,root})=>{
 await writeLock(lock,"server",randomUUID());
 await assert.rejects(enrollReadOnly("a",root,store),(e:any)=>e.code==="GRANT_STORE_BUSY");
 assert.equal(await recoverServerGrantLock(store,randomUUID()),"removed");
 await enrollReadOnly("a",root,store);
 assert.deepEqual((await loadTrustedRegistry(store)).list().map(g=>g.id),["a"]);
}));

test("startup recovery never removes a desktop lock; enroll reports GRANT_STORE_BUSY with a code",async()=>fixture(async({store,lock,root})=>{
 await writeLock(lock,"desktop",randomUUID());
 assert.equal(await recoverServerGrantLock(store,randomUUID()),"kept");
 assert.equal(await exists(lock),true);
 await assert.rejects(enrollReadOnly("a",root,store),(e:any)=>e.code==="GRANT_STORE_BUSY"&&/GRANT_STORE_BUSY/.test(e.message));
}));

test("startup recovery never removes the lock of the current session",async()=>fixture(async({store,lock})=>{
 const session=randomUUID();await writeLock(lock,"server",session);
 assert.equal(await recoverServerGrantLock(store,session),"kept");
 assert.equal(await exists(lock),true);
}));

test("unparseable locks are never deleted by server or adapter recovery and report GRANT_STORE_RECOVERY_REQUIRED",async()=>fixture(async({store,lock,root})=>{
 for(const content of ["","held",'{"format":"other"}','{"format":"gsa-grant-lock-v1","holder":"server"}']){
  await fs.writeFile(lock,content,{mode:0o600});
  assert.equal(await recoverServerGrantLock(store,randomUUID()),"kept");
  assert.equal(await recoverDesktopGrantLock(store,randomUUID()),"kept");
  assert.equal(await fs.readFile(lock,"utf8"),content);
  await assert.rejects(enrollReadOnly("a",root,store),(e:any)=>e.code==="GRANT_STORE_RECOVERY_REQUIRED"&&/delete/i.test(e.message));
  await fs.rm(lock);
 }
}));

test("desktop recovery removes only a foreign-session desktop lock",async()=>fixture(async({store,lock})=>{
 const mine=randomUUID();
 await writeLock(lock,"desktop",mine);assert.equal(await recoverDesktopGrantLock(store,mine),"kept");assert.equal(await exists(lock),true);await fs.rm(lock);
 await writeLock(lock,"server",randomUUID());assert.equal(await recoverDesktopGrantLock(store,mine),"kept");assert.equal(await exists(lock),true);await fs.rm(lock);
 await writeLock(lock,"desktop",randomUUID());assert.equal(await recoverDesktopGrantLock(store,mine),"removed");assert.equal(await exists(lock),false);
 assert.equal(await recoverDesktopGrantLock(store,mine),"absent");
}));

test("recovery refuses a symlinked or group-readable lock without removing it",async()=>fixture(async({store,lock})=>{
 const target=path.join(store,"target");await fs.writeFile(target,"x",{mode:0o600});await fs.symlink(target,lock);
 await assert.rejects(recoverServerGrantLock(store,randomUUID()),/UNSAFE_GRANT_STORE/);assert.equal((await fs.lstat(lock)).isSymbolicLink(),true);await fs.rm(lock);
 await writeLock(lock,"server",randomUUID());await fs.chmod(lock,0o644);
 await assert.rejects(recoverServerGrantLock(store,randomUUID()),/UNSAFE_GRANT_STORE/);assert.equal(await exists(lock),true);
}));

test("lock is written atomically with owner content, 0600, nlink 1, and no temp file remains",async()=>fixture(async({store,lock,root})=>{
 const session=randomUUID();process.env.GSA_OWNER_LOCK_FD="3";process.env.GSA_OWNER_SESSION=session;
 let seen:any;
 await enrollReadOnlyBatch([{id:"a",root}],store,async()=>{
  const info=await fs.lstat(lock);seen={info,body:JSON.parse(await fs.readFile(lock,"utf8")),names:await fs.readdir(store)};
 });
 assert.deepEqual(seen.body,{format:"gsa-grant-lock-v1",holder:"server",session});
 assert.equal(seen.info.mode&0o777,0o600);assert.equal(seen.info.nlink,1);
 assert.deepEqual(seen.names.filter((n:string)=>n.endsWith(".tmp")),[]);
 assert.equal(await exists(lock),false);assert.deepEqual((await fs.readdir(store)).filter(n=>n.endsWith(".tmp")),[]);
}));

test("a writer without a verified owner records holder unowned, which no recovery removes",async()=>fixture(async({store,lock,root})=>{
 delete process.env.GSA_OWNER_LOCK_FD;delete process.env.GSA_OWNER_SESSION;
 let body:any;
 await enrollReadOnlyBatch([{id:"a",root}],store,async()=>{body=JSON.parse(await fs.readFile(lock,"utf8"));await assert.doesNotReject(async()=>{
  assert.equal(await recoverServerGrantLock(store,randomUUID()),"kept");assert.equal(await recoverDesktopGrantLock(store,randomUUID()),"kept");});});
 assert.equal(body.holder,"unowned");
}));

test("two concurrent writers: exactly one wins the link, the other gets GRANT_STORE_BUSY",async()=>fixture(async({store,root})=>{
 let inner:unknown;
 const other=path.join(path.dirname(root),"other");await fs.mkdir(other);
 await enrollReadOnlyBatch([{id:"a",root}],store,async()=>{
  inner=await enrollReadOnly("b",other,store).then(()=>"won",e=>e);
 });
 assert.equal((inner as any).code,"GRANT_STORE_BUSY");
 assert.deepEqual((await loadTrustedRegistry(store)).list().map(g=>g.id),["a"]);
}));

test("prune writes a desktop holder lock with the supplied Desktop session",async()=>fixture(async({store,lock,root})=>{
 await enrollReadOnly("a",root,store);
 const session=randomUUID(),patch=fs as unknown as {open:(file:string,...args:any[])=>Promise<any>},original=patch.open;let body:any;
 patch.open=async(file,...args)=>{if(file===path.join(store,"trusted-workspaces.json")&&!body)body=JSON.parse(await fs.readFile(lock,"utf8"));return original.call(fs,file,...args);};
 try{await pruneInactiveWorkspaceRegistrations(store,{holder:"desktop",session});}finally{patch.open=original;}
 assert.deepEqual(body,{format:"gsa-grant-lock-v1",holder:"desktop",session});
 assert.equal(await exists(lock),false);
}));

platformTest("bootstrap with owner fence removes an earlier server lock but keeps desktop and unparseable locks",{skip:process.platform!=="darwin"},async()=>fixture(async({store,lock,root})=>{
 const session=randomUUID();process.env.GSA_OWNER_LOCK_FD="3";process.env.GSA_OWNER_SESSION=session;
 const boot=()=>bootstrapMcpTools(new WorkspaceRegistry(),store,path.join(store,"missing"),{identityRoot:store,session,lockFD:3});
 await writeLock(lock,"server",randomUUID());await boot();assert.equal(await exists(lock),false);
 await enrollReadOnly("a",root,store);
 await writeLock(lock,"desktop",randomUUID());await boot();assert.equal(await exists(lock),true);await fs.rm(lock);
 await fs.writeFile(lock,"",{mode:0o600});await boot();assert.equal(await exists(lock),true);await fs.rm(lock);
 await writeLock(lock,"server",session);await boot();assert.equal(await exists(lock),true);
}));

test("inspect_workspace_recovery reports stale_grant_lock holder and relation",async()=>fixture(async({store,lock})=>{
 const session=randomUUID();process.env.GSA_OWNER_LOCK_FD="3";process.env.GSA_OWNER_SESSION=session;
 const invoke=(createReadOnlyTools as unknown as (...args:any[])=>(call:any)=>Promise<any>)(new WorkspaceRegistry(),null,null,null,null,null,null,null,null,null,null,{grantDirectory:store});
 const inspect=async()=>JSON.parse((await invoke({name:"inspect_workspace_recovery",arguments:{}})).content[0].text);
 assert.deepEqual((await inspect()).result,[]);
 const cases:Array<[string|undefined,string,string,string]>=[
  ["server",randomUUID(),"server","foreign"],["server",session,"server","current"],["desktop",randomUUID(),"desktop","foreign"],[undefined,"","unparseable","unparseable"]];
 for(const [holder,id,expectedHolder,relation] of cases){
  if(holder)await writeLock(lock,holder,id);else await fs.writeFile(lock,"",{mode:0o600});
  const report=(await inspect()).result.find((x:any)=>x.stale_grant_lock)?.stale_grant_lock;
  assert.equal(report.holder,expectedHolder);assert.equal(report.relation,relation);
  assert.doesNotMatch(JSON.stringify(report),new RegExp(id||"^$"));assert.doesNotMatch(JSON.stringify(report),/\/(tmp|var)\//);
  await fs.rm(lock);
 }
}));
