import {test as platformTest} from "node:test";
const test=(name:string,fn:()=>void|Promise<void>)=>platformTest(name,{skip:process.platform==="win32"?"POSIX protected-state backend is unverified":false},fn);
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as grants from "../src/local/grants.js";
import type {WorkspaceGrant,WorkspaceRole,WorkspaceRoleRequest} from "../src/core/contracts.js";

type BatchResult={id:string;root:string;grant:WorkspaceGrant};
type RoleBatchApi=typeof grants&{enrollRolesTrustedBatch?:(requests:readonly WorkspaceRoleRequest[],dir?:string)=>Promise<BatchResult[]>};
function roleApi():RoleBatchApi {
  const api=grants as RoleBatchApi;
  assert.equal(typeof api.enrollRolesTrustedBatch,"function","protected grant store must expose enrollRolesTrustedBatch");
  return api;
}
function enroll(requests:readonly WorkspaceRoleRequest[],dir:string):Promise<BatchResult[]> {
  const method=roleApi().enrollRolesTrustedBatch!;
  return method.call(grants,requests,dir);
}
async function fixture(fn:(tmp:string,dir:string)=>Promise<void>):Promise<void>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-grants-roles-"));
  try{await fn(tmp,path.join(tmp,"identity"));}finally{await fs.rm(tmp,{recursive:true,force:true});}
}
async function mkdir(root:string,name:string):Promise<string>{const p=path.join(root,name);await fs.mkdir(p,{recursive:true});return p;}
async function bytes(dir:string):Promise<Buffer>{return fs.readFile(grants.grantPath(dir));}
async function rawStore(dir:string,entries:unknown):Promise<void>{
  await fs.mkdir(dir,{recursive:true,mode:0o700});await fs.chmod(dir,0o700);
  const file=grants.grantPath(dir);await fs.writeFile(file,JSON.stringify(entries)+"\n",{mode:0o600});await fs.chmod(file,0o600);
}
async function codeIs(promise:Promise<unknown>,code:string):Promise<void>{await assert.rejects(promise,(e:any)=>e?.code===code||e?.message===code);}
function role(grant:WorkspaceGrant):WorkspaceRole|undefined{return (grant as WorkspaceGrant&{role?:WorkspaceRole}).role;}
function sorted(values:readonly string[]):string[]{return [...values].sort();}
const workspacePerms=["execute","read","write"];

test("grant publication never removes a replacement writer lock",async()=>{
 const tmp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"gsa-grant-lock-owner-"))),dir=path.join(tmp,"identity"),work=await mkdir(tmp,"work");
 let passed=false;const lock=path.join(dir,".trusted-workspaces.lock");let replacementIdentity:{dev:bigint;ino:bigint}|undefined;
 try{
  await assert.rejects(grants.enrollRolesTrustedBatch([{id:"app",root:work,role:"workspace"}],dir,async()=>{
   const owned=await fs.lstat(lock,{bigint:true});
   await fs.rename(lock,path.join(dir,"retained-original-lock"));
   await fs.writeFile(lock,"replacement writer",{mode:0o600,flag:"wx"});
   const replacement=await fs.lstat(lock,{bigint:true});assert.notEqual(replacement.ino,owned.ino);replacementIdentity={dev:replacement.dev,ino:replacement.ino};
  }),(error:any)=>error?.code==="RESULT_UNKNOWN");
  assert.equal(await fs.readFile(lock,"utf8"),"replacement writer");
  const after=await fs.lstat(lock,{bigint:true});assert.equal(after.dev,replacementIdentity!.dev);assert.equal(after.ino,replacementIdentity!.ino);
  // Publication can have completed before lock release becomes uncertain.
  assert.equal((await grants.loadTrustedRegistry(dir)).requireGrant("app","write").role,"workspace");
  passed=true;
 }finally{if(passed)await fs.rm(tmp,{recursive:true,force:true});else console.error(`Preserved grant-lock fixture: ${tmp}`);}
});

