#!/usr/bin/env node
// Disposable real-Mac handoff test for the checked recovery installation.
// It consumes only the precompiled source candidate named by fixed SHA-256s;
// it never touches the live connector identity, manifest, workspace, or state.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {spawn} from "node:child_process";
import {createHash,createHmac,randomBytes} from "node:crypto";
import {fileURLToPath} from "node:url";

const candidate="/private/tmp/gsa-recovery-broker-candidate";
const candidateHash="525da70d1a4fa3aa86ee7ced79856c4d37dac6792f5685a0431006d8fd85070f";
const source=path.resolve("native/macos-files/recovery-broker.swift");
const sourceHash="d31392926056ce369999ee48ccc4c3ce47a715a25e3db972da015b496407e14f";
const launcher=path.resolve("scripts/macos-owner-launcher.py");
const script=fileURLToPath(import.meta.url);
const protocol="gsa-file-recovery-v1";
const maxOutput=1024*1024;
const timeoutMs=30000;
const sha=(data)=>createHash("sha256").update(data).digest("hex");
const ident=(s)=>({device:String(s.dev),inode:String(s.ino)});
const xmlEscape=(s)=>String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;");
function plist(value){
 const rows=Object.entries(value).map(([key,item])=>`<key>${xmlEscape(key)}</key>${typeof item==="boolean"?`<${item?"true":"false"}/>`:typeof item==="number"?`<integer>${item}</integer>`:Array.isArray(item)?`<array>${item.map(x=>`<string>${xmlEscape(x)}</string>`).join("")}</array>`:`<string>${xmlEscape(item)}</string>`}`).join("");
 return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${rows}</dict></plist>\n`;
}
function run(executable,args,input="",max=65536,ownerLockFD,inheritEnv=false){
 return new Promise((resolve,reject)=>{
  const env=inheritEnv?process.env:{PATH:"/usr/bin:/bin",HOME:"/var/empty",LANG:"C",TMPDIR:"/private/tmp"};
  const child=spawn(executable,args,{shell:false,env,stdio:ownerLockFD===undefined?["pipe","pipe","pipe"]:["pipe","pipe","pipe",ownerLockFD]});
  let stdout=Buffer.alloc(0),stderr=Buffer.alloc(0),failure,closed=false;
  const timer=setTimeout(()=>{failure=Error(`TIMEOUT ${executable}`);child.kill("SIGKILL");},timeoutMs);
  child.stdout.on("data",chunk=>{if(stdout.length+chunk.length>max){failure=Error(`STDOUT_LIMIT ${executable}`);child.kill("SIGKILL");}else stdout=Buffer.concat([stdout,chunk]);});
  child.stderr.on("data",chunk=>{if(stderr.length+chunk.length>65536){failure=Error(`STDERR_LIMIT ${executable}`);child.kill("SIGKILL");}else stderr=Buffer.concat([stderr,chunk]);});
  child.on("error",error=>{failure=error;});
  child.on("close",code=>{closed=true;clearTimeout(timer);if(failure)return reject(failure);if(code!==0)return reject(Error(`COMMAND_FAILED ${executable} ${JSON.stringify(args)} exit=${code} stderr=${stderr.toString("utf8").slice(0,1200)}`));resolve(stdout);});
  child.stdin.on("error",()=>{});child.stdin.end(input);
  // Keep the promise pending until close, including after timeout/overflow kill.
  void closed;
 });
}
async function protectedRead(file,max){
 const before=await fs.lstat(file);
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.uid!==process.getuid()||(before.mode&0o077)!==0||before.size>max)throw Error(`unsafe test installation file ${file}`);
 const handle=await fs.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const opened=await handle.stat();if(opened.dev!==before.dev||opened.ino!==before.ino)throw Error(`test installation changed ${file}`);
  const bytes=Buffer.alloc(before.size+1);let offset=0;while(offset<bytes.length){const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}
  const after=await handle.stat();if(offset!==before.size||after.ctimeMs!==before.ctimeMs||after.mtimeMs!==before.mtimeMs)throw Error(`test installation changed ${file}`);
  return bytes.subarray(0,offset);
 }finally{await handle.close();}
}
async function protectedDirectory(dir){
 const s=await fs.lstat(dir);if(!s.isDirectory()||s.isSymbolicLink()||![0,process.getuid()].includes(s.uid)||(s.mode&0o777)!==0o700||await fs.realpath(dir)!==dir)throw Error(`unsafe test installation directory ${dir}`);
}
async function fixtureRoot(){
 const root=process.env.GSA_NATIVE_FIXTURE_ROOT;if(!root)throw Error("missing isolated fixture root");
 if(!root.startsWith("/private/tmp/gsa-recovery-install-native-")||await fs.realpath(root)!==root)throw Error("fixture root is not canonical private temporary storage");
 const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o777)!==0o700)throw Error("unsafe fixture root");
 return root;
}
async function actualOwnerCheck(root){
 const identity=path.join(root,"owner");
 if(process.env.GSA_OWNER_LOCK_FD!=="3"||process.env.GSA_OWNER_IDENTITY!==identity)throw Error("isolated FD3 owner environment missing");
 const result=await run("/usr/bin/python3",[launcher,"--identity",identity,"--verify"],"",4096,3,true);
 const owner=JSON.parse(result.toString("utf8"));if(owner.format!=="gsa-owner-v1"||owner.session!==process.env.GSA_OWNER_SESSION)throw Error("isolated FD3 owner verification failed");
}
async function runChecked(){
 if(process.platform!=="darwin")throw Error("actual recovery-installation check requires macOS");
 const root=await fixtureRoot();await actualOwnerCheck(root);
 if(sha(await fs.readFile(candidate))!==candidateHash)throw Error("precompiled candidate SHA-256 mismatch");
 if(sha(await fs.readFile(source))!==sourceHash)throw Error("candidate source SHA-256 mismatch");
 const [{WorkspaceRegistry},{loadCheckedMacRecoveryInstallation}]=await Promise.all([
  import("../dist/src/core/workspace.js"),import("../dist/src/hosts/macos-recovery-installation.js")
 ]);
 const base=await fs.realpath(await fs.mkdtemp(path.join(root,"case-")));await fs.chmod(base,0o700);
 const baseStat=await fs.lstat(base),work=path.join(base,"workspace"),recovery=path.join(base,"recovery"),installation=path.join(base,"installation");
 let preserve=false;
 try{
  for(const directory of [work,recovery,installation])await fs.mkdir(directory,{mode:0o700});
  const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:"work",root:work,role:"workspace"}]);
  const grant=registry.list().find(g=>g.id==="work");if(!grant)throw Error("workspace grant missing");
  const workIdentity=grant.rootIdentity,recoveryIdentity=ident(await fs.stat(recovery,{bigint:true}));
  if(workIdentity.device!==recoveryIdentity.device)throw Error("disposable roots unexpectedly on different volumes");
  const app=path.join(installation,"work","RecoveryBroker.app"),contents=path.join(app,"Contents"),macos=path.join(contents,"MacOS"),signature=path.join(contents,"_CodeSignature");
  for(const directory of [path.join(installation,"work"),app,contents,macos,signature])await fs.mkdir(directory,{mode:0o700});
  const binary=path.join(macos,"recovery-broker");await fs.copyFile(candidate,binary);await fs.chmod(binary,0o500);
  const info={CFBundleIdentifier:"local.gsa.recovery.disposable",CFBundleName:"RecoveryBroker",CFBundleExecutable:"recovery-broker",CFBundlePackageType:"APPL",GSARecoveryProtocol:protocol,GSAWorkspaceRoot:work,GSARecoveryRoot:recovery,GSAWorkspaceID:"work",GSARevision:grant.revision,GSADevice:workIdentity.device,GSAInode:workIdentity.inode,GSARecoveryDevice:recoveryIdentity.device,GSARecoveryInode:recoveryIdentity.inode};
  const infoPath=path.join(contents,"Info.plist");await fs.writeFile(infoPath,plist(info),{mode:0o600,flag:"wx"});
  const entitlementsPath=path.join(base,"entitlements.plist");
  await fs.writeFile(entitlementsPath,plist({"com.apple.security.app-sandbox":true,"com.apple.security.temporary-exception.files.absolute-path.read-write":[work+"/",recovery+"/"]}),{mode:0o600,flag:"wx"});
  await run("/usr/bin/codesign",["--force","--deep","--sign","-","--entitlements",entitlementsPath,app],"",65536);
  await run("/usr/bin/codesign",["--verify","--deep","--strict",app],"",65536);
  // The checked loader requires owner-only app directories and files; apply the
  // modes before taking artifact digests, then confirm the signature still verifies.
  for(const directory of [app,contents,macos,signature])await fs.chmod(directory,0o700);
  for(const file of [binary,infoPath,path.join(signature,"CodeResources")])await fs.chmod(file,file===binary?0o500:0o600);
  await run("/usr/bin/codesign",["--verify","--deep","--strict",app],"",65536);
  const artifactPaths={"Contents/MacOS/recovery-broker":binary,"Contents/Info.plist":infoPath,"Contents/_CodeSignature/CodeResources":path.join(signature,"CodeResources")};
  const artifacts={};for(const [name,file] of Object.entries(artifactPaths))artifacts[name]=sha(await protectedRead(file,16*1024*1024));
  const proofKey=randomBytes(32);await fs.writeFile(path.join(installation,"proof-key"),proofKey,{mode:0o600,flag:"wx"});
  const proof={format:"gsa-scoped-files-v1",hostRelease:os.release(),arch:process.arch,grants:[{id:"work",root:work,rootIdentity:workIdentity,revision:grant.revision,artifacts:{},recovery:{root:recovery,rootIdentity:recoveryIdentity,artifacts}}]};
  const body=JSON.stringify(proof),hmac=createHmac("sha256",proofKey).update(body).digest("hex");
  await fs.writeFile(path.join(installation,"install.json"),JSON.stringify({body,hmac}),{mode:0o600,flag:"wx"});
  const item=path.join(work,"item.txt"),neighbor=path.join(work,"neighbor.txt"),outside=path.join(base,"outside-canary.txt");
  await fs.writeFile(neighbor,"neighbor-canary",{mode:0o600,flag:"wx"});await fs.writeFile(outside,"outside-canary",{mode:0o600,flag:"wx"});
  const checkCanaries=async()=>{assert.equal(await fs.readFile(neighbor,"utf8"),"neighbor-canary");assert.equal(await fs.readFile(outside,"utf8"),"outside-canary");};
  let dropNextReplaceAck=false;const operations=[];
  const io={ownerLockFD:3,authorize:async id=>{registry.requireGrant(id,"read");registry.requireGrant(id,"write");},protectedRead,protectedDirectory,command:async(executable,args,input,max,ownerLockFD)=>{
   if(executable==="/usr/bin/codesign")return run(executable,args,input,max);
   if(executable==="/usr/bin/plutil")return run(executable,args,input,max);
   if(executable!==binary||args.length!==0||ownerLockFD!==3)throw Error(`unexpected recovery helper invocation: ${executable}`);
   const request=JSON.parse(input);operations.push(request.operation);
   const response=await run(executable,args,input,max,3);
   if(request.operation==="replace"&&dropNextReplaceAck){dropNextReplaceAck=false;throw Error("TEST_ONLY_DROPPED_ACK_AFTER_NATIVE_EXIT_ZERO");}
   return response;
  }};
  const adapter=await loadCheckedMacRecoveryInstallation(registry,installation,io);
  const beforeA=Buffer.from("retained-before-a"),afterA=Buffer.from("published-after-a");await fs.writeFile(item,beforeA,{mode:0o600,flag:"wx"});
  const first=await adapter.replaceIfHash({workspace_id:"work",path:"item.txt"},afterA,sha(beforeA));
  assert.equal(first.status,"APPLIED");assert.deepEqual(first.retained_handles,[first.transaction_id]);
  assert.deepEqual(await fs.readFile(item),afterA);assert.deepEqual(await fs.readFile(path.join(recovery,first.transaction_id,"captured")),beforeA);await checkCanaries();
  const beforeB=Buffer.from("retained-before-b"),afterB=Buffer.from("published-after-b");await fs.writeFile(item,beforeB);
  dropNextReplaceAck=true;
  const uncertain=await adapter.replaceIfHash({workspace_id:"work",path:"item.txt"},afterB,sha(beforeB));
  assert.equal(uncertain.status,"UNKNOWN");assert.deepEqual(await fs.readFile(item),afterB);assert.deepEqual(await fs.readFile(path.join(recovery,uncertain.transaction_id,"captured")),beforeB);
  const inspected=await adapter.readTransaction(uncertain.transaction_id);
  assert.equal(inspected.status,"APPLIED");assert.deepEqual(inspected.retained_handles,[uncertain.transaction_id]);
  assert.equal(operations.filter(op=>op==="replace").length,2);assert.equal(operations.filter(op=>op==="inspect").length,1);await checkCanaries();
  const beforeTrash=Buffer.from("retained-before-trash");await fs.writeFile(item,beforeTrash);
  const trashed=await adapter.trashIfHash({workspace_id:"work",path:"item.txt"},sha(beforeTrash));
  assert.equal(trashed.status,"APPLIED");assert.equal(trashed.observations.source_absent,true);
  await assert.rejects(fs.stat(item),{code:"ENOENT"});assert.deepEqual(await fs.readFile(path.join(recovery,trashed.transaction_id,"captured")),beforeTrash);await checkCanaries();
  console.log(JSON.stringify({result:"PASS",scope:"actual checked constructor + signed RecoveryBroker candidate on disposable macOS roots",source_sha256:sourceHash,candidate_sha256:candidateHash,operations,replace_retained:true,dropped_ack_reconciled:true,trash_retained:true,canaries:"unchanged",temporary_fixture:base}));
 }catch(error){preserve=true;console.error(JSON.stringify({result:"FAIL",error:String(error?.stack??error),temporary_fixture:base}));throw error;
 }finally{
  if(!preserve){const current=await fs.lstat(base);if(current.dev!==baseStat.dev||current.ino!==baseStat.ino||current.isSymbolicLink()||await fs.realpath(base)!==base){console.error(`Cleanup refused: fixture identity changed; retained ${base}`);}else await fs.rm(base,{recursive:true,force:false});}
 }
}
export async function finalizeOwnerRoot(ownerRoot,ownerStat,code){
 const current=await fs.lstat(ownerRoot);
 if(current.dev!==ownerStat.dev||current.ino!==ownerStat.ino||current.isSymbolicLink()||await fs.realpath(ownerRoot)!==ownerRoot){console.error(`Cleanup refused: isolated owner root identity changed; retained ${ownerRoot}`);return 1;}
 if(code!==0){console.error(`Preserved failed isolated fixture root: ${ownerRoot}`);return code;}
 await fs.rm(ownerRoot,{recursive:true,force:false});
 return 0;
}
async function main(){
 if(process.platform!=="darwin")throw Error("actual recovery-installation check requires macOS");
 if(process.env.GSA_OWNER_LOCK_FD!==undefined){
  const root=process.env.GSA_NATIVE_FIXTURE_ROOT;
  const identity=process.env.GSA_OWNER_IDENTITY;
  if(process.env.GSA_OWNER_LOCK_FD!=="3"||!root?.startsWith("/private/tmp/gsa-recovery-install-native-")||identity!==path.join(root,"owner"))throw Error("refusing to reuse any existing owner identity; run this script normally to create an isolated one");
  return runChecked();
 }
 const ownerRoot=await fs.realpath(await fs.mkdtemp("/private/tmp/gsa-recovery-install-native-"));await fs.chmod(ownerRoot,0o700);
 const ownerStat=await fs.lstat(ownerRoot),identity=path.join(ownerRoot,"owner");
 await fs.mkdir(identity,{mode:0o700});
 const env={PATH:"/usr/bin:/bin",HOME:"/var/empty",LANG:"C",TMPDIR:"/private/tmp",GSA_NATIVE_FIXTURE_ROOT:ownerRoot};
 const child=spawn("/usr/bin/python3",[launcher,"--identity",identity,"--node",process.execPath,"--entry",script],{shell:false,stdio:"inherit",env,detached:true});
 let timer;const code=await new Promise((resolve,reject)=>{
  let settled=false;const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);fn(value);};
  child.once("error",error=>finish(reject,error));child.once("close",(status,signal)=>finish(resolve,status??(signal?1:0)));
  timer=setTimeout(()=>{try{process.kill(-child.pid,"SIGTERM");}catch{}setTimeout(()=>{try{process.kill(-child.pid,"SIGKILL");}catch{}},5000).unref();},8*60*1000);
 });
 const result=await finalizeOwnerRoot(ownerRoot,ownerStat,code);
 if(result!==0)process.exitCode=result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===script)main().catch(error=>{console.error(String(error?.stack??error));process.exitCode=1;});
