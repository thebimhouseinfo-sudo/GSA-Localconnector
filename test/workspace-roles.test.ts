import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import type {WorkspaceGrant} from "../src/core/contracts.js";

type Role = "workspace" | "reference";
type RoleRequest = Readonly<{id:string;root:string;role:Role}>;
type RoleRegistry = WorkspaceRegistry & {
  enrollRolesTrusted?: (requests:readonly RoleRequest[])=>Promise<readonly WorkspaceGrant[]>;
  replaceTrustedSnapshot?: (grants:readonly WorkspaceGrant[])=>Promise<readonly WorkspaceGrant[]>;
};

function api(registry:WorkspaceRegistry):RoleRegistry {
  const value=registry as RoleRegistry;
  assert.equal(typeof value.enrollRolesTrusted,"function","WorkspaceRegistry must expose the explicit-role enrollment API");
  return value;
}
async function enroll(registry:WorkspaceRegistry,requests:readonly RoleRequest[]):Promise<readonly WorkspaceGrant[]> {
  const method=api(registry).enrollRolesTrusted!;
  return method.call(registry,requests);
}
async function fixture(fn:(root:string)=>Promise<void>):Promise<void> {
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-workspace-roles-"));
  try { await fn(tmp); }
  finally { await fs.rm(tmp,{recursive:true,force:true}); }
}
async function directory(root:string,name:string):Promise<string> {
  const result=path.join(root,name);await fs.mkdir(result,{recursive:true});return result;
}
async function codeIs(promise:Promise<unknown>,code:string):Promise<void> {
  await assert.rejects(promise,(error:any)=>error?.code===code);
}
function sorted(values:readonly string[]):string[] { return [...values].sort(); }
function roleOf(grant:WorkspaceGrant):Role|undefined { return (grant as WorkspaceGrant&{role?:Role}).role; }
function withRole(grant:WorkspaceGrant,role:unknown):WorkspaceGrant {
  return {...grant,role} as WorkspaceGrant;
}

test("explicit mixed roles grant exact workspace and reference permissions and immutable snapshots",async()=>fixture(async root=>{
  const work=await directory(root,"work"),ref=await directory(root,"ref");
  const registry=new WorkspaceRegistry();
  const requests=[{id:"app",root:work,role:"workspace" as const},{id:"docs",root:ref,role:"reference" as const}];
  const grants=await enroll(registry,requests);
  requests[0]={id:"app",root:ref,role:"reference"};
  assert.deepEqual(grants.map(x=>x.id),["app","docs"]);
  assert.deepEqual(grants.map(roleOf),["workspace","reference"]);
  assert.deepEqual(grants.map(x=>sorted(x.permissions)),[["execute","read","write"],["read"]]);
  assert.deepEqual(sorted(registry.requireGrant("app","execute").permissions),["execute","read","write"]);
  assert.equal(registry.requireGrant("docs","read").id,"docs");
  await codeIs(Promise.resolve().then(()=>registry.requireGrant("docs","write")),"PERMISSION_DENIED");
  await codeIs(Promise.resolve().then(()=>registry.requireGrant("docs","execute")),"PERMISSION_DENIED");
  assert.ok(Object.isFrozen(grants));assert.ok(Object.isFrozen(grants[0]));assert.ok(Object.isFrozen(grants[0]!.permissions));
}));

test("identical requests collapse in first-occurrence order and reenrollment keeps revision",async()=>fixture(async root=>{
  const work=await directory(root,"work"),ref=await directory(root,"ref"),other=await directory(root,"other"),registry=new WorkspaceRegistry();
  const first=await enroll(registry,[{id:"a",root:work,role:"workspace"},{id:"a",root:work,role:"workspace"},{id:"b",root:ref,role:"reference"}]);
  assert.deepEqual(first.map(x=>x.id),["a","b"]);assert.equal(first[0]!.revision,1);
  const second=await enroll(registry,[{id:"a",root:work,role:"workspace"}]);
  assert.equal(second[0]!.revision,1);
  await codeIs(enroll(registry,[{id:"ok",root:other,role:"reference"},{id:"x",root:work,role:"workspace"},{id:"x",root:ref,role:"reference"}]),"PERMISSION_DENIED");
  assert.deepEqual(registry.list().map(x=>x.id),["a","b"]);
  assert.equal((await enroll(registry,[{id:"a",root:work,role:"workspace"}]))[0]!.revision,1);
}));