test("mixed explicit roles survive reload with exact permissions and persisted workspace authorization",async()=>fixture(async(tmp,dir)=>{
  const work=await mkdir(tmp,"work"),ref=await mkdir(tmp,"reference");
  const saved=await enroll([{id:"app",root:work,role:"workspace"},{id:"manual",root:ref,role:"reference"}],dir);
  assert.deepEqual(saved.map(x=>x.id),["app","manual"]);assert.deepEqual(saved.map(x=>role(x.grant)),["workspace","reference"]);
  assert.deepEqual(saved.map(x=>sorted(x.grant.permissions)),[workspacePerms,["read"]]);
  const loaded=await grants.loadTrustedRegistry(dir);
  assert.equal(role(loaded.requireGrant("app","write")),"workspace");assert.equal(role(loaded.requireGrant("manual","read")),"reference");
  assert.throws(()=>loaded.requireGrant("manual","write"),/Permission not granted/);
  assert.throws(()=>loaded.requireGrant("manual","execute"),/Permission not granted/);
  const checked=await grants.requirePersistedGrant(loaded,"app",dir);assert.equal(role(checked),"workspace");assert.deepEqual(sorted(checked.permissions),workspacePerms);
}));

test("BUG-01: sibling roots bind, while a true ancestor grant is reported without mutation",async()=>fixture(async(tmp,dir)=>{
  const parent=await mkdir(tmp,"Kid eschool"),work=await mkdir(parent,"Ke-chinhta"),ref=await mkdir(parent,"KE-dictation");
  await fs.writeFile(path.join(ref,"README.md"),"reference read only\n");
  await enroll([{id:"legacy-parent",root:parent,role:"workspace"}],dir);
  const before=await bytes(dir);
  await assert.rejects(enroll([{id:"work",root:work,role:"workspace"},{id:"ref",root:ref,role:"reference"}],dir),(error:any)=>
    error?.code==="PERMISSION_DENIED"&&error.message.includes("legacy-parent")&&error.message.includes(parent)&&error.message.includes("ref")&&error.message.includes(ref));
  assert.deepEqual(await bytes(dir),before,"failed bind must be atomic");
  await grants.revokeTrusted("legacy-parent",dir); // Test fixture only; never revoke a live grant automatically.
  const bound=await enroll([{id:"work",root:work,role:"workspace"},{id:"ref",root:ref,role:"reference"}],dir);
  assert.deepEqual(bound.map(v=>v.id),["work","ref"]);
  const registry=await grants.loadTrustedRegistry(dir);
  assert.equal(await fs.readFile(await registry.resolveExistingRead("ref","README.md"),"utf8"),"reference read only\n");
  assert.throws(()=>registry.requireGrant("ref","write"),{code:"PERMISSION_DENIED"});
  const outside=await mkdir(tmp,"not-granted");await fs.symlink(outside,path.join(ref,"escape"));
  await assert.rejects(registry.resolveExistingRead("ref","escape"),{code:"PATH_OUTSIDE_SCOPE"});
}));

test("BUG-01: lexical path prefixes are not mistaken for ancestry",async()=>fixture(async(tmp,dir)=>{
  const work=await mkdir(tmp,"Ke-chinhta"),ref=await mkdir(tmp,"Ke-chinhta-backup");
  const result=await enroll([{id:"work",root:work,role:"workspace"},{id:"ref",root:ref,role:"reference"}],dir);
  assert.equal(result.length,2);
}));
test("legacy pinned grants remain role-less and explicit selection alone promotes with a new epoch",async()=>fixture(async(tmp,dir)=>{
  const readRoot=await mkdir(tmp,"read"),execRoot=await mkdir(tmp,"exec"),promotedRoot=await mkdir(tmp,"promoted");
  await grants.enrollReadOnly("read",readRoot,dir);await grants.enrollExecute("exec",execRoot,dir);await grants.enrollReadOnly("promote",promotedRoot,dir);
  let loaded=await grants.loadTrustedRegistry(dir);
  assert.equal(role(loaded.get("read")!),undefined);assert.deepEqual(sorted(loaded.get("read")!.permissions),["read"]);
  assert.equal(role(loaded.get("exec")!),undefined);assert.deepEqual(sorted(loaded.get("exec")!.permissions),["execute","read"]);
  const entries=JSON.parse((await bytes(dir)).toString("utf8"));entries.push({id:"legacy-unpinned",root:path.join(tmp,"old"),permissions:["read","write","execute"]});
  await rawStore(dir,entries);loaded=await grants.loadTrustedRegistry(dir);assert.equal(loaded.get("legacy-unpinned"),undefined);
  const [promoted]=await enroll([{id:"promote",root:promotedRoot,role:"workspace"}],dir);
  assert.equal(promoted!.grant.revision,2);assert.equal(role((await grants.loadTrustedRegistry(dir)).get("promote")!),"workspace");
  await assert.rejects(grants.enrollReadOnly("promote",promotedRoot,dir));
  await assert.rejects(grants.enrollExecute("promote",promotedRoot,dir));
  assert.equal(role((await grants.loadTrustedRegistry(dir)).get("promote")!),"workspace");
}));

