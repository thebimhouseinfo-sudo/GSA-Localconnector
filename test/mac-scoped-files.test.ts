import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash,createHmac} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import type {WorkspacePermission} from "../src/core/contracts.js";
import {loadMacScopedFilesCandidate as loadMacScopedFiles,fixtureBuild} from "./helpers/mac-scoped-candidate.js";

const digest=(data:Buffer|string)=>createHash("sha256").update(data).digest("hex");
type FixtureOptions={authorize?:(id:string,permission?:WorkspacePermission)=>Promise<void>;beforeLoad?:(registry:WorkspaceRegistry,roots:{workspace:string;other:string;reference:string})=>Promise<void>};
async function fixture(t:any,options:FixtureOptions={}){
 const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"gsa-scoped-copy-")));
 const workspace=path.join(temp,"workspace"),other=path.join(temp,"other"),reference=path.join(temp,"reference"),installation=path.join(temp,"scoped-files");
 for(const dir of [workspace,other,reference,installation])await fs.mkdir(dir,{mode:0o700});
 const registry=new WorkspaceRegistry();
 await registry.enrollRolesTrusted([{id:"workspace",root:workspace,role:"workspace"},{id:"other",root:other,role:"workspace"},{id:"reference",root:reference,role:"reference"}]);
 async function secureTree(dir:string){
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
   const full=path.join(dir,entry.name);
   if(entry.isDirectory()){await secureTree(full);await fs.chmod(full,0o700);}
   else await fs.chmod(full,entry.name==="broker"?0o700:0o600);
  }
 }
 const artifactNames=["Contents/MacOS/broker","Contents/Info.plist","Contents/_CodeSignature/CodeResources"];
 const key=Buffer.from("fixture-proof-key-32-bytes-long!!").subarray(0,32);await fs.writeFile(path.join(installation,"proof-key"),key,{mode:0o600});
 const bound=[];
 for(const grant of registry.list()){
  const grantDir=path.join(installation,grant.id);await fs.mkdir(grantDir,{mode:0o700});
  const bundle=path.join(grantDir,"Broker.app"),contents=path.join(bundle,"Contents"),macos=path.join(contents,"MacOS");
  await fs.mkdir(macos,{recursive:true,mode:0o700});
  const role=grant.role??"workspace",info={CFBundleExecutable:"broker",CFBundleIdentifier:`local.gsa.test.${grant.id}`,CFBundleName:"Broker",CFBundlePackageType:"APPL",CFBundleVersion:"1",GSAWorkspaceID:grant.id,GSAWorkspaceRole:role,GSAWorkspaceRoot:grant.canonicalRoot,GSARevision:grant.revision,GSADevice:grant.rootIdentity.device,GSAInode:grant.rootIdentity.inode};
  await fs.writeFile(path.join(contents,"Info.plist"),execFileSync("/usr/bin/plutil",["-convert","xml1","-o","-","-"],{input:JSON.stringify(info)}),{mode:0o600});
  const cSource=`#include <CommonCrypto/CommonDigest.h>\n#include <fcntl.h>\n#include <stdint.h>\n#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <sys/stat.h>\n#include <unistd.h>\nstatic char *field(char *s,const char *key){char p[96];snprintf(p,sizeof(p),"\\\"%s\\\":\\\"",key);char *v=strstr(s,p);if(!v)return 0;v+=strlen(p);char *e=strchr(v,'\\\"');if(!e)return 0;return strndup(v,(size_t)(e-v));}\nstatic const char tab[]="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";\nstatic void encode(const unsigned char *d,size_t n,char *o){size_t i=0,j=0;while(i<n){size_t left=n-i;uint32_t a=d[i],b=left>1?d[i+1]:0,c=left>2?d[i+2]:0,x=(a<<16)|(b<<8)|c;i+=left>2?3:left;o[j++]=tab[(x>>18)&63];o[j++]=tab[(x>>12)&63];o[j++]=left>1?tab[(x>>6)&63]:'=';o[j++]=left>2?tab[x&63]:'=';}o[j]=0;}\nstatic unsigned char *decode(const char *s,size_t *n){size_t l=strlen(s);unsigned char *o=calloc(l+1,1);int val=0,bits=-8;*n=0;for(size_t i=0;i<l;i++){const char *p=strchr(tab,s[i]);if(s[i]=='=')break;if(!p){free(o);return 0;}val=(val<<6)+(int)(p-tab);bits+=6;if(bits>=0){o[(*n)++]=(val>>bits)&255;bits-=8;}}return o;}\nint main(void){char *q=calloc(12*1024*1024+1,1);size_t qn=fread(q,1,12*1024*1024,stdin);q[qn]=0;char *id=field(q,"workspace_id"),*role=field(q,"role"),*op=field(q,"operation"),*rel=field(q,"path");if(!id||strcmp(id,\"${grant.id}\")||!role||strcmp(role,\"${role}\")||!op||!rel){puts(\"{\\\"ok\\\":false,\\\"error\\\":\\\"MISSING_BINDING\\\"}\");return 0;}char target[8192];snprintf(target,sizeof(target),\"%s/%s\",${JSON.stringify(grant.canonicalRoot)},rel);if(!strcmp(op,\"read\")){int fd=open(target,O_RDONLY|O_NOFOLLOW);if(fd<0){puts(\"{\\\"ok\\\":false,\\\"error\\\":\\\"READ_FAILED\\\"}\");return 0;}unsigned char *data=malloc(8*1024*1024+1);ssize_t n=read(fd,data,8*1024*1024+1);close(fd);if(n<0||n>8*1024*1024){puts(\"{\\\"ok\\\":false,\\\"error\\\":\\\"READ_LIMIT_EXCEEDED\\\"}\");return 0;}unsigned char hash[CC_SHA256_DIGEST_LENGTH];CC_SHA256(data,(CC_LONG)n,hash);char hex[65],*b64=malloc((size_t)n*2+8);for(int i=0;i<CC_SHA256_DIGEST_LENGTH;i++)sprintf(hex+2*i,\"%02x\",hash[i]);hex[64]=0;encode(data,(size_t)n,b64);printf(\"{\\\"ok\\\":true,\\\"base64\\\":\\\"%s\\\",\\\"sha256\\\":\\\"%s\\\"}\\n\",b64,hex);free(data);free(b64);return 0;}if(!strcmp(op,\"mkdir\")){if(mkdir(target,0700)){puts(\"{\\\"ok\\\":false,\\\"error\\\":\\\"MKDIR_FAILED\\\"}\");return 0;}puts(\"{\\\"ok\\\":true}\");return 0;}if(!strcmp(op,\"create\")){char *b=field(q,\"base64\");size_t n=0;unsigned char *data=b?decode(b,&n):0;if(!data){puts(\"{\\\"ok\\\":false,\\\"error\\\":\\\"INVALID_BASE64\\\"}\");return 0;}int fd=open(target,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600);if(fd<0){puts(\"{\\\"ok\\\":false,\\\"error\\\":\\\"DESTINATION_EXISTS\\\"}\");free(data);return 0;}size_t off=0;while(off<n){ssize_t w=write(fd,data+off,n-off);if(w<=0)break;off+=(size_t)w;}close(fd);free(data);if(off!=n){puts(\"{\\\"ok\\\":false,\\\"error\\\":\\\"MUTATION_OUTCOME_UNKNOWN\\\"}\");return 0;}if(strstr(rel,\"unknown.bin\")){puts(\"{\\\"ok\\\":false,\\\"error\\\":\\\"MUTATION_OUTCOME_UNKNOWN\\\"}\");return 0;}puts(\"{\\\"ok\\\":true}\");return 0;}puts(\"{\\\"ok\\\":false,\\\"error\\\":\\\"SECURITY_BLOCKED\\\"}\");return 0;}\n`;
  const broker=path.join(macos,"broker");execFileSync("/usr/bin/clang",["-x","c","-","-o",broker],{input:cSource});await fs.chmod(broker,0o700);
  const entitlementName=role==="reference"?"com.apple.security.temporary-exception.files.absolute-path.read-only":"com.apple.security.temporary-exception.files.absolute-path.read-write";
  const entitlements=path.join(temp,`entitlements-${grant.id}.plist`);
  await fs.writeFile(entitlements,execFileSync("/usr/bin/plutil",["-convert","xml1","-o","-","-"],{input:JSON.stringify({"com.apple.security.app-sandbox":true,[entitlementName]:[grant.canonicalRoot+"/"]})}),{mode:0o600});
  execFileSync("/usr/bin/codesign",["--force","--deep","--sign","-","--entitlements",entitlements,bundle],{stdio:"ignore"});await secureTree(bundle);
  const artifacts:Record<string,string>={};for(const name of artifactNames)artifacts[name]=digest(await fs.readFile(path.join(bundle,name)));
  bound.push({id:grant.id,root:grant.canonicalRoot,rootIdentity:grant.rootIdentity,revision:grant.revision,role,artifacts,code_sha256:'0'.repeat(64),presign_sha256:'0'.repeat(64)});
 }
 const proof={format:"gsa-scoped-files-v2",build:fixtureBuild(),evidence:null,hostRelease:os.release(),arch:process.arch,grants:bound,checks:["native-read","create-exclusive","mkdir","copy-exclusive","symlink-denied","hardlink-denied","traversal-denied","read-cap","hash-conflict","root-identity","ancestor-relocation"]};
 const body=JSON.stringify(proof),envelope={body,hmac:createHmac("sha256",key).update(body).digest("hex")};
 await fs.writeFile(path.join(installation,"install.json"),JSON.stringify(envelope),{mode:0o600});
 t.after(()=>fs.rm(temp,{recursive:true,force:true}));
 await options.beforeLoad?.(registry,{workspace,other,reference});
 const io=await loadMacScopedFiles(registry,installation,{authorize:options.authorize});
 return {io,registry,workspace,other,reference,installation};
}

