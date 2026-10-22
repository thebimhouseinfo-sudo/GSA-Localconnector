#!/usr/bin/env node
// Actual signed RELEASE-broker smoke fixture. Disposable roots only; no test hooks.
import assert from "node:assert/strict";
import {spawn,execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

const script=fileURLToPath(import.meta.url);
const source=path.resolve("native/macos-files/broker.swift");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const sandbox="com.apple.security.app-sandbox";
const rw="com.apple.security.temporary-exception.files.absolute-path.read-write";
const ro="com.apple.security.temporary-exception.files.absolute-path.read-only";
const assertDarwin=()=>{if(process.platform!=="darwin")throw Error("actual release-broker fixture requires macOS")};
const privateDir=async p=>{await fs.mkdir(p,{mode:0o700});await fs.chmod(p,0o700)};
const plist=async value=>execFileSync("/usr/bin/plutil",["-convert","xml1","-o","-","-"],{input:JSON.stringify(value)});

function run(executable,args,input="",timeout=30000){
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{shell:false,env:{PATH:"/usr/bin:/bin",HOME:"/var/empty",LANG:"C",TMPDIR:"/private/tmp"},stdio:["pipe","pipe","pipe"]});
  let out=Buffer.alloc(0),err=Buffer.alloc(0),failure;const timer=setTimeout(()=>{failure=Error(`TIMEOUT ${executable}`);child.kill("SIGKILL");},timeout);
  child.stdout.on("data",chunk=>{out=Buffer.concat([out,chunk]);if(out.length>1024*1024){failure=Error("STDOUT_LIMIT");child.kill("SIGKILL");}});
  child.stderr.on("data",chunk=>{err=Buffer.concat([err,chunk]);if(err.length>65536){failure=Error("STDERR_LIMIT");child.kill("SIGKILL");}});
  child.on("error",error=>{failure=error;});
  child.on("close",code=>{clearTimeout(timer);if(failure)return reject(failure);if(code!==0)return reject(Error(`COMMAND_FAILED ${executable} ${args.join(" ")} exit=${code}: ${err.toString("utf8").slice(0,1200)}`));resolve(out);});
  child.stdin.on("error",()=>{});child.stdin.end(input);
 });
}

async function installBroker(base,root,id,role,extra=false){
 const st=await fs.stat(root,{bigint:true});
 const app=path.join(base,`${id}${extra?"-extra":""}.app`),contents=path.join(app,"Contents"),macos=path.join(contents,"MacOS");
 await fs.mkdir(macos,{recursive:true,mode:0o700});
 const binary=path.join(macos,"broker");await fs.copyFile(path.join(base,"broker-release"),binary);await fs.chmod(binary,0o700);
 const info={CFBundleIdentifier:`local.gsa.scoped.${id}${extra?".extra":""}`,CFBundleName:"ScopedBroker",CFBundleExecutable:"broker",CFBundlePackageType:"APPL",CFBundleVersion:"1",GSAWorkspaceID:id,GSAWorkspaceRole:role,GSAWorkspaceRoot:root,GSADevice:String(st.dev),GSAInode:String(st.ino),GSARevision:1};
 await fs.writeFile(path.join(contents,"Info.plist"),await plist(info),{mode:0o600});
 const rights=role==="workspace"?rw:ro,values={[sandbox]:true,[rights]:[root+"/"]};
 if(extra)values["com.apple.security.network.client"]=true;
 const entitlements=path.join(base,`${id}${extra?"-extra":""}-entitlements.plist`);await fs.writeFile(entitlements,await plist(values),{mode:0o600});
 execFileSync("/usr/bin/codesign",["--force","--deep","--sign","-","--entitlements",entitlements,app],{stdio:"pipe"});
 execFileSync("/usr/bin/codesign",["--verify","--deep","--strict",app],{stdio:"pipe"});
 return {binary,root,id,role,device:String(st.dev),inode:String(st.ino),revision:1,entitlements:values};
}
async function call(bundle,request){
 const out=await run(bundle.binary,[],JSON.stringify(request));
 return JSON.parse(out.toString("utf8"));
}
function common(bundle,operation,file,extra={}){
 return {operation,workspace_id:bundle.id,role:bundle.role,root:bundle.root,device:bundle.device,inode:bundle.inode,revision:bundle.revision,path:file,...extra};
}