test("invalid role, missing roots and non-directories reject atomically without consuming revisions",async()=>fixture(async root=>{
  const work=await directory(root,"work"),file=path.join(root,"file");await fs.writeFile(file,"x");
  const registry=new WorkspaceRegistry();
  await codeIs(enroll(registry,[{id:"kept",root:work,role:"workspace"},{id:"bad",root:work,role:"admin"} as unknown as RoleRequest]),"SOURCE_UNVERIFIED");
  await codeIs(enroll(registry,[{id:"kept",root:work,role:"workspace"},{id:"missing",root:path.join(root,"missing"),role:"reference"}]),"PATH_OUTSIDE_SCOPE");
  await codeIs(enroll(registry,[{id:"kept",root:work,role:"workspace"},{id:"file",root:file,role:"reference"}]),"PATH_OUTSIDE_SCOPE");
  assert.deepEqual(registry.list(),[]);
  assert.equal((await enroll(registry,[{id:"kept",root:work,role:"workspace"}]))[0]!.revision,1);
}));

test("sparse role request rejects atomically and does not consume a revision",async()=>fixture(async root=>{
  const existingRoot=await directory(root,"existing"),candidateRoot=await directory(root,"candidate"),registry=new WorkspaceRegistry();
  await enroll(registry,[{id:"existing",root:existingRoot,role:"workspace"}]);
  const prior=registry.get("existing");
  const sparse:RoleRequest[]=[{id:"candidate",root:candidateRoot,role:"workspace"}];sparse.length=2;
  await codeIs(enroll(registry,sparse),"SOURCE_UNVERIFIED");
  assert.equal(registry.get("existing"),prior);
  assert.deepEqual(registry.list().map(x=>x.id),["existing"]);
  const candidate=await enroll(registry,[{id:"candidate",root:candidateRoot,role:"workspace"}]);
  assert.equal(candidate[0]!.revision,1);
}));

test("role enrollment accepts one through sixteen entries and rejects empty or oversized batches atomically",async()=>fixture(async root=>{
  const roots=await Promise.all(Array.from({length:17},(_,i)=>directory(root,`root-${i}`))),registry=new WorkspaceRegistry();
  await codeIs(enroll(registry,[]),"SOURCE_UNVERIFIED");
  await codeIs(enroll(registry,roots.map((value,i)=>({id:`w${i}`,root:value,role:"workspace" as const}))),"SOURCE_UNVERIFIED");
  assert.deepEqual(registry.list(),[]);
  assert.equal((await enroll(registry,roots.slice(0,16).map((value,i)=>({id:`w${i}`,root:value,role:"workspace" as const})))).length,16);
}));

test("distinct IDs cannot select canonical or symlink aliases of the same directory",async()=>fixture(async root=>{
  const work=await directory(root,"work"),alias=path.join(root,"alias");await fs.symlink(work,alias,"dir");
  await codeIs(enroll(new WorkspaceRegistry(),[{id:"one",root:work,role:"workspace"},{id:"two",root:alias,role:"workspace"}]),"PERMISSION_DENIED");
}));

test("opposite-role nesting is rejected in both directions and against retained grants",async()=>fixture(async root=>{
  const parent=await directory(root,"parent"),child=await directory(parent,"child");
  await codeIs(enroll(new WorkspaceRegistry(),[{id:"w",root:parent,role:"workspace"},{id:"r",root:child,role:"reference"}]),"PERMISSION_DENIED");
  await codeIs(enroll(new WorkspaceRegistry(),[{id:"r",root:parent,role:"reference"},{id:"w",root:child,role:"workspace"}]),"PERMISSION_DENIED");
  const registry=new WorkspaceRegistry();await enroll(registry,[{id:"w",root:parent,role:"workspace"}]);
  await codeIs(enroll(registry,[{id:"r",root:child,role:"reference"}]),"PERMISSION_DENIED");
  assert.deepEqual(registry.list().map(x=>x.id),["w"]);
}));

