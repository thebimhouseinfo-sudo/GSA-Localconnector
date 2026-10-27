import path from "node:path";
import {isDeepStrictEqual} from "node:util";
import {validateDirectoryCapture} from "../core/directory-copy.js";
import {validateWorkspaceRelative} from "../core/workspace-path.js";

export interface DirectoryTreeBuild {
 readonly uuid:string;readonly driver:string;readonly sdk:{readonly path:string;readonly version:string;readonly settings_sha256:string};
 readonly source_sha256:string;readonly compiler_sha256:string;readonly code_sha256:string;readonly release_sha256:string;
 readonly compiler_version:string;readonly arguments:readonly string[];readonly signing_profile:"gsa-directory-tree-readonly-single-root-v1";readonly hostRelease:string;readonly arch:"arm64";
}
export interface DirectoryTreeBinding {
 readonly id:string;readonly root:string;readonly rootIdentity:{readonly device:string;readonly inode:string};readonly revision:number;readonly role:"workspace"|"reference";
 readonly artifacts:{readonly "Contents/MacOS/tree-broker":string;readonly "Contents/Info.plist":string;readonly "Contents/_CodeSignature/CodeResources":string};
 readonly presign_sha256:string;readonly code_sha256:string;
}
export interface DirectoryInstallationProof {
 readonly format:"gsa-directory-copy-installation-v1";readonly hostRelease:string;readonly arch:"arm64";readonly build:DirectoryTreeBuild;readonly grants:readonly DirectoryTreeBinding[];
 readonly evidence_file:"native-evidence.json";readonly evidence_sha256:string;
}
const fail=():never=>{throw Object.assign(Error("Invalid directory tree evidence or binding"),{code:"SECURITY_BLOCKED"});};
function obj(value:unknown,keys:readonly string[]):Record<string,any>{
 if(!value||typeof value!=="object"||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();
 const v=value as Record<string,any>,actual=Reflect.ownKeys(v);
 if(actual.length!==keys.length||actual.some(k=>typeof k!=="string"||!keys.includes(k))||keys.some(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return !d||d.get||d.set;}))fail();return v;
}
const digest=(v:unknown)=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const text=(v:unknown,max=4096):v is string=>typeof v==="string"&&v.length>0&&Buffer.byteLength(v)<=max&&Buffer.from(v).toString("utf8")===v&&!v.includes("\0");
const absolute=(v:unknown):v is string=>text(v)&&path.isAbsolute(v)&&path.normalize(v)===v&&v!=="/";
const inside=(root:string,v:string)=>v===root||v.startsWith(root+"/");
function identity(v:unknown):void {const i=obj(v,["device","inode"]);if(![i.device,i.inode].every(n=>typeof n==="string"&&/^(0|[1-9][0-9]{0,31})$/.test(n)))fail();}
function binding(v:unknown,build:DirectoryTreeBuild):DirectoryTreeBinding {
 const b=obj(v,["id","root","rootIdentity","revision","role","artifacts","presign_sha256","code_sha256"]);identity(b.rootIdentity);
 if(!text(b.id,64)||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(b.id)||!absolute(b.root)||!Number.isSafeInteger(b.revision)||b.revision<1||!["workspace","reference"].includes(b.role)||b.presign_sha256!==build.release_sha256||b.code_sha256!==build.code_sha256)fail();
 const a=obj(b.artifacts,["Contents/MacOS/tree-broker","Contents/Info.plist","Contents/_CodeSignature/CodeResources"]);if(!Object.values(a).every(digest))fail();return b as DirectoryTreeBinding;
}
export function requireMacDirectoryBuild(value:unknown):void {
 const b=obj(value,["uuid","driver","sdk","source_sha256","compiler_sha256","code_sha256","release_sha256","compiler_version","arguments","signing_profile","hostRelease","arch"]),s=obj(b.sdk,["path","version","settings_sha256"]);
 if(typeof b.uuid!=="string"||!/^[A-F0-9]{8}(-[A-F0-9]{4}){3}-[A-F0-9]{12}$/.test(b.uuid)||b.driver!=="xcrun-macosx-swiftc-v1"||!absolute(s.path)||!text(s.version,256)||!digest(s.settings_sha256)||![b.source_sha256,b.compiler_sha256,b.code_sha256,b.release_sha256].every(digest)||!text(b.compiler_version,16384)||!b.compiler_version.trim()||!isDeepStrictEqual(b.arguments,["-O","-Xlinker","-reproducible"])||b.signing_profile!=="gsa-directory-tree-readonly-single-root-v1"||!text(b.hostRelease,256)||b.arch!=="arm64")fail();
}
/** Pure structural validation of raw receipts. This does not attest native execution. */
export function requireMacDirectoryEvidence(value:unknown,build:DirectoryTreeBuild):void {
 try{validateEvidence(value,build);}catch{fail();}
}
function validateEvidence(value:unknown,build:DirectoryTreeBuild):void {
 requireMacDirectoryBuild(build);
 const e=obj(value,["format","build","fixture","observations","unresolved"]);
 if(Buffer.byteLength(JSON.stringify(e))>1_048_576||e.format!=="gsa-directory-tree-native-evidence-v1"||!isDeepStrictEqual(e.build,build)||!Array.isArray(e.unresolved)||e.unresolved.length)fail();
 const f=obj(e.fixture,["stage","stageIdentity","hostRelease","arch","owner_fd","roots","outsideCanaries"]);identity(f.stageIdentity);
 if(!absolute(f.stage)||f.hostRelease!==build.hostRelease||f.arch!==build.arch||f.owner_fd!==3||!Array.isArray(f.roots)||f.roots.length!==2)fail();
 const roots=f.roots.map((r:unknown)=>binding(r,build)) as DirectoryTreeBinding[];
 if(new Set(roots.map(r=>r.id)).size!==2||new Set(roots.map(r=>r.role)).size!==2||roots.some(r=>!inside(f.stage,r.root)||r.root===f.stage)||inside(roots[0]!.root,roots[1]!.root)||inside(roots[1]!.root,roots[0]!.root))fail();
 if(!Array.isArray(f.outsideCanaries)||!f.outsideCanaries.length||f.outsideCanaries.length>1024)fail();
 const canaries=new Set<string>();for(const raw of f.outsideCanaries){const c=obj(raw,["path","before_sha256","after_sha256"]);if(!absolute(c.path)||!inside(f.stage,c.path)||roots.some(r=>inside(r.root,c.path))||!digest(c.before_sha256)||c.before_sha256!==c.after_sha256||canaries.has(c.path))fail();canaries.add(c.path);}
 const names=["workspaceCapture","referenceCapture","unsafeSymlink","unsafeHardlink","unsafeSpecial","overLimit","staleBinding","ungrantedPath","invalidWriteRequest","relocation"];
 const o=obj(e.observations,names),qkeys=["operation","workspace_id","role","root","device","inode","revision","path"];
 function request(raw:unknown,kind:string):{q:Record<string,any>;root:DirectoryTreeBinding}{
  const q=obj(raw,qkeys),root=roots.find(r=>r.id===q.workspace_id);if(!root)return fail();if(q.role!==root.role||q.root!==root.root||q.device!==root.rootIdentity.device||q.inode!==root.rootIdentity.inode||!text(q.path)||Buffer.byteLength(JSON.stringify(q))>65536||q.operation!==(kind==="invalidWriteRequest"?"create":"capture_tree"))fail();
  if(kind==="staleBinding"){if(!Number.isSafeInteger(q.revision)||q.revision<1||q.revision===root.revision)fail();}else if(q.revision!==root.revision)fail();
  if(kind==="ungrantedPath"){if(!q.path.split("/").includes(".."))fail();}else validateWorkspaceRelative(q.path,true);
  return {q,root};
 }
 function denied(raw:unknown,codes:readonly string[]):void {const r=obj(raw,["ok","error"]);if(r.ok!==false||!codes.includes(r.error))fail();}
 for(const name of names.slice(0,9)){
  const receipt=obj(o[name],["request","response"]),{q,root}=request(receipt.request,name);
  if(name==="workspaceCapture"||name==="referenceCapture"){
   if(root.role!==(name==="workspaceCapture"?"workspace":"reference")||q.path!==".")fail();
   const r=obj(receipt.response,["ok","format","binding","capture"]),expected={...q};delete expected.operation;
   if(r.ok!==true||r.format!=="gsa-directory-capture-response-v1"||!isDeepStrictEqual(r.binding,expected)||Buffer.byteLength(JSON.stringify(r))>12_582_912)fail();
   const c=validateDirectoryCapture(r.capture),first=c.observations[0];
   if(!first||first.device!==root.rootIdentity.device||first.inode!==root.rootIdentity.inode||!c.manifest.entries.some(v=>v.kind==="file"&&v.path.includes("/"))||!c.manifest.entries.some(v=>v.kind==="directory"&&v.path!==""&&!c.manifest.entries.some(child=>child.path.startsWith(v.path+"/"))))fail();
  }else denied(receipt.response,name.startsWith("unsafe")?["UNSAFE_FILE_TYPE"]:name==="overLimit"?["BYTE_LIMIT_EXCEEDED","DEPTH_LIMIT_EXCEEDED","ENTRY_LIMIT_EXCEEDED","MANIFEST_LIMIT_EXCEEDED","RESPONSE_LIMIT_EXCEEDED"]:name==="staleBinding"?["GRANT_BINDING_MISMATCH"]:name==="ungrantedPath"?["PATH_OUTSIDE_SCOPE","PATH_OR_ACCESS_DENIED"]:["INVALID_REQUEST","INVALID_OPERATION"]);
 }
 const r=obj(o.relocation,["request","pid","fd","parentIdentity","relocatedIdentity","parentPath","relocatedPath","stopConfirmation","timeline","response","outside_content_returned"]),{q,root}=request(r.request,"relocation");
 identity(r.parentIdentity);identity(r.relocatedIdentity);
 if(q.path==="."||r.parentPath!==path.join(root.root,q.path)||!absolute(r.relocatedPath)||!inside(f.stage,r.relocatedPath)||roots.some(v=>inside(v.root,r.relocatedPath)||inside(r.relocatedPath,v.root))||!isDeepStrictEqual(r.parentIdentity,r.relocatedIdentity)||!Number.isSafeInteger(r.pid)||r.pid<1||!Number.isSafeInteger(r.fd)||r.fd<0||r.outside_content_returned!==false)fail();
 const stop=obj(r.stopConfirmation,["pid","signal","state","fd","parentIdentity"]);if(stop.pid!==r.pid||stop.signal!=="SIGSTOP"||!text(stop.state,256)||!stop.state.startsWith("T")||stop.fd!==r.fd||!isDeepStrictEqual(stop.parentIdentity,r.parentIdentity))fail();
 const phases=["stopConfirmed","parentRelocated","resumed","responseObserved"],timeline=obj(r.timeline,phases);let previous=-1;for(const phase of phases){const now=timeline[phase];if(typeof now!=="number"||!Number.isFinite(now)||now<0||now<=previous)fail();previous=now;}
 denied(r.response,["PATH_OUTSIDE_SCOPE","PATH_OR_ACCESS_DENIED","ROOT_UNVERIFIED","CONCURRENT_CHANGE","UNSAFE_DIRECTORY"]);
}