test("copyExclusive copies reference and workspace files through separate exclusive broker roots",{skip:process.platform!=="darwin"?"macOS-only adapter":false},async t=>{
 const {io,workspace,other,reference}=await fixture(t);
 const refFile=Buffer.from("reference snapshot\n"),workFile=Buffer.from("working snapshot\n");
 await fs.writeFile(path.join(reference,"source.txt"),refFile);await fs.writeFile(path.join(workspace,"source.txt"),workFile);
 await io.copyExclusive({workspace_id:"reference",path:"source.txt"},{workspace_id:"workspace",path:"copied.txt"},digest(refFile));
 await io.copyExclusive({workspace_id:"workspace",path:"source.txt"},{workspace_id:"other",path:"copied.txt"},digest(workFile));
 assert.deepEqual(await fs.readFile(path.join(workspace,"copied.txt")),refFile);
 assert.deepEqual(await fs.readFile(path.join(other,"copied.txt")),workFile);
 assert.deepEqual(await fs.readFile(path.join(reference,"source.txt")),refFile);
 assert.deepEqual(await fs.readFile(path.join(workspace,"source.txt")),workFile);
});

test("copyExclusive rejects reference destinations and hash mismatch without creating output",{skip:process.platform!=="darwin"?"macOS-only adapter":false},async t=>{
 const {io,workspace,reference}=await fixture(t),bytes=Buffer.from("source");
 await fs.writeFile(path.join(workspace,"source.txt"),bytes);
 await assert.rejects(io.copyExclusive({workspace_id:"workspace",path:"source.txt"},{workspace_id:"reference",path:"denied.txt"},digest(bytes)),(error:any)=>error.code==="PERMISSION_DENIED");
 assert.equal(await fs.stat(path.join(reference,"denied.txt")).then(()=>true,()=>false),false);
 await assert.rejects(io.copyExclusive({workspace_id:"workspace",path:"source.txt"},{workspace_id:"workspace",path:"mismatch.txt"},"0".repeat(64)),(error:any)=>error.code==="HASH_CONFLICT");
 assert.equal(await fs.stat(path.join(workspace,"mismatch.txt")).then(()=>true,()=>false),false);
});