async function main(){
 assertDarwin();
 const base=await fs.realpath(await fs.mkdtemp("/private/tmp/gsa-scoped-release-native-"));await fs.chmod(base,0o700);
 const baseStat=await fs.lstat(base);
 let preserve=false;
 try{
  for(const name of ["workspace","reference","outside"])await privateDir(path.join(base,name));
  const workspace=path.join(base,"workspace"),reference=path.join(base,"reference"),outside=path.join(base,"outside");
  const neighbor=path.join(workspace,"neighbor-canary.txt"),outsideCanary=path.join(outside,"canary.txt");
  await fs.writeFile(neighbor,"neighbor-preserved",{mode:0o600,flag:"wx"});await fs.writeFile(outsideCanary,"outside-preserved",{mode:0o600,flag:"wx"});
  const compile=await run("/usr/bin/swiftc",[source,"-o",path.join(base,"broker-release")],"",120000);
  const release=path.join(base,"broker-release"),candidateHash=sha(await fs.readFile(release)),sourceHash=sha(await fs.readFile(source));
  const work=await installBroker(base,workspace,"workspace","workspace");
  const ref=await installBroker(base,reference,"reference","reference");
  const extra=await installBroker(base,workspace,"workspace","workspace",true);
  const events=[];
  const created=await call(work,common(work,"create","created.txt",{base64:Buffer.from("workspace-created").toString("base64")}));events.push({case:"workspace-create",response:created});assert.equal(created.ok,true);
  const read=await call(work,common(work,"read","created.txt",{maxBytes:1024}));events.push({case:"workspace-read",response:read});assert.equal(Buffer.from(read.base64,"base64").toString(),"workspace-created");
  const made=await call(work,common(work,"mkdir","new-directory"));events.push({case:"workspace-mkdir",response:made});assert.equal(made.ok,true);assert((await fs.stat(path.join(workspace,"new-directory"))).isDirectory());
  await fs.writeFile(path.join(reference,"reference.txt"),"reference-read-only",{mode:0o600,flag:"wx"});
  const refRead=await call(ref,common(ref,"read","reference.txt",{maxBytes:1024}));events.push({case:"reference-read",response:refRead});assert.equal(Buffer.from(refRead.base64,"base64").toString(),"reference-read-only");
  const refWrite=await call(ref,common(ref,"create","blocked.txt",{base64:Buffer.from("must-not-write").toString("base64")}));events.push({case:"reference-write-denied",response:refWrite});assert.deepEqual(refWrite,{error:"PERMISSION_DENIED",ok:false});await assert.rejects(fs.stat(path.join(reference,"blocked.txt")),{code:"ENOENT"});
  const wrongBinding=await call(work,{...common(work,"read","created.txt",{maxBytes:1024}),workspace_id:"different-workspace"});events.push({case:"wrong-request-binding",response:wrongBinding});assert.deepEqual(wrongBinding,{error:"GRANT_BINDING_MISMATCH",ok:false});
  const extraEntitlement=await call(extra,common(extra,"create","extra-entitlement.txt",{base64:Buffer.from("must-not-write").toString("base64")}));events.push({case:"extra-entitlement-denied",response:extraEntitlement});assert.deepEqual(extraEntitlement,{error:"SIGNED_SANDBOX_REQUIRED",ok:false});await assert.rejects(fs.stat(path.join(workspace,"extra-entitlement.txt")),{code:"ENOENT"});
  assert.equal(await fs.readFile(neighbor,"utf8"),"neighbor-preserved");assert.equal(await fs.readFile(outsideCanary,"utf8"),"outside-preserved");
  console.log(JSON.stringify({result:"PASS",scope:"actual signed Swift RELEASE broker, direct request protocol",source_sha256:sourceHash,release_binary_sha256:candidateHash,compile_stdout:compile.toString("utf8"),entitlements:{workspace:work.entitlements,reference:ref.entitlements,extra:extra.entitlements},events,canaries:"workspace neighbor and outside canary unchanged",limitations:["does not exercise Node loader or durable grant controller","does not prove syscall-level ancestor-relocation containment","disposable roots only; not installed product readiness"]}));
 }catch(error){preserve=true;console.error(JSON.stringify({result:"FAIL",error:String(error?.stack??error),preserved_fixture:base}));throw error;
 }finally{
  if(!preserve){const now=await fs.lstat(base);if(now.dev!==baseStat.dev||now.ino!==baseStat.ino||now.isSymbolicLink()||await fs.realpath(base)!==base){console.error(`Cleanup refused; fixture identity changed: ${base}`);}else await fs.rm(base,{recursive:true,force:false});}
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===script)main().catch(error=>{console.error(String(error?.stack??error));process.exitCode=1;});