test("duplicate explicit selections collapse, repeat idempotently, and revoked roles retain their epoch",async()=>fixture(async(tmp,dir)=>{
  const root=await mkdir(tmp,"root"),other=await mkdir(tmp,"other");
  const first=await enroll([{id:"a",root,role:"workspace"},{id:"a",root,role:"workspace"}],dir);
  assert.equal(first.length,1);assert.equal(first[0]!.grant.revision,1);
  assert.equal((await enroll([{id:"a",root,role:"workspace"}],dir))[0]!.grant.revision,1);
  const changed=await enroll([{id:"a",root:other,role:"reference"}],dir);assert.equal(changed[0]!.grant.revision,2);
  await grants.revokeTrusted("a",dir);
  const tombstone=JSON.parse((await bytes(dir)).toString("utf8")).find((x:any)=>x.id==="a");
  assert.equal(tombstone.revoked,true);assert.equal(tombstone.role,"reference");assert.equal(tombstone.revision,3);assert.deepEqual(tombstone.permissions,[]);
  assert.equal((await grants.loadTrustedRegistry(dir)).get("a"),undefined);
  const reenrolled=await enroll([{id:"a",root,role:"workspace"}],dir);assert.equal(reenrolled[0]!.grant.revision,4);
  const before=await bytes(dir);const entries=JSON.parse(before.toString("utf8"));entries[0].revision=Number.MAX_SAFE_INTEGER;entries[0].rootIdentity={device:"0",inode:"0"};
  await rawStore(dir,entries);const overflowBytes=await bytes(dir);
  await assert.rejects(enroll([{id:"a",root,role:"workspace"}],dir));assert.deepEqual(await bytes(dir),overflowBytes);
}));

test("failed role batches preserve exact store bytes and allow same-role nested roots",async()=>fixture(async(tmp,dir)=>{
  const parent=await mkdir(tmp,"parent"),child=await mkdir(parent,"child"),other=await mkdir(tmp,"other"),file=path.join(tmp,"file");await fs.writeFile(file,"x");
  await enroll([{id:"base",root:parent,role:"workspace"}],dir);const original=await bytes(dir);
  const alias=path.join(tmp,"alias");await fs.symlink(parent,alias,"dir");
  const invalidRole={id:"bad",root:other,role:"admin"} as unknown as WorkspaceRoleRequest;
  const cases:readonly WorkspaceRoleRequest[][]=[
    [{id:"prefix",root:other,role:"workspace"},invalidRole],
    [{id:"prefix",root:other,role:"workspace"},{id:"missing",root:path.join(tmp,"missing"),role:"reference"}],
    [{id:"same",root:other,role:"workspace"},{id:"same",root:child,role:"workspace"}],
    [{id:"alias",root:alias,role:"workspace"}],
    [{id:"prefix",root:other,role:"workspace"},{id:"nested",root:child,role:"reference"}],
    [{id:"file",root:file,role:"workspace"}]
  ];
  for(const batch of cases){await assert.rejects(enroll(batch,dir));assert.deepEqual(await bytes(dir),original);assert.deepEqual((await grants.loadTrustedRegistry(dir)).list().map(x=>x.id),["base"]);}
  await assert.rejects(grants.enrollReadOnly("legacy-nested",child,dir));assert.deepEqual(await bytes(dir),original);
  const refParent=await mkdir(tmp,"reference-parent"),refChild=await mkdir(refParent,"child"),otherStore=path.join(tmp,"reference-identity");
  await enroll([{id:"base-ref",root:refParent,role:"reference"}],otherStore);const refBytes=await bytes(otherStore);
  await assert.rejects(enroll([{id:"prefix",root:other,role:"reference"},{id:"nested-work",root:refChild,role:"workspace"}],otherStore));
  assert.deepEqual(await bytes(otherStore),refBytes);assert.deepEqual((await grants.loadTrustedRegistry(otherStore)).list().map(x=>x.id),["base-ref"]);
  const nested=await enroll([{id:"nested-work",root:child,role:"workspace"}],dir);
  assert.equal(nested.length,1);
}));