test("copyExclusive preserves an existing destination on exclusive-create collision",{skip:process.platform!=="darwin"?"macOS-only adapter":false},async t=>{
 const {io,workspace}=await fixture(t),source=Buffer.from("new"),existing=Buffer.from("keep");
 await fs.writeFile(path.join(workspace,"source.txt"),source);await fs.writeFile(path.join(workspace,"target.txt"),existing);
 await assert.rejects(io.copyExclusive({workspace_id:"workspace",path:"source.txt"},{workspace_id:"workspace",path:"target.txt"},digest(source)),(error:any)=>error.code==="DESTINATION_EXISTS");
 assert.deepEqual(await fs.readFile(path.join(workspace,"target.txt")),existing);
});

test("copyExclusive captures caller references before its first asynchronous check",{skip:process.platform!=="darwin"?"macOS-only adapter":false},async t=>{
 const {io,workspace}=await fixture(t),original=Buffer.from("captured"),later=Buffer.from("later");
 await fs.writeFile(path.join(workspace,"source.txt"),original);await fs.writeFile(path.join(workspace,"other.txt"),later);
 const source:any={workspace_id:"workspace",path:"source.txt"},dest:any={workspace_id:"workspace",path:"captured.txt"};
 const pending=io.copyExclusive(source,dest,digest(original));source.path="other.txt";dest.path="mutated.txt";
 await pending;
 assert.deepEqual(await fs.readFile(path.join(workspace,"captured.txt")),original);
 assert.equal(await fs.stat(path.join(workspace,"mutated.txt")).then(()=>true,()=>false),false);
});

