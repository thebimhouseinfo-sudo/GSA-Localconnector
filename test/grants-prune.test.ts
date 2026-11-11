import {test as platformTest} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  enrollRolesTrustedBatch,inspectTrustedWorkspaceRecovery,loadTrustedRegistry,
  pruneInactiveWorkspaceRegistrations,revokeTrusted,grantPath
} from "../src/local/grants.js";

const test=(name:string,fn:()=>Promise<void>)=>
  platformTest(name,{skip:process.platform==="win32"?"Protected-state POSIX fixture; Windows ACL backend unverified":false},fn);

test("menu cleanup compacts STALE and REVOKED history without touching active grants or user data",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-prune-grants-"));
 try{
  const identity=path.join(tmp,"identity"),active=path.join(tmp,"active"),stale=path.join(tmp,"stale"),revoked=path.join(tmp,"revoked");
  for(const root of [active,stale,revoked])await fs.mkdir(root,{mode:0o700});
  await fs.writeFile(path.join(active,"KEEP.txt"),"contents must survive cleanup");
  await enrollRolesTrustedBatch([
   {id:"current",root:active,role:"workspace"},
   {id:"old-stale",root:stale,role:"workspace"},
   {id:"old-revoked",root:revoked,role:"reference"}
  ],identity);
  const saved=(await loadTrustedRegistry(identity)).requireGrant("current","write");
  await revokeTrusted("old-revoked",identity);
  await fs.rename(stale,stale+"-moved");
  const before=await inspectTrustedWorkspaceRecovery(identity);
  assert.deepEqual(before.map(x=>x.state),["ACTIVE","STALE","REVOKED"]);
  const result=await pruneInactiveWorkspaceRegistrations(identity);
  assert.deepEqual(result,{removed_stale:1,removed_revoked:1,retained_active:1,retained_reauth_required:0});
  const after=await inspectTrustedWorkspaceRecovery(identity);
  assert.deepEqual(after.map(x=>x.workspace_id),["current"]);
  const live=(await loadTrustedRegistry(identity)).requireGrant("current","write");
  assert.equal(live.revision,saved.revision);
  assert.deepEqual(live.rootIdentity,saved.rootIdentity);
  assert.equal(await fs.readFile(path.join(active,"KEEP.txt"),"utf8"),"contents must survive cleanup");
  assert.equal((await pruneInactiveWorkspaceRegistrations(identity)).removed_stale,0,"second invocation is idempotent");
  await fs.mkdir(stale,{mode:0o700});
  const next=await enrollRolesTrustedBatch([{id:"old-stale",root:stale,role:"workspace"}],identity);
  assert.ok(next[0]!.grant.revision>before.find(x=>x.workspace_id==="old-stale")!.revision!,"recycled ID cannot inherit old generation");
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

test("cleanup with only ACTIVE roots performs no write and preserves sealed grant bytes",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-prune-active-only-"));
 try{
  const identity=path.join(tmp,"identity"),root=path.join(tmp,"active");await fs.mkdir(root);
  await enrollRolesTrustedBatch([{id:"live",root,role:"reference"}],identity);
  const before=await fs.readFile(grantPath(identity));
  const result=await pruneInactiveWorkspaceRegistrations(identity);
  assert.deepEqual(result,{removed_stale:0,removed_revoked:0,retained_active:1,retained_reauth_required:0});
  assert.deepEqual(await fs.readFile(grantPath(identity)),before);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

test("cleanup refuses unsafe grant storage rather than silently discarding registrations",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-prune-unsafe-"));
 try{
  const identity=path.join(tmp,"identity"),root=path.join(tmp,"work");await fs.mkdir(root);
  await enrollRolesTrustedBatch([{id:"live",root,role:"workspace"}],identity);
  const store=grantPath(identity),bytes=await fs.readFile(store);
  await fs.chmod(store,0o644);
  await assert.rejects(pruneInactiveWorkspaceRegistrations(identity),/UNSAFE_GRANT_STORE/);
  assert.deepEqual(await fs.readFile(store),bytes);
  await fs.chmod(store,0o600);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