test("role batch capacity counts active grants before publication",async()=>fixture(async(tmp,dir)=>{
  const active=[];
  for(let i=0;i<128;i++){
   const root=await fs.realpath(await mkdir(tmp,`active-${i}`)),stat=await fs.stat(root,{bigint:true});
   active.push({id:`active-${i}`,root,permissions:["read","write","execute"],rootIdentity:{device:String(stat.dev),inode:String(stat.ino)},revision:1,role:"workspace"});
  }
  await rawStore(dir,active);const before=await bytes(dir),root=await mkdir(tmp,"candidate");
  await assert.rejects(enroll([{id:"candidate",root,role:"workspace"}],dir));
  assert.deepEqual(await bytes(dir),before);
}));

test("final-set root swaps succeed while stale selected roots can be explicitly replaced",async()=>fixture(async(tmp,dir)=>{
  const a=await mkdir(tmp,"a"),b=await mkdir(tmp,"b");await enroll([{id:"A",root:a,role:"workspace"},{id:"B",root:b,role:"workspace"}],dir);
  const swapped=await enroll([{id:"A",root:b,role:"workspace"},{id:"B",root:a,role:"workspace"}],dir);
  assert.deepEqual(swapped.map(x=>x.root),[await fs.realpath(b),await fs.realpath(a)]);
  assert.deepEqual(swapped.map(x=>x.grant.revision),[2,2]);
  await fs.rename(a,a+"-old");await fs.mkdir(a);
  assert.deepEqual((await grants.loadTrustedRegistry(dir)).list().map(g=>g.id),["A"],"the replaced B pin is not ACTIVE");
  const repaired=await enroll([{id:"B",root:a,role:"workspace"}],dir);assert.equal(repaired[0]!.grant.revision,3);
  const [c]=await enroll([{id:"C",root:await mkdir(tmp,"c"),role:"workspace"}],dir);
  await fs.rename(b,b+"-old");await fs.mkdir(b);
  const before=JSON.parse((await bytes(dir)).toString("utf8"));
  const independent=await enroll([{id:"C",root:await fs.realpath(c!.root),role:"reference"}],dir);
  assert.equal(independent[0]!.grant.role,"reference","another stale root cannot block a separate valid root");
  const current=JSON.parse((await bytes(dir)).toString("utf8"));
  const priorB=(Array.isArray(before)?before:before.entries).find((x:any)=>x.id==="A");
  const afterB=(Array.isArray(current)?current:current.entries).find((x:any)=>x.id==="A");
  assert.deepEqual(afterB,priorB,"unrelated stale pin remains durable and unchanged");
}));

test("malformed explicit entries fail closed and tombstones need no live root",async()=>fixture(async(tmp,dir)=>{
  const root=await mkdir(tmp,"root"),other=await mkdir(tmp,"other");
  await enroll([{id:"ok",root,role:"workspace"}],dir);const good=JSON.parse((await bytes(dir)).toString("utf8"))[0];
  const otherStat=await fs.stat(other,{bigint:true});
  const second={id:"bad",root:other,permissions:workspacePerms,rootIdentity:{device:String(otherStat.dev),inode:String(otherStat.ino)},revision:1,role:"workspace"};
  const badEntries=[
    {...second,role:"admin"},
    {...second,rootIdentity:undefined},
    {...second,permissions:["read"]},
    {...second,revoked:true,permissions:["read"]}
  ];
  for(const bad of badEntries){await rawStore(dir,[good,bad]);await assert.rejects(grants.loadTrustedRegistry(dir),/INVALID_GRANT_STORE/);}
  const tombstone={...good,id:"gone",root:path.join(tmp,"removed"),revoked:true,permissions:[],revision:2};
  await rawStore(dir,[tombstone]);assert.deepEqual((await grants.loadTrustedRegistry(dir)).list(),[]);
  const newRoot=await mkdir(tmp,"removed");const [restored]=await enroll([{id:"gone",root:newRoot,role:"workspace"}],dir);
  assert.equal(restored!.grant.revision,3);
}));