test("copyExclusive rechecks source grant after reading and before destination creation",{skip:process.platform!=="darwin"?"macOS-only adapter":false},async t=>{
 let sourceAuthorization=0;let registry:WorkspaceRegistry|undefined;
 const authorize=async(id:string)=>{if(id==="reference"&&++sourceAuthorization===2)registry!.revoke("reference");};
 const fixtureValue=await fixture(t,{authorize});registry=fixtureValue.registry;
 const bytes=Buffer.from("reference");await fs.writeFile(path.join(fixtureValue.reference,"source.txt"),bytes);
 await assert.rejects(fixtureValue.io.copyExclusive({workspace_id:"reference",path:"source.txt"},{workspace_id:"workspace",path:"denied.txt"},digest(bytes)),(error:any)=>error.code==="WORKSPACE_NOT_FOUND");
 assert.equal(await fs.stat(path.join(fixtureValue.workspace,"denied.txt")).then(()=>true,()=>false),false);
});

test("copyExclusive rejects source role reselection at the final authorization callback",{skip:process.platform!=="darwin"?"macOS-only adapter":false},async t=>{
 let sourceAuthorization=0;let registry:WorkspaceRegistry|undefined;let reference="";
 const authorize=async(id:string)=>{if(id==="reference"&&++sourceAuthorization===2)await registry!.enrollRolesTrusted([{id:"reference",root:reference,role:"workspace"}]);};
 const value=await fixture(t,{authorize,beforeLoad:async(r,roots)=>{registry=r;reference=roots.reference;}}),bytes=Buffer.from("reference");
 await fs.writeFile(path.join(value.reference,"source.txt"),bytes);
 await assert.rejects(value.io.copyExclusive({workspace_id:"reference",path:"source.txt"},{workspace_id:"workspace",path:"denied.txt"},digest(bytes)),(error:any)=>error.code==="SECURITY_BLOCKED");
 assert.equal(await fs.stat(path.join(value.workspace,"denied.txt")).then(()=>true,()=>false),false);
});

test("copyExclusive rejects a reselected destination after source read",{skip:process.platform!=="darwin"?"macOS-only adapter":false},async t=>{
 let registry:WorkspaceRegistry|undefined;let workspace="";let changed=false;
 const authorize=async(id:string)=>{if(id==="workspace"&&!changed){changed=true;registry!.revoke("workspace");await registry!.enrollRolesTrusted([{id:"workspace",root:workspace,role:"workspace"}]);}};
 const value=await fixture(t,{authorize,beforeLoad:async(r,roots)=>{registry=r;workspace=roots.workspace;}}),bytes=Buffer.from("source");
 await fs.writeFile(path.join(value.workspace,"source.txt"),bytes);
 await assert.rejects(value.io.copyExclusive({workspace_id:"workspace",path:"source.txt"},{workspace_id:"workspace",path:"target.txt"},digest(bytes)),(error:any)=>error.code==="SECURITY_BLOCKED");
 assert.equal(await fs.stat(path.join(value.workspace,"target.txt")).then(()=>true,()=>false),false);
});

