import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
export const MAC_FILE_SIGNING_PROFILE='gsa-scoped-files-adhoc-single-root-v1';
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const identity=(v:any)=>v&&typeof v.device==='string'&&/^\d+$/.test(v.device)&&typeof v.inode==='string'&&/^\d+$/.test(v.inode);
function fail():never{throw Object.assign(Error('Exact release fixture/containment evidence missing or unresolved'),{code:'SECURITY_BLOCKED'});}
export function requireMacFileBuild(build:any):void{
 if(!build||typeof build.uuid!=='string'||!/^[A-F0-9]{8}(-[A-F0-9]{4}){3}-[A-F0-9]{12}$/.test(build.uuid)||build.driver!=='xcrun-macosx-swiftc-v1'||!build.sdk||typeof build.sdk.path!=='string'||!path.isAbsolute(build.sdk.path)||typeof build.sdk.version!=='string'||!build.sdk.version||!digest(build.sdk.settings_sha256)||!digest(build.source_sha256)||!digest(build.compiler_sha256)||!digest(build.code_sha256)||!digest(build.release_sha256)||typeof build.compiler_version!=='string'||!build.compiler_version.trim()||!isDeepStrictEqual(build.arguments,['-O','-Xlinker','-reproducible'])||build.signing_profile!==MAC_FILE_SIGNING_PROFILE||typeof build.hostRelease!=='string'||build.arch!=='arm64')fail();
}
/** Validates actual fixture receipts, not claimed PASS/check-name lists. These
 * local records remain self-reported evidence; they are not human attestation. */