test("same-epoch persisted role downgrade invalidates live authorization",async()=>fixture(async(tmp,dir)=>{
  const root=await mkdir(tmp,"root");await enroll([{id:"app",root,role:"workspace"}],dir);
  const live=await grants.loadTrustedRegistry(dir),entries=JSON.parse((await bytes(dir)).toString("utf8"));
  delete entries[0].role;await rawStore(dir,entries);
  await codeIs(grants.requirePersistedGrant(live,"app",dir),"WORKSPACE_GRANT_CHANGED");
}));

test("revocation succeeds with an unrelated stale root",async()=>fixture(async(tmp,dir)=>{
  const rootA=await mkdir(tmp,"A"),rootB=await mkdir(tmp,"B");
  await enroll([{id:"A",root:rootA,role:"workspace"},{id:"B",root:rootB,role:"workspace"}],dir);
  const liveA=await grants.loadTrustedRegistry(dir),before=JSON.parse((await bytes(dir)).toString("utf8"));
  const oldA=before.find((entry:any)=>entry.id==="A"),oldB=before.find((entry:any)=>entry.id==="B");
  await fs.rename(rootB,rootB+"-removed");
  await grants.revokeTrusted("A",dir);
  const after=JSON.parse((await bytes(dir)).toString("utf8"));
  const tombstone=after.find((entry:any)=>entry.id==="A"),retainedB=after.find((entry:any)=>entry.id==="B");
  assert.equal(tombstone.revoked,true);assert.equal(tombstone.role,"workspace");
  assert.deepEqual(tombstone.permissions,[]);assert.equal(tombstone.revision,oldA.revision+1);
  assert.deepEqual(retainedB,oldB);
  await codeIs(grants.requirePersistedGrant(liveA,"A",dir),"WORKSPACE_GRANT_REVOKED");
}));

test("prepublication failure preserves store bytes and releases the lock",async()=>fixture(async(tmp,dir)=>{
  const root=await mkdir(tmp,"root"),other=await mkdir(tmp,"other");await enroll([{id:"base",root,role:"workspace"}],dir);const before=await bytes(dir);
  const fsPatch=fs as unknown as {rename:(old:string,next:string)=>Promise<void>};const original=fsPatch.rename;
  fsPatch.rename=async(old,next)=>{if(next===grants.grantPath(dir))throw Error("injected before rename");return original.call(fs,old,next);};
  try{await assert.rejects(enroll([{id:"next",root:other,role:"reference"}],dir),/injected before rename/);}finally{fsPatch.rename=original;}
  assert.deepEqual(await bytes(dir),before);await assert.rejects(fs.lstat(path.join(dir,".trusted-workspaces.lock")),{code:"ENOENT"});
}));