test("copyExclusive denies authorization failure at the final pre-create check",{skip:process.platform!=="darwin"?"macOS-only adapter":false},async t=>{
 let sourceAuthorization=0;
 const value=await fixture(t,{authorize:async id=>{if(id==="reference"&&++sourceAuthorization===2)throw Object.assign(Error("test authorization denied"),{code:"SESSION_INVALID"});}}),bytes=Buffer.from("reference");
 await fs.writeFile(path.join(value.reference,"source.txt"),bytes);
 await assert.rejects(value.io.copyExclusive({workspace_id:"reference",path:"source.txt"},{workspace_id:"workspace",path:"denied.txt"},digest(bytes)),(error:any)=>error.code==="SESSION_INVALID");
 assert.equal(await fs.stat(path.join(value.workspace,"denied.txt")).then(()=>true,()=>false),false);
});

test("copyExclusive rejects source root replacement observed after reading",{skip:process.platform!=="darwin"?"macOS-only adapter":false},async t=>{
 let reference="",moved="",replaced=false;
 const authorize=async(id:string)=>{if(id==="workspace"&&!replaced){replaced=true;await fs.rename(reference,moved);await fs.mkdir(reference,{mode:0o700});}};
 const value=await fixture(t,{authorize,beforeLoad:async(_r,roots)=>{reference=roots.reference;moved=path.join(path.dirname(reference),"reference-old");}}),bytes=Buffer.from("reference");
 await fs.writeFile(path.join(value.reference,"source.txt"),bytes);
 await assert.rejects(value.io.copyExclusive({workspace_id:"reference",path:"source.txt"},{workspace_id:"workspace",path:"denied.txt"},digest(bytes)),(error:any)=>error.code==="SECURITY_BLOCKED");
 assert.equal(await fs.stat(path.join(value.workspace,"denied.txt")).then(()=>true,()=>false),false);
 assert.deepEqual(await fs.readFile(path.join(moved,"source.txt")),bytes);
});

test("loader rejects a selected grant whose root or revision differs from the signed proof",{skip:process.platform!=="darwin"?"macOS-only adapter":false},async t=>{
 let reference="";
 await assert.rejects(fixture(t,{beforeLoad:async(registry,roots)=>{
  reference=roots.reference;await registry.enrollRolesTrusted([{id:"reference",root:reference,role:"workspace"}]);
 }}),(error:any)=>error.code==="SECURITY_BLOCKED"&&/grant changed/i.test(error.message));
});

test("copyExclusive reports unknown destination outcomes and leaves partial output for inspection",{skip:process.platform!=="darwin"?"macOS-only adapter":false},async t=>{
 const {io,workspace}=await fixture(t),bytes=Buffer.from("source bytes");await fs.writeFile(path.join(workspace,"source.txt"),bytes);
 await assert.rejects(io.copyExclusive({workspace_id:"workspace",path:"source.txt"},{workspace_id:"workspace",path:"unknown.bin"},digest(bytes)),(error:any)=>error.code==="MUTATION_OUTCOME_UNKNOWN");
 assert.deepEqual(await fs.readFile(path.join(workspace,"unknown.bin")),bytes);
 assert.deepEqual(await fs.readFile(path.join(workspace,"source.txt")),bytes);
});

test("createExclusive rechecks authorization after asynchronous bundle validation",{skip:process.platform!=="darwin"?"macOS-only adapter":false},async t=>{
 let leaseActive=true,authorizationCalls=0;
 const value=await fixture(t,{authorize:async()=>{
  authorizationCalls++;
  if(!leaseActive)throw Object.assign(Error("test lease expired"),{code:"SESSION_INVALID"});
  if(authorizationCalls===1)setImmediate(()=>{leaseActive=false;});
 }});
 await assert.rejects(value.io.createExclusive({workspace_id:"workspace",path:"should-not-exist.txt"},Buffer.from("blocked")),(error:any)=>error.code==="SESSION_INVALID");
 assert.equal(authorizationCalls,2,"authorization must be rechecked after bundle validation");
 assert.equal(await fs.stat(path.join(value.workspace,"should-not-exist.txt")).then(()=>true,()=>false),false);
});