test("legacy grants participate in overlap checks without acquiring inferred roles",async()=>fixture(async root=>{
  const parent=await directory(root,"parent"),child=await directory(parent,"child");
  const workspaceLegacy=new WorkspaceRegistry();
  const writeGrant=await workspaceLegacy.enrollTrusted("legacy-write",parent,["read","write"]);
  await codeIs(enroll(workspaceLegacy,[{id:"ref",root:child,role:"reference"}]),"PERMISSION_DENIED");
  assert.equal(roleOf(workspaceLegacy.get("legacy-write")!),undefined);
  assert.deepEqual(sorted(workspaceLegacy.get("legacy-write")!.permissions),["read","write"]);
  const referenceLegacy=new WorkspaceRegistry();await referenceLegacy.enrollTrusted("legacy-read",parent,["read"]);
  await codeIs(enroll(referenceLegacy,[{id:"work",root:child,role:"workspace"}]),"PERMISSION_DENIED");
  assert.equal(roleOf(referenceLegacy.get("legacy-read")!),undefined);
}));

test("same-role nesting is allowed and explicit reselection advances only the changed ID",async()=>fixture(async root=>{
  const parent=await directory(root,"parent"),child=await directory(parent,"child"),other=await directory(root,"other"),roleRoot=await directory(root,"role-root");
  const registry=new WorkspaceRegistry();await enroll(registry,[{id:"a",root:parent,role:"workspace"},{id:"b",root:child,role:"workspace"}]);
  const moved=await enroll(registry,[{id:"a",root:other,role:"workspace"}]);
  assert.equal(moved[0]!.revision,2);assert.equal(registry.get("b")!.revision,1);
  await codeIs(enroll(registry,[{id:"a",root:parent,role:"reference"}]),"PERMISSION_DENIED");
  assert.equal(registry.get("a")!.revision,2);
  const roleChanged=await enroll(registry,[{id:"a",root:roleRoot,role:"reference"}]);
  assert.equal(roleChanged[0]!.revision,3);assert.equal(roleOf(roleChanged[0]!),"reference");
  registry.revoke("a");
  const reenrolled=await enroll(registry,[{id:"a",root:other,role:"workspace"}]);
  assert.equal(reenrolled[0]!.revision,5);
}));

test("legacy role-less read and read/execute grants import without permission widening",async()=>fixture(async root=>{
  const readRoot=await directory(root,"read"),executeRoot=await directory(root,"execute");
  const source=new WorkspaceRegistry();
  const read=await source.enrollTrusted("read",readRoot,["read"]),execute=await source.enrollTrusted("execute",executeRoot,["read","execute"]);
  const restored=new WorkspaceRegistry();await restored.importTrusted(read);await restored.importTrusted(execute);
  assert.equal(roleOf(restored.get("read")!),undefined);assert.deepEqual(sorted(restored.get("read")!.permissions),["read"]);
  assert.equal(roleOf(restored.get("execute")!),undefined);assert.deepEqual(sorted(restored.get("execute")!.permissions),["execute","read"]);
  await codeIs(Promise.resolve().then(()=>restored.requireGrant("read","write")),"PERMISSION_DENIED");
}));

test("role imports reject inconsistent permission sets and preserve explicit epochs",async()=>fixture(async root=>{
  const work=await directory(root,"work"),registry=new WorkspaceRegistry();
  const [grant]=await enroll(registry,[{id:"w",root:work,role:"workspace"}]);
  const imported=new WorkspaceRegistry();await imported.importTrusted(grant!);
  assert.equal(roleOf(imported.get("w")!),"workspace");
  await codeIs(imported.importTrusted(withRole(grant!,"reference")),"SOURCE_UNVERIFIED");
  await codeIs(imported.importTrusted(withRole(grant!,undefined)),"SOURCE_UNVERIFIED");
  const higher={...grant!,revision:grant!.revision+1};await imported.importTrusted(higher);
  assert.equal(imported.get("w")!.revision,2);
  await codeIs(imported.importTrusted(grant!),"SOURCE_UNVERIFIED");
  imported.revoke("w");await codeIs(imported.importTrusted(higher),"SOURCE_UNVERIFIED");
}));