test("postrename directory-sync failure reports RESULT_UNKNOWN with complete readable publication",async()=>fixture(async(tmp,dir)=>{
  const root=await mkdir(tmp,"root"),other=await mkdir(tmp,"other");await enroll([{id:"base",root,role:"workspace"}],dir);
  const fsPatch=fs as unknown as {open:(file:string,...args:any[])=>Promise<any>};const original=fsPatch.open;let renames=0;
  const renamePatch=fs as unknown as {rename:(old:string,next:string)=>Promise<void>};const originalRename=renamePatch.rename;
  renamePatch.rename=async(old,next)=>{if(next===grants.grantPath(dir))renames++;return originalRename.call(fs,old,next);};
  fsPatch.open=async(file,...args)=>{
    const handle=await original.call(fs,file,...args);
    if(file!==dir)return handle;
    return new Proxy(handle,{get(target,key){if(key==="sync")return async()=>{throw Error("injected postrename sync failure");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
  };
  try{await codeIs(enroll([{id:"next",root:other,role:"reference"}],dir),"RESULT_UNKNOWN");}
  finally{fsPatch.open=original;renamePatch.rename=originalRename;}
  assert.equal(renames,1);const loaded=await grants.loadTrustedRegistry(dir);
  assert.equal(role(loaded.get("base")!),"workspace");assert.equal(role(loaded.get("next")!),"reference");
  await assert.rejects(fs.lstat(path.join(dir,".trusted-workspaces.lock")),{code:"ENOENT"});
}));

test("stale-root repair revokes only replaced inode and preserves valid grants and history",async()=>fixture(async(tmp,dir)=>{
 const old=await mkdir(tmp,"old"),work=await mkdir(tmp,"work"),ref=await mkdir(tmp,"reference");
 await enroll([{id:"legacy-stale",root:old,role:"workspace"},{id:"work",root:work,role:"workspace"},{id:"reference",root:ref,role:"reference"}],dir);
 const before=JSON.parse((await bytes(dir)).toString());const entries=Array.isArray(before)?before:before.entries;
 const stable=entries.filter((e:any)=>e.id!=="legacy-stale");
 await fs.rename(old,old+"-original");await fs.mkdir(old);
 assert.deepEqual((await grants.loadTrustedRegistry(dir)).list().map(g=>g.id).sort(),["reference","work"],"stale pin is excluded from ACTIVE grant set");
 assert.deepEqual((await grants.inspectStaleTrustedRoots(dir)).map(x=>x.id),["legacy-stale"]);
 const outcome=await grants.revokeStaleTrustedRoots(dir);
 assert.deepEqual(outcome.revoked.map(x=>x.id),["legacy-stale"]);assert.equal(outcome.retained,2);
 const repaired=JSON.parse((await bytes(dir)).toString());const after=Array.isArray(repaired)?repaired:repaired.entries;
 assert.deepEqual(after.filter((e:any)=>e.id!=="legacy-stale"),stable);
 const tomb=after.find((e:any)=>e.id==="legacy-stale");assert.equal(tomb.revoked,true);
 assert.deepEqual(tomb.permissions,[]);assert.ok(tomb.revision>entries.find((e:any)=>e.id==="legacy-stale").revision);
 const loaded=await grants.loadTrustedRegistry(dir);assert.deepEqual(loaded.list().map(x=>x.id).sort(),["reference","work"]);
 assert.equal((await grants.revokeStaleTrustedRoots(dir)).revoked.length,0);
 assert.deepEqual((await grants.inspectStaleTrustedRoots(dir)),[]);
}));
test("stale-root repair revokes missing pinned root while preserving other selected roots",async()=>fixture(async(tmp,dir)=>{
 const old=await mkdir(tmp,"old"),work=await mkdir(tmp,"work");await enroll([{id:"lost",root:old,role:"reference"},{id:"work",root:work,role:"workspace"}],dir);
 await fs.rename(old,old+"-renamed");
 assert.deepEqual((await grants.inspectStaleTrustedRoots(dir)).map(x=>x.id),["lost"]);
 const outcome=await grants.revokeStaleTrustedRoots(dir);assert.deepEqual(outcome.revoked.map(x=>x.id),["lost"]);
 assert.equal((await grants.loadTrustedRegistry(dir)).list()[0]?.id,"work");
}));

test("explicit stale grant retirement is atomic and cannot remove a valid reference",async()=>fixture(async(tmp,dir)=>{
 const work=await mkdir(tmp,"work"),stale=await mkdir(tmp,"stale"),ref=await mkdir(tmp,"reference");
 await enroll([{id:"work",root:work,role:"workspace"},{id:"old",root:stale,role:"workspace"},{id:"ref",root:ref,role:"reference"}],dir);
 await fs.rename(stale,stale+"-old");await fs.mkdir(stale);
 const before=await bytes(dir);
 await assert.rejects(grants.enrollRolesTrustedBatch([{id:"work",root:work,role:"workspace"}],dir,undefined,["ref"]),{code:"PERMISSION_DENIED"});
 assert.deepEqual(await bytes(dir),before);
 await grants.enrollRolesTrustedBatch([{id:"work",root:work,role:"workspace"}],dir,undefined,["old"]);
 assert.equal((await grants.inspectTrustedWorkspaceRecovery(dir)).find(x=>x.workspace_id==="old")?.state,"REVOKED");
 assert.deepEqual((await grants.loadTrustedRegistry(dir)).list().map(x=>x.id).sort(),["ref","work"]);
}));
test("stale-root repair is a no-op when all identities match",async()=>fixture(async(tmp,dir)=>{
 const root=await mkdir(tmp,"work");await enroll([{id:"work",root,role:"workspace"}],dir);
 const original=await bytes(dir),result=await grants.revokeStaleTrustedRoots(dir);
 assert.deepEqual(result,{revoked:[],retained:1});assert.deepEqual(await bytes(dir),original);
}));