export function requireMacFileEvidence(e:any,build:any):void{
 requireMacFileBuild(build);
 if(!e||e.format!=='gsa-scoped-files-native-evidence-v2'||!isDeepStrictEqual(e.build,build)||e.signing_profile!==MAC_FILE_SIGNING_PROFILE||!Array.isArray(e.unresolved)||e.unresolved.length)fail();
 const f=e.fixture;
 if(!f||f.owner_fd!==3||f.hostRelease!==build.hostRelease||f.arch!==build.arch||typeof f.stage!=='string'||!path.isAbsolute(f.stage)||!identity(f.stageIdentity)||!Array.isArray(f.roots)||f.roots.length!==2||!f.roots.some((r:any)=>r.role==='workspace')||!f.roots.some((r:any)=>r.role==='reference'))fail();
 const roots=new Set<string>();
 for(const r of f.roots){if(!r||typeof r.id!=='string'||roots.has(r.id)||typeof r.root!=='string'||!path.isAbsolute(r.root)||!identity(r.rootIdentity)||!Number.isSafeInteger(r.revision)||r.revision<1||!['workspace','reference'].includes(r.role)||!r.artifacts||Object.keys(r.artifacts).length!==3||!['Contents/MacOS/broker','Contents/Info.plist','Contents/_CodeSignature/CodeResources'].every(k=>digest(r.artifacts[k]))||r.presign_sha256!==build.release_sha256||r.code_sha256!==build.code_sha256)fail();roots.add(r.id);}
 const o=e.observations;if(!o)fail();
 const absolute=(v:any)=>typeof v==='string'&&path.isAbsolute(v)&&path.normalize(v)===v&&!v.includes('\0');
 const inside=(root:string,v:string)=>{const relative=path.relative(root,v);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
 const request=(q:any,role?:string)=>{const root=f.roots.find((g:any)=>g.id===q?.workspace_id);return root&&(!role||root.role===role)&&q.root===root.root&&q.revision===root.revision&&q.role===root.role&&q.device===root.rootIdentity.device&&q.inode===root.rootIdentity.inode&&typeof q.path==='string'&&q.path.length>0&&!path.isAbsolute(q.path)&&!q.path.includes('\0')&&q.path.split('/').every((part:string)=>part!==''&&part!=='.'&&part!=='..');};
 for(const name of ['create','read','mkdir','copy','collision','staleGrant','artifactMismatch'])if(!request(o[name]?.request,'workspace'))fail();
 for(const name of ['referenceRead','referenceDestination'])if(!request(o[name]?.request,'reference'))fail();
 if(!request(o.copy?.sourceRequest,'reference')||o.copy.sourceRequest.operation!=='read')fail();
 const operations:Record<string,string>={create:'create',read:'read',mkdir:'mkdir',referenceRead:'read',copy:'create',collision:'create',referenceDestination:'create',staleGrant:'create',artifactMismatch:'create'};
 for(const [name,operation] of Object.entries(operations))if(o[name]?.request?.operation!==operation)fail();
 const base64Hash=(value:any)=>{if(typeof value!=='string'||value.length>12*1024*1024)return null;const bytes=Buffer.from(value,'base64');return bytes.length<=8*1024*1024&&bytes.toString('base64')===value?createHash('sha256').update(bytes).digest('hex'):null;};
 for(const name of ['create','copy','collision','referenceDestination','staleGrant','artifactMismatch'])if(!base64Hash(o[name].request.base64))fail();
 if(base64Hash(o.create.request.base64)!==o.create.expected_sha256||base64Hash(o.copy.request.base64)!==o.copy.expected_sha256||o.copy.expected_sha256!==o.referenceRead.expected_sha256||o.copy.request.base64!==o.referenceRead.response?.base64||!isDeepStrictEqual(o.copy.sourceRequest,o.referenceRead.request)||o.read.request.workspace_id!==o.create.request.workspace_id||o.read.request.path!==o.create.request.path||o.read.expected_sha256!==o.create.expected_sha256)fail();
 const same=(a:any,b:any)=>digest(a)&&a===b;
 const success=(v:any)=>v?.ok===true;
 const denied=(v:any)=>typeof v==='string'&&/SECURITY_BLOCKED|PERMISSION_DENIED|WORKSPACE_NOT_FOUND|Broker changed|grant changed|revoked|AUTH|LEASE/.test(v);
 for(const name of ['create','copy'])if(!success(o[name]?.response)||!same(o[name]?.expected_sha256,o[name]?.readback_sha256))fail();
 for(const name of ['read','referenceRead']){const r=o[name];if(!success(r?.response)||!digest(r.expected_sha256)||r.response.sha256!==r.expected_sha256||typeof r.response.base64!=='string'||createHash('sha256').update(Buffer.from(r.response.base64,'base64')).digest('hex')!==r.expected_sha256)fail();}
 if(!success(o.mkdir?.response)||o.mkdir.isDirectory!==true||!['DESTINATION_EXISTS','ALREADY_EXISTS_OR_DENIED'].includes(o.collision?.error)||!same(o.collision.before_sha256,o.collision.after_sha256))fail();
 for(const name of ['referenceDestination','staleGrant','artifactMismatch']){const error=o[name]?.error;const accepted=denied(error)||(name==='staleGrant'&&error==='WORKSPACE_GRANT_REVOKED');if(!accepted||o[name].absent!==true)fail();}
 if(!Array.isArray(o.outsideCanaries)||o.outsideCanaries.length<1||o.outsideCanaries.some((c:any)=>!absolute(c.path)||f.roots.some((root:any)=>inside(root.root,c.path))||!same(c.before_sha256,c.after_sha256)))fail();
 const r=o.interiorRelocation;
 // The bounded native probe always submits exactly 8MiB of byte 0x5a. Keep
 // this one fixed descriptor so the private envelope stays below 1MiB; rebuild
 // the actual canonical native JSON (base64 last) and verify its captured hash.
 if(!r||!request(r.request,'workspace')||!absolute(r.parentPath)||!absolute(r.relocatedPath)||r.request?.payload_ref!=='interiorRelocation.payload'||!r.payload||r.payload.encoding!=='repeat-byte-v1'||r.payload.byte!==90||r.payload.length!==8*1024*1024||!digest(r.payload.sha256))fail();
 const metadata=['operation','workspace_id','role','root','device','inode','revision','path'];
 if(!isDeepStrictEqual(Object.keys(r.request).sort(),[...metadata,'payload_ref'].sort()))fail();
 const payload=Buffer.alloc(8*1024*1024,90);if(createHash('sha256').update(payload).digest('hex')!==r.payload.sha256)fail();
 const nativeRequest:Record<string,unknown>={};for(const key of metadata)nativeRequest[key]=r.request[key];nativeRequest.base64=payload.toString('base64');
 const serialized=JSON.stringify(nativeRequest);if(r.request_bytes!==Buffer.byteLength(serialized)||r.request_bytes>12*1024*1024||r.request_sha256!==createHash('sha256').update(serialized).digest('hex'))fail();
 const target=path.join(r.request.root,r.request.path),outsideTarget=path.join(r.relocatedPath??'',path.basename(r.request.path));
 if(r.parentPath!==path.dirname(target)||r.targetBeforeMove?.path!==target||r.targetBeforeMove?.exists!==false||r.targetOutsideBefore?.path!==outsideTarget||r.targetOutsideBefore?.exists!==false||r.targetOutsideAfter?.path!==outsideTarget||r.targetOutsideAfter?.exists!==false)fail();
 const stop=r.stopConfirmation;if(!stop||stop.pid!==r.pid||stop.signal!=='SIGSTOP'||typeof stop.state!=='string'||!/^T/.test(stop.state)||stop.fd!==r.fd||!isDeepStrictEqual(stop.parentIdentity,r.parentIdentity))fail();
 const phases=['stopConfirmed','targetAbsentBeforeMove','parentRelocated','outsideTargetAbsentBeforeResume','resumed','outsideTargetObservedAfterResume'];
 if(!r.timeline||!isDeepStrictEqual(Object.keys(r.timeline).sort(),[...phases].sort()))fail();
 for(let i=0;i<phases.length;i++){const time=r.timeline[phases[i]];if(typeof time!=='number'||!Number.isFinite(time)||time<0||(i>0&&time<=r.timeline[phases[i-1]]))fail();}

 if(!r||r.status!=='OBSERVED'||r.observation_method!=='libproc-owned-pid-fd-v1'||!request(r.request,'workspace')||r.request.operation!=='create'||!absolute(r.parentPath)||!absolute(r.relocatedPath)||!f.roots.some((root:any)=>root.role==='workspace'&&inside(root.root,r.parentPath))||f.roots.some((root:any)=>inside(root.root,r.relocatedPath)||inside(r.relocatedPath,root.root))||!Number.isSafeInteger(r.pid)||r.pid<1||!Number.isSafeInteger(r.fd)||r.fd<0||!identity(r.parentIdentity)||!isDeepStrictEqual(r.parentIdentity,r.relocatedIdentity)||r.stopped!==true||r.resumed!==true||r.response?.ok!==false||!['ALREADY_EXISTS_OR_DENIED','PATH_OR_ACCESS_DENIED','SECURITY_BLOCKED','ROOT_UNVERIFIED'].includes(r.response.error)||r.outsideTargetAbsent!==true)fail();
}