test("importTrusted rejects unknown or permission-inconsistent explicit role metadata",async()=>fixture(async root=>{
  const work=await directory(root,"work"),legacy=new WorkspaceRegistry();
  const readExecute=await legacy.enrollTrusted("legacy",work,["read","execute"]);
  await codeIs(new WorkspaceRegistry().importTrusted(withRole(readExecute,"reference")),"SOURCE_UNVERIFIED");
  await codeIs(new WorkspaceRegistry().importTrusted(withRole(readExecute,"admin")),"SOURCE_UNVERIFIED");
}));

test("deterministic enrollment interleaving preserves an unrelated concurrent grant",async()=>fixture(async root=>{
  const batchRoot=await directory(root,"batch"),otherRoot=await directory(root,"other"),registry=new WorkspaceRegistry();
  api(registry);
  const fsPatch=fs as unknown as {realpath:(...args:any[])=>Promise<any>};
  const original=fsPatch.realpath;let reached!:()=>void;const entered=new Promise<void>(resolve=>{reached=resolve;});
  let release!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;});
  fsPatch.realpath=async(...args:any[])=>{const value=await original.apply(fs,args);if(args[0]===batchRoot){reached();await hold;}return value;};
  try {
    const pending=enroll(registry,[{id:"batch",root:batchRoot,role:"workspace"}]);
    await entered;
    await registry.enrollTrusted("other",otherRoot,["read"]);
    release();await pending;
  } finally { release();fsPatch.realpath=original; }
  assert.deepEqual(registry.list().map(x=>x.id).sort(),["batch","other"]);
  assert.equal(registry.get("other")!.revision,1);
}));

test("revoking a pending explicit-role ID prevents its enrollment from publishing",async()=>fixture(async root=>{
  const pendingRoot=await directory(root,"pending"),registry=new WorkspaceRegistry();
  const fsPatch=fs as unknown as {realpath:(...args:any[])=>Promise<any>};
  const original=fsPatch.realpath;let reached!:()=>void;const entered=new Promise<void>(resolve=>{reached=resolve;});
  let release!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;});
  fsPatch.realpath=async(...args:any[])=>{const value=await original.apply(fs,args);if(args[0]===pendingRoot){reached();await hold;}return value;};
  try {
    const pending=enroll(registry,[{id:"pending-id",root:pendingRoot,role:"workspace"}]);
    await entered;
    registry.revoke("pending-id");
    release();
    await codeIs(pending,"SOURCE_UNVERIFIED");
  } finally { release();fsPatch.realpath=original; }
  assert.equal(registry.get("pending-id"),undefined);
  assert.deepEqual(registry.list(),[]);
}));

function snapshotApi(registry:WorkspaceRegistry):RoleRegistry {
  const value=registry as RoleRegistry;
  assert.equal(typeof value.replaceTrustedSnapshot,"function","WorkspaceRegistry must atomically apply a complete trusted snapshot");
  return value;
}
async function snapshot(registry:WorkspaceRegistry,grants:readonly WorkspaceGrant[]):Promise<readonly WorkspaceGrant[]> {
  return snapshotApi(registry).replaceTrustedSnapshot!(grants);
}
function explicit(grant:WorkspaceGrant,role:Role,revision=grant.revision):WorkspaceGrant {
  return {...grant,role,revision,permissions:Object.freeze(role==="workspace"?["read","write","execute"]:["read"])} as WorkspaceGrant;
}

test("trusted snapshot atomically transitions nested role pairs and updates original registry references",async()=>fixture(async root=>{
  const parent=await directory(root,"parent"),child=await directory(parent,"child");
  const source=new WorkspaceRegistry();
  const a=await source.enrollTrusted("a",parent,["read","write","execute"]);
  const b=await source.enrollTrusted("b",child,["read","write","execute"]);
  const live=new WorkspaceRegistry();await live.importTrusted(explicit(a,"workspace"));await live.importTrusted(explicit(b,"workspace"));
  const original=live;
  const next=await snapshot(live,[explicit(a,"reference",2),explicit(b,"reference",2)]);
  assert.equal(live,original);
  assert.deepEqual(live.list().map(g=>g.role),["reference","reference"]);
  assert.deepEqual(next.map(g=>g.id),["a","b"]);
  assert.ok(Object.isFrozen(next)&&Object.isFrozen(next[0])&&Object.isFrozen(next[0]!.permissions));
}));

