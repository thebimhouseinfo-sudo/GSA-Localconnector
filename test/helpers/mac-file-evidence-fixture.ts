import {createHash} from 'node:crypto';

const hash=createHash('sha256').update('fixture bytes').digest('hex');

/** A complete synthetic receipt understood by requireMacFileEvidence.
 * The historical roots are evidence fixture inputs only, not installed grants. */
export function receiptSample(hostRelease='schema-test',arch='arm64'){
 const build={uuid:'00000000-0000-0000-0000-000000000000',source_sha256:hash,compiler_sha256:hash,driver:'xcrun-macosx-swiftc-v1',sdk:{path:'/synthetic/sdk',version:'test',settings_sha256:'0'.repeat(64)},compiler_version:'synthetic schema test',release_sha256:hash,code_sha256:hash,arguments:['-O','-Xlinker','-reproducible'],signing_profile:'gsa-scoped-files-adhoc-single-root-v1',hostRelease,arch};
 const response=()=>({ok:true,sha256:hash,base64:Buffer.from('fixture bytes').toString('base64')});
 const identity={device:'1',inode:'2'};
 const e:any={format:'gsa-scoped-files-native-evidence-v2',build,signing_profile:build.signing_profile,fixture:{owner_fd:3,hostRelease:build.hostRelease,arch:build.arch,stage:'/private/fixture/identity/stage',stageIdentity:{...identity},roots:['workspace','reference'].map((role,i)=>({id:role,role,root:'/private/fixture/'+role,rootIdentity:{device:'1',inode:String(i+3)},revision:1,presign_sha256:hash,code_sha256:hash,artifacts:Object.fromEntries(['Contents/MacOS/broker','Contents/Info.plist','Contents/_CodeSignature/CodeResources'].map(k=>[k,hash]))}))},observations:{create:{response:{ok:true},expected_sha256:hash,readback_sha256:hash},read:{response:response(),expected_sha256:hash},mkdir:{response:{ok:true},isDirectory:true},referenceRead:{response:response(),expected_sha256:hash},copy:{response:{ok:true},expected_sha256:hash,readback_sha256:hash},collision:{error:'ALREADY_EXISTS_OR_DENIED',before_sha256:hash,after_sha256:hash},referenceDestination:{error:'PERMISSION_DENIED',absent:true},staleGrant:{error:'SECURITY_BLOCKED',absent:true},artifactMismatch:{error:'SECURITY_BLOCKED',absent:true},outsideCanaries:[{path:'/private/fixture/outside/canary',before_sha256:hash,after_sha256:hash}],interiorRelocation:{status:'OBSERVED',observation_method:'libproc-owned-pid-fd-v1',pid:123,fd:5,parentPath:'/private/fixture/workspace/parent',relocatedPath:'/private/fixture/outside/parent',parentIdentity:{...identity},relocatedIdentity:{...identity},stopped:true,resumed:true,response:{ok:false,error:'SECURITY_BLOCKED'},outsideTargetAbsent:true}},unresolved:[]};
 const q=(role:string)=>({workspace_id:role,root:'/private/fixture/'+role,revision:1,path:'file.txt',role,device:'1',inode:role==='workspace'?'3':'4',operation:'create',base64:Buffer.from('fixture bytes').toString('base64')});
 for(const name of ['create','read','mkdir','copy','collision','staleGrant','artifactMismatch'])Object.assign(e.observations[name],{request:q('workspace')});
 for(const name of ['referenceRead','referenceDestination'])Object.assign(e.observations[name],{request:q('reference')});
 Object.assign(e.observations.copy,{sourceRequest:q('reference')});
 Object.assign(e.observations.interiorRelocation,{request:{...q('workspace'),operation:'create'}});
 for(const [name,operation] of Object.entries({create:'create',read:'read',mkdir:'mkdir',referenceRead:'read',copy:'create',collision:'create',referenceDestination:'create',staleGrant:'create',artifactMismatch:'create'}))e.observations[name].request.operation=operation;
 e.observations.copy.sourceRequest={...e.observations.referenceRead.request};
 const r=e.observations.interiorRelocation;
 delete r.request.base64;r.request.path='parent/file.txt';r.request.payload_ref='interiorRelocation.payload';
 const bytes=Buffer.alloc(8*1024*1024,90);r.payload={encoding:'repeat-byte-v1',byte:90,length:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 const raw:any={};for(const key of ['operation','workspace_id','role','root','device','inode','revision','path'])raw[key]=r.request[key];raw.base64=bytes.toString('base64');const serialized=JSON.stringify(raw);r.request_bytes=Buffer.byteLength(serialized);r.request_sha256=createHash('sha256').update(serialized).digest('hex');
 r.targetBeforeMove={path:'/private/fixture/workspace/parent/file.txt',exists:false};r.targetOutsideBefore={path:'/private/fixture/outside/parent/file.txt',exists:false};r.targetOutsideAfter={...r.targetOutsideBefore};r.stopConfirmation={pid:r.pid,signal:'SIGSTOP',state:'T',fd:r.fd,parentIdentity:{...r.parentIdentity}};r.timeline={stopConfirmed:1,targetAbsentBeforeMove:2,parentRelocated:3,outsideTargetAbsentBeforeResume:4,resumed:5,outsideTargetObservedAfterResume:6};
 return e;
}
