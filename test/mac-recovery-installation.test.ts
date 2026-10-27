import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash,createHmac} from "node:crypto";
import {test} from "node:test";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {loadCheckedMacRecoveryInstallation,type RecoveryInstallationIO} from "../src/hosts/macos-recovery-installation.js";
import {macFileRecoveryActivation} from "../src/hosts/macos-scoped-files.js";
import {receiptSample} from "./helpers/mac-file-evidence-fixture.js";
const digest=(b:Uint8Array|string)=>createHash("sha256").update(b).digest("hex");
const artifactNames=["Contents/MacOS/recovery-broker","Contents/Info.plist","Contents/_CodeSignature/CodeResources"];
const baseArtifactNames=["Contents/MacOS/broker","Contents/Info.plist","Contents/_CodeSignature/CodeResources"];
async function fixture(t:any,options:{installationInsideWork?:boolean;peerRecovery?:boolean;peerReference?:boolean;referenceRecovery?:boolean}={}){
 const base=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"gsa-recovery-install-")));
 t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const work=path.join(base,"work"),peer=path.join(base,"peer"),recovery=options.peerRecovery?path.join(peer,"private-recovery"):path.join(base,"recovery"),installation=options.installationInsideWork?path.join(work,"installation"):path.join(base,"installation");
 await fs.mkdir(work,{mode:0o700});if(options.peerRecovery||options.peerReference)await fs.mkdir(peer,{mode:0o700});await fs.mkdir(recovery,{mode:0o700});await fs.mkdir(installation,{recursive:true,mode:0o700});
 const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:"work",root:work,role:"workspace"},...(options.peerReference?[{id:"peer",root:peer,role:"reference" as const}]:[])]);const grants=registry.list(),grant=grants.find(g=>g.id==="work")!;
 const rs=await fs.stat(recovery,{bigint:true}),recoveryIdentity={device:String(rs.dev),inode:String(rs.ino)};
 const app=path.join(installation,"work/RecoveryBroker.app"),baseApps=new Map<string,string>();
 for(const b of grants){const baseApp=path.join(installation,b.id,"Broker.app");baseApps.set(b.id,baseApp);for(const relative of [b.id,path.join(b.id,"Broker.app"),path.join(b.id,"Broker.app/Contents"),path.join(b.id,"Broker.app/Contents/MacOS"),path.join(b.id,"Broker.app/Contents/_CodeSignature")])await fs.mkdir(path.join(installation,relative),{recursive:true,mode:0o700});}
 for(const relative of ["work/RecoveryBroker.app","work/RecoveryBroker.app/Contents","work/RecoveryBroker.app/Contents/MacOS","work/RecoveryBroker.app/Contents/_CodeSignature"])await fs.mkdir(path.join(installation,relative),{mode:0o700});
 const info:any={CFBundleExecutable:"recovery-broker",GSARecoveryProtocol:"gsa-file-recovery-v1",GSAWorkspaceRoot:work,GSARecoveryRoot:recovery,GSAWorkspaceID:"work",GSARevision:grant.revision,GSADevice:grant.rootIdentity.device,GSAInode:grant.rootIdentity.inode,GSARecoveryDevice:recoveryIdentity.device,GSARecoveryInode:recoveryIdentity.inode};
 const entitlements:any={"com.apple.security.app-sandbox":true,"com.apple.security.temporary-exception.files.absolute-path.read-write":[work+"/",recovery+"/"]};
 const artifacts:Record<string,string>={};
 for(const name of artifactNames){const value=name.endsWith("Info.plist")?JSON.stringify(info):"disposable fixture "+name;await fs.writeFile(path.join(app,name),value,{mode:0o600});artifacts[name]=digest(value);}
 const evidence=receiptSample(os.release(),"arm64"),build=structuredClone(evidence.build);
 const proofGrants:any[]=[];
 for(const b of grants){
  const appRoot=baseApps.get(b.id)!,baseArtifacts:Record<string,string>={};
  for(const name of baseArtifactNames){const value=`base ${b.id} ${name}`,full=path.join(appRoot,name);await fs.writeFile(full,value,{mode:0o600,flag:"wx"});baseArtifacts[name]=digest(value);}
  proofGrants.push({id:b.id,role:b.role,root:b.canonicalRoot,rootIdentity:{...b.rootIdentity},revision:b.revision,artifacts:baseArtifacts,presign_sha256:build.release_sha256,code_sha256:build.code_sha256});
 }
 // Recovery and BASE bundles have separate artifact pins and entitlements.
 const workBinding=proofGrants.find(b=>b.id==="work")!;workBinding.recovery={root:recovery,rootIdentity:{...recoveryIdentity},artifacts:{...artifacts}};
 if(options.referenceRecovery){const peer=proofGrants.find(b=>b.id==="peer");if(peer)peer.recovery={root:recovery,rootIdentity:{...recoveryIdentity},artifacts:{...artifacts}};}
 const proof:any={format:"gsa-scoped-files-v2",hostRelease:os.release(),arch:"arm64",build,evidence,grants:proofGrants};
 const key=Buffer.alloc(32,17);await fs.writeFile(path.join(installation,"proof-key"),key,{mode:0o600});
 const writeProof=async()=>{const body=JSON.stringify(proof);await fs.writeFile(path.join(installation,"install.json"),JSON.stringify({body,hmac:createHmac("sha256",key).update(body).digest("hex")}),{mode:0o600});};await writeProof();
 let nativeCalls=0,failSign=false,durableAuthorized=true,onCodesign:(()=>void|Promise<void>)|undefined,onProtectedRead:((name:string)=>void|Promise<void>)|undefined;const calls:any[]=[];
 // Synthetic command transport checks the loader's requests. It does not prove
 // native signature validity, plist parsing, entitlements or confinement.
 const io:RecoveryInstallationIO={ownerLockFD:3,authorize:async()=>{if(!durableAuthorized)throw Error("CONTROLLER_REVOKED");},protectedRead:async(name)=>{const value=await fs.readFile(name);await onProtectedRead?.(name);return value;},protectedDirectory:async name=>{const s=await fs.lstat(name);assert(s.isDirectory()&&!s.isSymbolicLink()&&(s.mode&0o777)===0o700);},command:async(executable,args,input,max,fd)=>{
  calls.push({executable,args,input,max,fd});
  if(executable==="/usr/bin/codesign") {await onCodesign?.();if(failSign)throw Error("signature invalid");return Buffer.from(args.includes("--display")?JSON.stringify(entitlements):"");}
  if(executable==="/usr/bin/plutil")return Buffer.from(input);
  assert.equal(executable,path.join(app,"Contents/MacOS/recovery-broker"));assert.equal(fd,3);assert.deepEqual(args,[]);nativeCalls++;
  const q=JSON.parse(input);assert(!("root" in q));assert(!("executable" in q));assert(q.operation==="replace"||q.operation==="trash"||q.operation==="inspect");
  const intent={protocol:q.protocol,transaction_id:q.transaction_id,operation:q.operation,workspace_id:q.workspace_id,revision:q.revision,path:q.path,expected_sha256:q.expected_sha256,after_sha256:q.operation==="replace"?digest(Buffer.from(q.base64,"base64")):""};
  return Buffer.from(JSON.stringify({ok:true,protocol:q.protocol,transaction_id:q.transaction_id,status:"UNKNOWN",intent,observations:{},retained_handles:[],reason:"IO_UNCERTAIN"}));
 }};
 return {base,work,peer,recovery,installation,app,baseApps,registry,proof,info,entitlements,io,writeProof,calls,nativeCalls:()=>nativeCalls,signCalls:()=>calls.filter(c=>c.executable==="/usr/bin/codesign").length,failSignature:()=>{failSign=true;},onCodesign:(callback:()=>void|Promise<void>)=>{onCodesign=callback;},onProtectedRead:(callback:(name:string)=>void|Promise<void>)=>{onProtectedRead=callback;},revokeDurableAuthorization:()=>{durableAuthorized=false;},durableAuthorization:()=>durableAuthorized};
}
test("checked recovery constructor binds fixed executable and protected journal before dispatch",{skip:process.platform!=="darwin"},async t=>{
 const f=await fixture(t),adapter=await loadCheckedMacRecoveryInstallation(f.registry,f.installation,f.io);
 const out=await adapter.replaceIfHash({workspace_id:"work",path:"x.txt"},Buffer.from("new"),digest("old"));
 assert.equal(out.status,"UNKNOWN");assert.equal(f.nativeCalls(),1);
 const record=JSON.parse(await fs.readFile(path.join(f.installation,"file-transactions",out.transaction_id+".json"),"utf8"));assert.equal(record.intent.source.workspace_id,"work");assert.equal(record.status,"UNKNOWN");
 assert(f.calls.some(c=>c.executable==="/usr/bin/codesign"&&c.args.includes("--verify")));
});
test("complete v2 release evidence is validated against the current host and architecture",{skip:process.platform!=="darwin"},async t=>{
 const f=await fixture(t);assert.equal(f.proof.format,"gsa-scoped-files-v2");assert.equal(f.proof.hostRelease,os.release());assert.equal(f.proof.arch,process.arch);assert.equal(f.proof.build.hostRelease,os.release());assert.equal(f.proof.build.arch,process.arch);assert.equal(f.proof.evidence.build.hostRelease,os.release());assert.equal(f.proof.evidence.build.arch,process.arch);
 const adapter=await loadCheckedMacRecoveryInstallation(f.registry,f.installation,f.io);const out=await adapter.trashIfHash({workspace_id:"work",path:"x.txt"},digest("old"));assert.equal(out.status,"UNKNOWN");assert.equal(f.nativeCalls(),1);
});
test("reference-only peers need BASE pins but no recovery broker",{skip:process.platform!=="darwin"},async t=>{
 const f=await fixture(t,{peerReference:true});assert.equal(f.proof.grants.find((g:any)=>g.id==="peer").role,"reference");assert.equal(f.proof.grants.find((g:any)=>g.id==="peer").recovery,undefined);
 const adapter=await loadCheckedMacRecoveryInstallation(f.registry,f.installation,f.io);const out=await adapter.trashIfHash({workspace_id:"work",path:"x.txt"},digest("old"));assert.equal(out.status,"UNKNOWN");assert.equal(f.nativeCalls(),1);
});
for(const fault of ["legacy-v1","missing-build","malformed-build","missing-evidence","malformed-evidence","unresolved-evidence","build-host","build-arch","evidence-host","evidence-arch","evidence-build","proof-host","proof-arch","missing-work","missing-peer","extra-grant","duplicate-grant","duplicate-id","mismatched-peer-id","wrong-role","wrong-root","wrong-revision","wrong-device","wrong-inode","missing-base-pin","extra-base-pin","invalid-base-pin","build-pin-mismatch","build-code-mismatch"] as const)test(`v2 recovery installation rejects ${fault} before dispatch`,{skip:process.platform!=="darwin"},async t=>{
 const peerCase=["missing-peer","duplicate-id","mismatched-peer-id"].includes(fault),f=await fixture(t,peerCase?{peerReference:true}:{}),work=f.proof.grants[0];
 if(fault==="legacy-v1")f.proof.format="gsa-scoped-files-v1";
 if(fault==="missing-build")delete f.proof.build;
 if(fault==="malformed-build")f.proof.build.uuid="not-a-uuid";
 if(fault==="missing-evidence")delete f.proof.evidence;
 if(fault==="malformed-evidence")f.proof.evidence.format="unknown";
 if(fault==="unresolved-evidence")f.proof.evidence.unresolved.push("unverified");
 if(fault==="build-host")f.proof.build.hostRelease="different";
 if(fault==="build-arch")f.proof.build.arch="x86_64";
 if(fault==="evidence-host")f.proof.evidence.fixture.hostRelease="different";
 if(fault==="evidence-arch")f.proof.evidence.fixture.arch="x86_64";
 if(fault==="evidence-build")f.proof.evidence.build.compiler_version="different but HMAC-valid";
 if(fault==="proof-host")f.proof.hostRelease="different";
 if(fault==="proof-arch")f.proof.arch="x86_64";
 if(fault==="missing-work")f.proof.grants=[];
 if(fault==="missing-peer")f.proof.grants.splice(1,1);
 if(fault==="extra-grant")f.proof.grants.push({...f.proof.grants[0],id:"extra",root:path.join(f.base,"extra")});
 if(fault==="duplicate-grant")f.proof.grants.push({...f.proof.grants[0]});
 if(fault==="duplicate-id")f.proof.grants[1].id="work";
 if(fault==="mismatched-peer-id")f.proof.grants[1].id="different-peer";
 if(fault==="wrong-role")work.role="reference";
 if(fault==="wrong-root")work.root=path.join(f.base,"elsewhere");
 if(fault==="wrong-revision")work.revision++;
 if(fault==="wrong-device")work.rootIdentity.device="999999";
 if(fault==="wrong-inode")work.rootIdentity.inode="999999";
 if(fault==="missing-base-pin")delete work.artifacts[baseArtifactNames[0]];
 if(fault==="extra-base-pin")work.artifacts["unexpected"]="a".repeat(64);
 if(fault==="invalid-base-pin")work.artifacts[baseArtifactNames[0]]="bad";
 if(fault==="build-pin-mismatch")work.presign_sha256="0".repeat(64);
 if(fault==="build-code-mismatch")work.code_sha256="0".repeat(64);
 await f.writeProof();await assert.rejects(loadCheckedMacRecoveryInstallation(f.registry,f.installation,f.io));assert.equal(f.signCalls(),0);assert.equal(f.nativeCalls(),0);
});
test("BASE bundle artifact drift is rejected before signing or recovery dispatch",{skip:process.platform!=="darwin"},async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.baseApps.get("work")!,baseArtifactNames[0]),"altered BASE executable");
 await assert.rejects(loadCheckedMacRecoveryInstallation(f.registry,f.installation,f.io));assert.equal(f.signCalls(),0);assert.equal(f.nativeCalls(),0);
});
test("BASE bundle artifact drift after construction blocks the next native dispatch",{skip:process.platform!=="darwin"},async t=>{
 const f=await fixture(t),adapter=await loadCheckedMacRecoveryInstallation(f.registry,f.installation,f.io),signs=f.signCalls();
 await fs.writeFile(path.join(f.baseApps.get("work")!,baseArtifactNames[0]),"changed after construction");
 const out=await adapter.trashIfHash({workspace_id:"work",path:"x.txt"},digest("old"));assert.equal(out.status,"UNKNOWN");assert.equal(f.signCalls(),signs);assert.equal(f.nativeCalls(),0);
});
test("BASE bundle ancestors must remain private real directories",{skip:process.platform!=="darwin"},async t=>{
 const f=await fixture(t),contents=path.join(f.baseApps.get("work")!,"Contents");await fs.chmod(contents,0o755);
 await assert.rejects(loadCheckedMacRecoveryInstallation(f.registry,f.installation,f.io));assert.equal(f.signCalls(),0);assert.equal(f.nativeCalls(),0);
});
test("BASE bundle symlink ancestors are rejected before signing or dispatch",{skip:process.platform!=="darwin"},async t=>{
 const f=await fixture(t),appRoot=f.baseApps.get("work")!,contents=path.join(appRoot,"Contents"),moved=path.join(appRoot,"Contents.saved"),outside=path.join(f.base,"outside-contents");
 await fs.mkdir(outside,{mode:0o700});await fs.rename(contents,moved);await fs.symlink(outside,contents);
 await assert.rejects(loadCheckedMacRecoveryInstallation(f.registry,f.installation,f.io));assert.equal(f.signCalls(),0);assert.equal(f.nativeCalls(),0);
});
test("reference grants cannot carry recovery write metadata",{skip:process.platform!=="darwin"},async t=>{
 const f=await fixture(t,{peerReference:true,peerRecovery:true,referenceRecovery:true});await f.writeProof();
 await assert.rejects(loadCheckedMacRecoveryInstallation(f.registry,f.installation,f.io));assert.equal(f.nativeCalls(),0);
});
test("a complete HMAC-valid proof rewrite after construction blocks dispatch",{skip:process.platform!=="darwin"},async t=>{
 const f=await fixture(t),adapter=await loadCheckedMacRecoveryInstallation(f.registry,f.installation,f.io);
 f.proof.build.compiler_version="coherently rewritten";f.proof.evidence.build.compiler_version="coherently rewritten";await f.writeProof();
 const out=await adapter.trashIfHash({workspace_id:"work",path:"x.txt"},digest("old"));assert.equal(out.status,"UNKNOWN");assert.equal(f.nativeCalls(),0);
});
test("a complete HMAC-valid proof rewrite during awaited signing blocks dispatch",{skip:process.platform!=="darwin"},async t=>{
 const f=await fixture(t),adapter=await loadCheckedMacRecoveryInstallation(f.registry,f.installation,f.io);let rewritten=false;
 f.onCodesign(async()=>{if(!rewritten){rewritten=true;f.proof.build.compiler_version="rewritten during signing";f.proof.evidence.build.compiler_version="rewritten during signing";await f.writeProof();}});
 const out=await adapter.trashIfHash({workspace_id:"work",path:"x.txt"},digest("old"));assert.equal(rewritten,true);assert.equal(out.status,"UNKNOWN");assert.equal(f.nativeCalls(),0);
});
test("registry mutation during awaited BASE artifact reads blocks construction",{skip:process.platform!=="darwin"},async t=>{
 const f=await fixture(t);let changed=false;f.onProtectedRead((name:string)=>{if(!changed&&name.includes("Broker.app")){changed=true;f.registry.revoke("work");}});
 await assert.rejects(loadCheckedMacRecoveryInstallation(f.registry,f.installation,f.io));assert.equal(changed,true);assert.equal(f.nativeCalls(),0);
});
test("registry enrollment during signing blocks native dispatch",{skip:process.platform!=="darwin"},async t=>{
 const f=await fixture(t,{peerRecovery:true}),adapter=await loadCheckedMacRecoveryInstallation(f.registry,f.installation,f.io);let enrolled=false;
 f.onCodesign(async()=>{if(!enrolled){enrolled=true;await f.registry.enrollRolesTrusted([{id:"peer",root:f.peer,role:"workspace"}]);}});
 const out=await adapter.trashIfHash({workspace_id:"work",path:"x.txt"},digest("old"));assert.equal(enrolled,true);assert.equal(out.status,"UNKNOWN");assert.equal(f.nativeCalls(),0);
});
test("authorization lost during final BASE artifact read blocks dispatch without registry mutation",{skip:process.platform!=="darwin"},async t=>{
 const f=await fixture(t),adapter=await loadCheckedMacRecoveryInstallation(f.registry,f.installation,f.io),registryBefore=f.registry.list(),lastWorkBaseArtifact=path.join(f.baseApps.get("work")!,baseArtifactNames[2]);let finalBaseReads=0;
 f.onProtectedRead(async name=>{if(name===lastWorkBaseArtifact){finalBaseReads++;if(finalBaseReads===3){await Promise.resolve();f.revokeDurableAuthorization();}}});
 const out=await adapter.trashIfHash({workspace_id:"work",path:"x.txt"},digest("old"));assert.equal(finalBaseReads,3);assert.equal(f.durableAuthorization(),false);assert.equal(out.status,"UNKNOWN");assert.equal(f.nativeCalls(),0);assert.deepEqual(f.registry.list(),registryBefore);
});
for(const fault of ["missing","hmac","host","revision","nested","mode","info","entitlement","signature"] as const)test(`checked recovery constructor rejects ${fault} installation`,{skip:process.platform!=="darwin"},async t=>{
 const f=await fixture(t);
 if(fault==="missing")delete f.proof.grants[0].recovery;
 if(fault==="host")f.proof.hostRelease="wrong-host";
 if(fault==="revision")f.proof.grants[0].revision++;
 if(fault==="nested"){const nested=path.join(f.work,"recovery");await fs.mkdir(nested,{mode:0o700});const s=await fs.stat(nested,{bigint:true});f.proof.grants[0].recovery.root=nested;f.proof.grants[0].recovery.rootIdentity={device:String(s.dev),inode:String(s.ino)};}
 if(fault==="mode")await fs.chmod(f.recovery,0o755);
 if(fault==="info"){f.info.GSARecoveryRoot=f.work;const value=JSON.stringify(f.info);await fs.writeFile(path.join(f.app,"Contents/Info.plist"),value);f.proof.grants[0].recovery.artifacts["Contents/Info.plist"]=digest(value);}
 if(fault==="entitlement")f.entitlements["com.apple.security.files.downloads.read-write"]=true;
 if(fault==="signature")f.failSignature();
 await f.writeProof();if(fault==="hmac"){const file=path.join(f.installation,"install.json"),r=JSON.parse(await fs.readFile(file,"utf8"));r.hmac="0".repeat(64);await fs.writeFile(file,JSON.stringify(r));}
 await assert.rejects(loadCheckedMacRecoveryInstallation(f.registry,f.installation,f.io));assert.equal(f.nativeCalls(),0);
});
test("artifact and root identity changes after construction block native dispatch",{skip:process.platform!=="darwin"},async t=>{
 for(const drift of ["artifact","root"]){
  const f=await fixture(t),adapter=await loadCheckedMacRecoveryInstallation(f.registry,f.installation,f.io);
  if(drift==="artifact")await fs.writeFile(path.join(f.app,"Contents/MacOS/recovery-broker"),"changed");
  else{await fs.rename(f.recovery,f.recovery+"-old");await fs.mkdir(f.recovery,{mode:0o700});}
  const result=await adapter.trashIfHash({workspace_id:"work",path:"x.txt"},digest("old"));assert.equal(result.status,"UNKNOWN");assert.equal(f.nativeCalls(),0);
 }
});
test("owner FD3 is required and production activation remains disabled",{skip:process.platform!=="darwin"},async t=>{
 const f=await fixture(t);await assert.rejects(loadCheckedMacRecoveryInstallation(f.registry,f.installation,{...f.io,ownerLockFD:undefined}));assert.equal(f.nativeCalls(),0);assert.equal(macFileRecoveryActivation().available,false);
});
test("grant revoked during per-invocation signing blocks broker dispatch",{skip:process.platform!=="darwin"},async t=>{
 const f=await fixture(t),adapter=await loadCheckedMacRecoveryInstallation(f.registry,f.installation,f.io);
 let revoked=false;f.onCodesign(()=>{if(!revoked){revoked=true;f.registry.revoke("work");}});
 const out=await adapter.replaceIfHash({workspace_id:"work",path:"x.txt"},Buffer.from("new"),digest("old"));
 assert.equal(revoked,true);assert.equal(out.status,"UNKNOWN");assert.equal(f.nativeCalls(),0);
});
test("protected recovery installation nested in writable workspace blocks mutation dispatch",{skip:process.platform!=="darwin"},async t=>{
 const f=await fixture(t,{installationInsideWork:true});
 await assert.rejects(loadCheckedMacRecoveryInstallation(f.registry,f.installation,f.io));assert.equal(f.nativeCalls(),0);
});
test("recovery root overlapping a peer reference grant blocks construction",{skip:process.platform!=="darwin"},async t=>{
 const f=await fixture(t,{peerRecovery:true,peerReference:true});
 await assert.rejects(loadCheckedMacRecoveryInstallation(f.registry,f.installation,f.io));assert.equal(f.nativeCalls(),0);
});
test("new peer workspace overlapping recovery root blocks invocation",{skip:process.platform!=="darwin"},async t=>{
 const f=await fixture(t,{peerRecovery:true}),adapter=await loadCheckedMacRecoveryInstallation(f.registry,f.installation,f.io);
 await f.registry.enrollRolesTrusted([{id:"peer",root:f.peer,role:"workspace"}]);
 const out=await adapter.trashIfHash({workspace_id:"work",path:"x.txt"},digest("old"));
 assert.equal(out.status,"UNKNOWN");assert.equal(f.nativeCalls(),0);
});
