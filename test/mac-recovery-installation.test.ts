import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash,createHmac} from "node:crypto";
import {test} from "node:test";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {loadCheckedMacRecoveryInstallation,type RecoveryInstallationIO} from "../src/hosts/macos-recovery-installation.js";
import {macFileRecoveryActivation} from "../src/hosts/macos-scoped-files.js";
const digest=(b:Uint8Array|string)=>createHash("sha256").update(b).digest("hex");
const artifactNames=["Contents/MacOS/recovery-broker","Contents/Info.plist","Contents/_CodeSignature/CodeResources"];
async function fixture(t:any,options:{installationInsideWork?:boolean;peerRecovery?:boolean;peerReference?:boolean}={}){
 const base=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"gsa-recovery-install-")));
 t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const work=path.join(base,"work"),peer=path.join(base,"peer"),recovery=options.peerRecovery?path.join(peer,"private-recovery"):path.join(base,"recovery"),installation=options.installationInsideWork?path.join(work,"installation"):path.join(base,"installation");
 await fs.mkdir(work,{mode:0o700});if(options.peerRecovery)await fs.mkdir(peer,{mode:0o700});await fs.mkdir(recovery,{mode:0o700});await fs.mkdir(installation,{mode:0o700});
 const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:"work",root:work,role:"workspace"},...(options.peerReference?[{id:"peer",root:peer,role:"reference" as const}]:[])]);const grant=registry.list().find(g=>g.id==="work")!;
 const rs=await fs.stat(recovery,{bigint:true}),recoveryIdentity={device:String(rs.dev),inode:String(rs.ino)};
 const app=path.join(installation,"work/RecoveryBroker.app");
 for(const relative of ["work","work/RecoveryBroker.app","work/RecoveryBroker.app/Contents","work/RecoveryBroker.app/Contents/MacOS","work/RecoveryBroker.app/Contents/_CodeSignature"])await fs.mkdir(path.join(installation,relative),{mode:0o700});
 const info:any={CFBundleExecutable:"recovery-broker",GSARecoveryProtocol:"gsa-file-recovery-v1",GSAWorkspaceRoot:work,GSARecoveryRoot:recovery,GSAWorkspaceID:"work",GSARevision:grant.revision,GSADevice:grant.rootIdentity.device,GSAInode:grant.rootIdentity.inode,GSARecoveryDevice:recoveryIdentity.device,GSARecoveryInode:recoveryIdentity.inode};
 const entitlements:any={"com.apple.security.app-sandbox":true,"com.apple.security.temporary-exception.files.absolute-path.read-write":[work+"/",recovery+"/"]};
 const artifacts:Record<string,string>={};
 for(const name of artifactNames){const value=name.endsWith("Info.plist")?JSON.stringify(info):"disposable fixture "+name;await fs.writeFile(path.join(app,name),value,{mode:0o600});artifacts[name]=digest(value);}
 const proof:any={format:"gsa-scoped-files-v1",hostRelease:os.release(),arch:process.arch,grants:[{id:"work",root:work,rootIdentity:grant.rootIdentity,revision:grant.revision,artifacts:{},recovery:{root:recovery,rootIdentity:recoveryIdentity,artifacts}}]};
 const key=Buffer.alloc(32,17);await fs.writeFile(path.join(installation,"proof-key"),key,{mode:0o600});
 const writeProof=async()=>{const body=JSON.stringify(proof);await fs.writeFile(path.join(installation,"install.json"),JSON.stringify({body,hmac:createHmac("sha256",key).update(body).digest("hex")}),{mode:0o600});};await writeProof();
 let nativeCalls=0,failSign=false,onCodesign:(()=>void)|undefined;const calls:any[]=[];
 // Synthetic command transport checks the loader's requests. It does not prove
 // native signature validity, plist parsing, entitlements or confinement.
 const io:RecoveryInstallationIO={ownerLockFD:3,authorize:async()=>{},protectedRead:(name)=>fs.readFile(name),protectedDirectory:async name=>{const s=await fs.lstat(name);assert(s.isDirectory()&&!s.isSymbolicLink()&&(s.mode&0o777)===0o700);},command:async(executable,args,input,max,fd)=>{
  calls.push({executable,args,input,max,fd});
  if(executable==="/usr/bin/codesign") {onCodesign?.();if(failSign)throw Error("signature invalid");return Buffer.from(args.includes("--display")?JSON.stringify(entitlements):"");}
  if(executable==="/usr/bin/plutil")return Buffer.from(input);
  assert.equal(executable,path.join(app,"Contents/MacOS/recovery-broker"));assert.equal(fd,3);assert.deepEqual(args,[]);nativeCalls++;
  const q=JSON.parse(input);assert(!("root" in q));assert(!("executable" in q));assert(q.operation==="replace"||q.operation==="trash"||q.operation==="inspect");
  const intent={protocol:q.protocol,transaction_id:q.transaction_id,operation:q.operation,workspace_id:q.workspace_id,revision:q.revision,path:q.path,expected_sha256:q.expected_sha256,after_sha256:q.operation==="replace"?digest(Buffer.from(q.base64,"base64")):""};
  return Buffer.from(JSON.stringify({ok:true,protocol:q.protocol,transaction_id:q.transaction_id,status:"UNKNOWN",intent,observations:{},retained_handles:[],reason:"IO_UNCERTAIN"}));
 }};
 return {base,work,peer,recovery,installation,app,registry,proof,info,entitlements,io,writeProof,calls,nativeCalls:()=>nativeCalls,failSignature:()=>{failSign=true;},onCodesign:(callback:()=>void)=>{onCodesign=callback;}};
}
test("checked recovery constructor binds fixed executable and protected journal before dispatch",{skip:process.platform!=="darwin"},async t=>{
 const f=await fixture(t),adapter=await loadCheckedMacRecoveryInstallation(f.registry,f.installation,f.io);
 const out=await adapter.replaceIfHash({workspace_id:"work",path:"x.txt"},Buffer.from("new"),digest("old"));
 assert.equal(out.status,"UNKNOWN");assert.equal(f.nativeCalls(),1);
 const record=JSON.parse(await fs.readFile(path.join(f.installation,"file-transactions",out.transaction_id+".json"),"utf8"));assert.equal(record.intent.source.workspace_id,"work");assert.equal(record.status,"UNKNOWN");
 assert(f.calls.some(c=>c.executable==="/usr/bin/codesign"&&c.args.includes("--verify")));
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
