import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash,createHmac} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {loadMacVmRuntime,validateMacVmInstallBody,filterMacVmSourceSnapshot,MAC_VM_REQUIRED_CHECKS,MAC_VM_IMAGE_SHA256} from "../src/hosts/macos-vm-runtime.js";

function body(){return {format:"gsa-native-vm-v1",platform:"darwin",arch:"arm64",hostRelease:os.release(),imagePath:"/private/pinned.raw",imageSHA256:MAC_VM_IMAGE_SHA256,imageBytes:3758096384,artifacts:Object.fromEntries(["bin/worker-host","bin/source-capture","scripts/prepare-vm-worker-seed.py","native/macos-vm/guest_worker.py"].map(n=>[n,"a".repeat(64)])),checks:[...MAC_VM_REQUIRED_CHECKS]};}
test("VM install requires complete native controls and exact host/image binding",()=>{
 const valid=body();assert.equal(validateMacVmInstallBody(valid).imageBytes,3758096384);
 for(const bad of [{...valid,checks:valid.checks.slice(1)},{...valid,hostRelease:"different"},{...valid,platform:"linux"},{...valid,arch:"x64"},{...valid,imageSHA256:"b".repeat(64)},{...valid,imagePath:"/a/../pinned.raw"},{...valid,imagePath:"C:\\private\\pinned.raw"},{...valid,imagePath:"\\\\server\\share\\pinned.raw"},{...valid,imageBytes:1},{...valid,artifacts:{}}])assert.throws(()=>validateMacVmInstallBody(bad),/SECURITY_BLOCKED/);
});
function entry(name:string,text="hello"){const bytes=Buffer.from(text);return {path:name,base64:bytes.toString("base64"),size:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),executable:false};}
test("source validation checks bytes and removes host credential paths before guest seeding",()=>{
 const files=[entry("app.py"),entry(".env"),entry("nested/.env.production"),entry(".npmrc"),entry(".pypirc"),entry(".git-credentials"),entry("nested/.ssh/id_rsa"),entry("nested/.ENV.test")];
 const snapshot={protocolVersion:"gsa-source-capture-v1",state:"CAPTURED",canonicalRoot:"/project",files,totalBytes:40,securityVerified:false};
 const filtered=filterMacVmSourceSnapshot(snapshot,"/project");
 assert.deepEqual(filtered.files,[entry("app.py")]);assert.equal(filtered.totalBytes,5);
 for(const bad of [{...snapshot,canonicalRoot:"/other"},{...snapshot,files:[entry("../escape")]},{...snapshot,files:[{...entry("ok"),sha256:"a".repeat(64)}]},{...snapshot,files:[{...entry("ok"),base64:"?"}]},{...snapshot,files:[entry("A"),entry("a")]},{...snapshot,files:[{...entry("ok"),executable:"yes"}]}])assert.throws(()=>filterMacVmSourceSnapshot(bad,"/project"));
});
test("signed manifest and artifact tampering fail before any helper can run",{skip:process.platform!=="darwin"||process.arch!=="arm64"},async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"gsa-runtime-proof-")));await fs.chmod(root,0o700);
 try{
  const key=Buffer.alloc(32,0x12);await fs.writeFile(path.join(root,"native-proof-key"),key,{mode:0o600});
  // Synthetic trusted installation: sparse pinned-size image, inert artifacts.
  // Loading validates installation data only; these fixtures never execute a VM.
  const proof=body();proof.imagePath=path.join(root,"image.raw");
  const image=await fs.open(proof.imagePath,"wx",0o600);await image.truncate(3758096384);await image.close();
  for(const name of Object.keys(proof.artifacts)){await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true,mode:0o700});await fs.writeFile(path.join(root,name),"inert-fixture",{mode:0o700});proof.artifacts[name]=createHash("sha256").update("inert-fixture").digest("hex");}
  const data=JSON.stringify(proof);const manifest={body:data,hmac:createHmac("sha256",key).update(data).digest("hex")};
  await fs.writeFile(path.join(root,"install.json"),JSON.stringify({...manifest,hmac:"0".repeat(64)}),{mode:0o600});
  await assert.rejects(loadMacVmRuntime(new WorkspaceRegistry(),root),/installation signature/);
  await fs.writeFile(path.join(root,"install.json"),JSON.stringify(manifest));
  const runtime=await loadMacVmRuntime(new WorkspaceRegistry(),root);assert.match(runtime.sandbox.policy_fingerprint,/^[a-f0-9]{64}$/);
  const project=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"gsa-runtime-auth-")));
  try{
   const registry=new WorkspaceRegistry();await registry.enrollTrusted("fixture",project,["read","execute"]);
   let authorizationChecks=0;
   const guarded=await loadMacVmRuntime(registry,root,{authorize:async()=>{if(++authorizationChecks%2===0)throw Error("revoked fixture controller");}});
   const request={workspace_id:"fixture",executable:"/usr/bin/python3",argv:["-c","print(1)"],cwd_relative:".",time_limit_ms:1000,max_output_bytes:1024,network_allowed:false};
   // Every request loses authorization before touching a helper. Terminal
   // history must stay bounded without becoming a permanent lifetime quota.
   for(let index=0;index<130;index++){
    const {native_id}=await guarded.processes.start(request);
    await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal((await guarded.processes.status(native_id)).state,"UNKNOWN");
   }
   assert.equal(authorizationChecks,260);
  }finally{await fs.rm(project,{recursive:true,force:true});}
  await fs.writeFile(path.join(root,"bin/worker-host"),"tampered");
  await assert.rejects(loadMacVmRuntime(new WorkspaceRegistry(),root),/artifact digest/);
  await fs.writeFile(path.join(root,"bin/worker-host"),"inert-fixture");
  await fs.chmod(path.join(root,"install.json"),0o644);
  await assert.rejects(loadMacVmRuntime(new WorkspaceRegistry(),root),/unsafe installation permissions/);
  await fs.chmod(path.join(root,"install.json"),0o600);await fs.unlink(path.join(root,"bin/source-capture"));await fs.symlink("worker-host",path.join(root,"bin/source-capture"));
  await assert.rejects(loadMacVmRuntime(new WorkspaceRegistry(),root),/unsafe installation permissions/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