test("trusted complete snapshot removes absent IDs, replaces stale aliases and revokes empty snapshots",async()=>fixture(async root=>{
  const oldRoot=await directory(root,"old"),replacement=await directory(root,"replacement"),other=await directory(root,"other");
  const source=new WorkspaceRegistry(),old=await source.enrollTrusted("old",oldRoot,["read"]),keep=await source.enrollTrusted("keep",other,["read"]);
  const registry=new WorkspaceRegistry();await registry.importTrusted(old);await registry.importTrusted(keep);
  const renamed=path.join(root,"old-moved");await fs.rename(oldRoot,renamed);await fs.symlink(replacement,oldRoot,"dir");
  const next=await snapshot(registry,[await source.enrollTrusted("fresh",replacement,["read"]).then(g=>explicit(g,"reference"))]);
  assert.deepEqual(next.map(g=>g.id),["fresh"]);
  assert.deepEqual(registry.list().map(g=>g.id),["fresh"]);
  const active=registry.get("fresh")!;
  assert.ok(active.revision>=1);
  assert.deepEqual(await snapshot(registry,[]),[]);
  assert.deepEqual(registry.list(),[]);
  await assert.rejects(Promise.resolve().then(()=>registry.importTrusted(explicit(active,"reference"))),(e:any)=>e.code==="SOURCE_UNVERIFIED");
}));

test("trusted snapshot rejects a malformed later grant and preserves active entries and epochs",async()=>fixture(async root=>{
  const aRoot=await directory(root,"a"),bRoot=await directory(root,"b"),cRoot=await directory(root,"c");
  const source=new WorkspaceRegistry(),a=await source.enrollTrusted("a",aRoot,["read"]),b=await source.enrollTrusted("b",bRoot,["read"]),c=await source.enrollTrusted("c",cRoot,["read"]);
  const registry=new WorkspaceRegistry();await registry.importTrusted(a);await registry.importTrusted(b);
  const before=registry.list();
  const malformedLater={...explicit(c,"workspace",2),permissions:Object.freeze(["read"])} as WorkspaceGrant;
  await assert.rejects(snapshot(registry,[explicit(a,"reference",2),malformedLater]),(e:any)=>e.code==="SOURCE_UNVERIFIED"||e.code==="PERMISSION_DENIED");
  assert.deepEqual(registry.list(),before);
  await assert.rejects(snapshot(registry,[a,explicit(a,"reference",2)]),(e:any)=>e.code==="SOURCE_UNVERIFIED"||e.code==="PERMISSION_DENIED");
  assert.equal(registry.get("a")!.revision,1);assert.equal(registry.get("b")!.revision,1);
}));

test("trusted snapshot rejects same-epoch changes and deterministic concurrent mutation",async()=>fixture(async root=>{
  const aRoot=await directory(root,"a"),pendingRoot=await directory(root,"pending"),otherRoot=await directory(root,"other");
  const source=new WorkspaceRegistry(),a=await source.enrollTrusted("a",aRoot,["read"]);
  const registry=new WorkspaceRegistry();await registry.importTrusted(explicit(a,"reference"));
  await assert.rejects(snapshot(registry,[explicit(a,"workspace",1)]),(e:any)=>e.code==="SOURCE_UNVERIFIED");
  const base=new WorkspaceRegistry(),grant=await base.enrollTrusted("pending",pendingRoot,["read"]);
  const fsPatch=fs as unknown as {realpath:(...args:any[])=>Promise<any>};
  const original=fsPatch.realpath;let reached!:()=>void;const entered=new Promise<void>(resolve=>{reached=resolve;});
  let release!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;});
  fsPatch.realpath=async(...args:any[])=>{const value=await original.apply(fs,args);if(args[0]===grant!.canonicalRoot){reached();await hold;}return value;};
  try {
    const pending=snapshot(registry,[explicit(grant,"reference")]);await entered;
    await registry.enrollTrusted("other",otherRoot,["read"]);
    release();await assert.rejects(pending,(e:any)=>e.code==="SOURCE_UNVERIFIED");
  } finally {release();fsPatch.realpath=original;}
  assert.deepEqual(registry.list().map(g=>g.id).sort(),["a","other"]);
}));
