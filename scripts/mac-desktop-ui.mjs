/** Keep signed UI bytes independent of backend releases. This is artifact
 * compatibility metadata, not an OS permission grant or build attestation. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {verifyReleaseManifest} from './desktop-release.mjs';

const fail=code=>Object.assign(new Error(code),{code});
const demand=(value,code='UI_ARTIFACT_INVALID')=>{if(!value)throw fail(code);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&isDeepStrictEqual(Object.keys(value).sort(),[...names].sort());
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const id=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const bundleName='GSA Local Connector.app';
const provenanceName='ui-provenance.json';
const bundleDirectories=new Set(['Contents','Contents/MacOS','Contents/Resources','Contents/_CodeSignature']);
const inputNames=Object.freeze(['native/macos-desktop/App.swift','native/macos-desktop/Info.plist','scripts/build-desktop-icons.mjs','assets/desktop/LICENSE','assets/desktop/plug-zap.svg']);
export const uiBundleFiles=Object.freeze(['Contents/Info.plist','Contents/MacOS/GSA Local Connector','Contents/Resources/GSAConnector.icns','Contents/Resources/Icon-LICENSE.txt','Contents/Resources/desktop-config-path.txt','Contents/_CodeSignature/CodeResources']);
const recipe='gsa-native-menu-ui-v1',target='arm64-apple-macos13.0';
const legacy=Object.freeze({
 profile:'mac-desktop-55ad-v1',releaseId:'55ad944c-1c1e-4fd0-aab0-b0010989d602',
 manifestSha256:'0c8f1d21ca9c5ab0c2040630737d347662121d99206d363c900688d5776bc947',
 configPath:'/Users/nam/Library/Application Support/GSA-Localconnector/desktop/config.json',
 identity:Object.freeze({identifier:'com.gsa-localconnector.mac.desktop',cdhash:'a479648ab256361ace475c354c573e9a17352fc3',designatedRequirement:'cdhash H"a479648ab256361ace475c354c573e9a17352fc3"'}),
 inputs:Object.freeze({
  'native/macos-desktop/App.swift':'edf9e28f8e00348d3f4b4784185dfab2f3891d4f1beee460dcabc9ce69ee34d9',
  'native/macos-desktop/Info.plist':'536113345f5e3969d80e752e73f89139506df0bc7f1b515bbf3f12c7686a8a32',
  'scripts/build-desktop-icons.mjs':'524903571a9b4c8059ae0f6a700f2f1587d4970ea7c3c82d155e3f9f8eeacbe9',
  'assets/desktop/LICENSE':'dde6b9ebb537c9640e9e385caf539e19be2edf87cf1c51156d3de39f2e38fe8e',
  'assets/desktop/plug-zap.svg':'5f1ba0585c27d8c8ba573d134a1566cd41a044b282769ccb8dd8486d04eda8ef'
 }),
 files:Object.freeze({
  'Contents/MacOS/GSA Local Connector':'ef1b4d5541b61269e55355976aea0bbe28e3a4b036c22c152618866346b25bc4',
  'Contents/Info.plist':'536113345f5e3969d80e752e73f89139506df0bc7f1b515bbf3f12c7686a8a32',
  'Contents/Resources/desktop-config-path.txt':'c6967f43d9a43491bb2652fccebbf155dae5d454af4cbf63a43696104e09959c',
  'Contents/Resources/GSAConnector.icns':'83ca802d9ce134f893a460fc8f7105151486bb58c1e18697dc1555f967bdd040',
  'Contents/Resources/Icon-LICENSE.txt':'dde6b9ebb537c9640e9e385caf539e19be2edf87cf1c51156d3de39f2e38fe8e',
  'Contents/_CodeSignature/CodeResources':'6557a8bced9c1c0f276ddee67bce0fb29b5e936bf52317dcca00b12d166301fd'
 })
});
const currentLegacy=Object.freeze({...legacy,
 profile:'mac-desktop-508bf-v1',releaseId:'508bf766-23c5-4cac-9e8c-81731203957e',
 manifestSha256:'07321da715be695758bc4838f304c992578214b727bf6afa88c393ad79fa9574',
 identity:Object.freeze({identifier:'com.gsa-localconnector.mac.desktop',cdhash:'b6b8d4c24be7201385f7a77e9848b3d30860c093',designatedRequirement:'cdhash H"b6b8d4c24be7201385f7a77e9848b3d30860c093"'}),
 files:Object.freeze({...legacy.files,
  'Contents/MacOS/GSA Local Connector':'9b119d1f2a4feab3dadf164440f34a53f430783e43c2c991b6281c20488c5784',
  'Contents/Resources/GSAConnector.icns':'6348fd0ca8bfecf47729d71928c184374d2a94e764f224314f3b8c28c3d8c32c',
  'Contents/_CodeSignature/CodeResources':'ca1d22d5a89e61a089984abd559e2aff6ef5e2e8e2a5426843980979345b9036'
 })
});
const legacyProfiles=Object.freeze([currentLegacy,legacy]);
const profileFor=releaseId=>legacyProfiles.find(profile=>profile.releaseId===releaseId);
export function legacyUiProfile(){return JSON.parse(JSON.stringify(legacy));}
export function currentUiProfile(){return JSON.parse(JSON.stringify(currentLegacy));}
function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 return JSON.stringify(value);
}
function makeIntent(files,configPath){
 const body={format:'gsa-desktop-ui-intent-v1',files:{...files},configPath,target,recipe};
 return {...body,fingerprint:sha(canonical(body))};
}
function validateIntent(intent){
 demand(intent?.format==='gsa-desktop-ui-intent-v1'&&intent.target===target&&intent.recipe===recipe&&typeof intent.configPath==='string'&&path.isAbsolute(intent.configPath)&&path.normalize(intent.configPath)===intent.configPath&&!intent.configPath.includes('\0'),'UI_INTENT_INVALID');
 demand(intent.files&&isDeepStrictEqual(Object.keys(intent.files).sort(),[...inputNames].sort())&&Object.values(intent.files).every(digest),'UI_INTENT_INVALID');
 demand(isDeepStrictEqual(intent,makeIntent(intent.files,intent.configPath)),'UI_INTENT_INVALID');return intent;
}
async function ancestry(directory,{privateLeaf=false}={}){
 demand(path.isAbsolute(directory)&&path.normalize(directory)===directory&&!directory.includes('\0')&&await fs.realpath(directory)===directory,'UI_PATH_UNSAFE');
 const chain=[];for(let p=directory;;p=path.dirname(p)){chain.unshift(p);if(p===path.dirname(p))break;}
 for(const dir of chain){const st=await fs.lstat(dir);demand(st.isDirectory()&&!st.isSymbolicLink(),'UI_PATH_UNSAFE');
  demand([0,process.getuid()].includes(st.uid)&&((st.mode&0o022)===0||st.uid===0&&(st.mode&0o1000)!==0),'UI_PATH_UNSAFE');
 }
 if(privateLeaf){const st=await fs.lstat(directory);demand(st.uid===process.getuid()&&(st.mode&0o777)===0o700,'UI_PATH_UNSAFE');}
}
async function readRegular(file,max=16*1024*1024){
 demand(path.isAbsolute(file)&&await fs.realpath(file)===file,'UI_PATH_UNSAFE');
 const before=await fs.lstat(file);demand(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1&&before.uid===process.getuid()&&(before.mode&0o022)===0&&before.size<=max,'UI_FILE_UNSAFE');
 const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const opened=await handle.stat();demand(opened.dev===before.dev&&opened.ino===before.ino,'UI_FILE_CHANGED');
  const bytes=Buffer.alloc(before.size+1);let length=0;while(length<bytes.length){const got=await handle.read(bytes,length,bytes.length-length,length);if(!got.bytesRead)break;length+=got.bytesRead;}
  const after=await handle.stat(),visible=await fs.lstat(file);
  demand(length===before.size&&after.ctimeMs===before.ctimeMs&&after.mtimeMs===before.mtimeMs&&visible.dev===before.dev&&visible.ino===before.ino,'UI_FILE_CHANGED');return bytes.subarray(0,length);
 }finally{await handle.close();}
}
async function absent(file){try{await fs.lstat(file);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}}
async function bundleFiles(bundle){
 await ancestry(bundle,{privateLeaf:true});const found=[];
 async function walk(directory,prefix=''){const entries=await fs.readdir(directory);demand(entries.length<=32,'UI_INVENTORY_LIMIT');
  for(const name of entries){demand(!name.includes('/')&&name!=='.'&&name!=='..','UI_PATH_UNSAFE');const rel=prefix?prefix+'/'+name:name,file=path.join(directory,name),st=await fs.lstat(file);
   if(st.isDirectory()&&!st.isSymbolicLink()){demand(bundleDirectories.has(rel),'UI_INVENTORY_INVALID');demand(st.uid===process.getuid()&&(st.mode&0o777)===0o700&&rel.split('/').length<=4,'UI_PATH_UNSAFE');await walk(file,rel);}
   else{demand(st.isFile()&&!st.isSymbolicLink()&&st.nlink===1,'UI_FILE_UNSAFE');found.push(rel);demand(found.length<=uiBundleFiles.length,'UI_INVENTORY_LIMIT');}
  }
 }
 await walk(bundle);demand(isDeepStrictEqual(found.sort(),[...uiBundleFiles].sort()),'UI_INVENTORY_INVALID');
 const files={};for(const name of uiBundleFiles)files[name]=sha(await readRegular(path.join(bundle,name)));return files;
}
export async function describeUiIntent({sourceRoot,configPath}){
 await ancestry(sourceRoot);const files={};for(const name of inputNames)files[name]=sha(await readRegular(path.join(sourceRoot,name),1024*1024));
 return validateIntent(makeIntent(files,configPath));
}
/** Pure policy comparator. It reads no artifact, writes nothing and grants no
 * installer admission. Production selection always uses its fixed legacy pin. */
export function validateLegacyUiDescriptor(descriptor){
 const profile=profileFor(descriptor?.releaseId);demand(profile,'UI_LEGACY_MISMATCH');
 const desired=makeIntent(profile.inputs,profile.configPath);
 demand(descriptor.manifestSha256===profile.manifestSha256&&isDeepStrictEqual(descriptor.files,profile.files)&&isDeepStrictEqual(descriptor.identity,profile.identity)&&isDeepStrictEqual(descriptor.desiredIntent,desired),'UI_LEGACY_MISMATCH');
 return {format:'gsa-desktop-ui-provenance-v1',desiredIntent:desired,artifact:{files:{...profile.files},identity:{...profile.identity}},origin:'reviewed-legacy-artifact-adoption',sourceBuildAttestation:'unavailable',legacy:{profile:profile.profile,releaseId:profile.releaseId,manifestSha256:profile.manifestSha256}};
}
/** Pure fixed-profile decision only; this cannot admit any filesystem artifact.
 * The production caller first verifies the managed release and all pinned bytes. */
export function selectLegacyUiDescriptor({descriptor,intent}){
 validateIntent(intent);const provenance=validateLegacyUiDescriptor(descriptor);
 return isDeepStrictEqual(intent,provenance.desiredIntent)?{decision:'reuse',provenance}:{decision:'build',reason:'UI_INTENT_CHANGED'};
}
function validateRecord(record){
 demand(record?.format==='gsa-desktop-ui-provenance-v1','UI_PROVENANCE_INVALID');
 const names=['format','desiredIntent','artifact','origin','sourceBuildAttestation',record.origin==='reviewed-legacy-artifact-adoption'?'legacy':'build'];if(record.reusedFrom!==undefined)names.push('reusedFrom');
 demand(keys(record,names)&&keys(record.artifact,['files','identity']),'UI_PROVENANCE_INVALID');validateIntent(record.desiredIntent);
 demand(record.artifact?.files&&isDeepStrictEqual(Object.keys(record.artifact.files).sort(),[...uiBundleFiles].sort())&&Object.values(record.artifact.files).every(digest),'UI_PROVENANCE_INVALID');
 demand(record.artifact.files['Contents/Info.plist']===record.desiredIntent.files['native/macos-desktop/Info.plist']&&record.artifact.files['Contents/Resources/Icon-LICENSE.txt']===record.desiredIntent.files['assets/desktop/LICENSE']&&record.artifact.files['Contents/Resources/desktop-config-path.txt']===sha(record.desiredIntent.configPath),'UI_RESOURCE_INTENT_MISMATCH');
 if(record.reusedFrom!==undefined)demand(id(record.reusedFrom?.releaseId)&&digest(record.reusedFrom?.manifestSha256)&&isDeepStrictEqual(Object.keys(record.reusedFrom).sort(),['manifestSha256','releaseId']),'UI_PROVENANCE_INVALID');
 const identity=record.artifact.identity;demand(keys(identity,['identifier','cdhash','designatedRequirement'])&&identity.identifier==='com.gsa-localconnector.mac.desktop'&&/^[a-f0-9]{40}$/.test(identity.cdhash)&&identity.designatedRequirement===`cdhash H"${identity.cdhash}"`,'UI_PROVENANCE_INVALID');
 if(record.origin==='reviewed-legacy-artifact-adoption'){
  const profile=profileFor(record.legacy?.releaseId);
  demand(profile&&record.sourceBuildAttestation==='unavailable'&&isDeepStrictEqual(record.legacy,{profile:profile.profile,releaseId:profile.releaseId,manifestSha256:profile.manifestSha256}),'UI_PROVENANCE_INVALID');
  validateLegacyUiDescriptor({releaseId:record.legacy.releaseId,manifestSha256:record.legacy.manifestSha256,files:record.artifact.files,identity,desiredIntent:record.desiredIntent});
 }else{
  const buildKeys=['target','recipe'];if(record.build?.compilerVersion!==undefined)buildKeys.push('compilerVersion');
  demand(record.origin==='observed-local-build'&&record.sourceBuildAttestation==='observed-local-build'&&keys(record.build,buildKeys)&&record.build.target===target&&record.build.recipe===recipe&&(record.build.compilerVersion===undefined||record.build.compilerVersion===null||typeof record.build.compilerVersion==='string'&&record.build.compilerVersion.length<=128),'UI_PROVENANCE_INVALID');
 }
 return record;
}
// Bound the complete candidate before the general verifier performs recursive
// inventory or whole-file reads. Keep the general manifest check unchanged.
async function candidatePreflight(root,manifest){
 demand(manifest?.format==='gsa-desktop-release-v1'&&manifest.platform==='darwin'&&manifest.arch==='arm64'&&manifest.files&&typeof manifest.files==='object'&&!Array.isArray(manifest.files),'UI_RELEASE_UNSAFE');
 const names=Object.keys(manifest.files);demand(names.length>0&&names.length<=8192,'UI_INVENTORY_LIMIT');
 for(const name of names)demand(name.length<=1024&&!name.includes('\\')&&!/[\u0000-\u001f\u007f]/.test(name)&&!path.posix.isAbsolute(name)&&path.posix.normalize(name)===name&&name.split('/').every(part=>part&&part!=='.'&&part!=='..')&&name.split('/').length<=16&&digest(manifest.files[name]),'UI_RELEASE_UNSAFE');
 const found=[];let entriesSeen=0,totalBytes=0;
 async function walk(directory,prefix='',depth=0){
  demand(depth<=16,'UI_INVENTORY_LIMIT');
  // Streaming enumeration bounds even a directory containing unlisted extras.
  const handle=await fs.opendir(directory);
  try{for await(const entry of handle){
   demand(++entriesSeen<=16384,'UI_INVENTORY_LIMIT');
   const rel=prefix?prefix+'/'+entry.name:entry.name,file=path.join(directory,entry.name),st=await fs.lstat(file);
   demand(st.uid===process.getuid()&&(st.mode&0o022)===0&&!st.isSymbolicLink(),'UI_PATH_UNSAFE');
   if(st.isDirectory()){await walk(file,rel,depth+1);continue;}
   demand(st.isFile()&&st.nlink===1,'UI_FILE_UNSAFE');
   demand(st.size<=256*1024*1024&&(totalBytes+=st.size)<=512*1024*1024,'UI_INVENTORY_LIMIT');
   if(rel!=='manifest.json')found.push(rel);
   demand(found.length<=8192,'UI_INVENTORY_LIMIT');
  }}finally{await handle.close().catch(error=>{if(error.code!=='ERR_DIR_CLOSED')throw error;});}
 }
 await walk(root);demand(isDeepStrictEqual(found.sort(),names.sort()),'UI_MANIFEST_MISMATCH');
}
async function releaseSnapshot(installRoot,release,profile){
 demand(id(release?.id)&&release.runtimeRoot===path.join(installRoot,'runtimes',release.id),'UI_RELEASE_UNSAFE');await ancestry(release.runtimeRoot,{privateLeaf:true});
 const manifestBytes=await readRegular(path.join(release.runtimeRoot,'manifest.json'),1024*1024),manifestSha256=sha(manifestBytes);
 // Pinned legacy bytes are checked before parsing or traversing that candidate.
 if(profile)demand(profile.releaseId===release.id&&manifestSha256===profile.manifestSha256,'UI_LEGACY_MISMATCH');
 const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));
 await candidatePreflight(release.runtimeRoot,manifest);
 await verifyReleaseManifest({releaseRoot:release.runtimeRoot,manifest});
 const bundle=path.join(release.runtimeRoot,bundleName),files=await bundleFiles(bundle);
 for(const name of uiBundleFiles)demand(manifest.files[bundleName+'/'+name]===files[name],'UI_MANIFEST_MISMATCH');
 if(profile)demand(isDeepStrictEqual(files,profile.files),'UI_LEGACY_MISMATCH');
 return {releaseId:release.id,releaseRoot:release.runtimeRoot,bundle,manifestSha256,files};
}
/** Selection launches nothing. Signature validation happens at the copy boundary,
 * before the stage can be verified or activated by the existing installer. */
export async function selectCompatibleUi({installRoot,currentRelease,intent}){
 validateIntent(intent);await ancestry(installRoot,{privateLeaf:true});await ancestry(path.join(installRoot,'runtimes'),{privateLeaf:true});
 if(!currentRelease||currentRelease.state==='EMPTY')return {decision:'build',reason:'FIRST_INSTALL'};
 demand(currentRelease.state==='VALID'&&id(currentRelease.id)&&currentRelease.runtimeRoot===path.join(installRoot,'runtimes',currentRelease.id),'UI_RELEASE_UNSAFE');
 await ancestry(currentRelease.runtimeRoot,{privateLeaf:true});
 const currentRecordPath=path.join(currentRelease.runtimeRoot,provenanceName),hasRecord=!await absent(currentRecordPath);
 const profile=hasRecord?undefined:profileFor(currentRelease.id);
 // No scan or identity downgrade: only the active, reviewed legacy profile may
 // bridge missing provenance. 55ad is eligible when it is itself current.
 if(!hasRecord)demand(profile,'UI_LEGACY_MISMATCH');
 const current=await releaseSnapshot(installRoot,currentRelease,profile);
 if(hasRecord){
  const record=validateRecord(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readRegular(currentRecordPath,65536))));
  demand(isDeepStrictEqual(record.artifact.files,current.files),'UI_ARTIFACT_CHANGED');
  if(record.desiredIntent.fingerprint!==intent.fingerprint)return {decision:'build',reason:'UI_INTENT_CHANGED'};
  demand(isDeepStrictEqual(record.desiredIntent,intent),'UI_INTENT_INVALID');return {...current,decision:'reuse',provenance:record};
 }
 const acceptedIntent=makeIntent(profile.inputs,profile.configPath);
 const decision=selectLegacyUiDescriptor({descriptor:{...current,desiredIntent:acceptedIntent,identity:profile.identity},intent});
 // Validate the known artifact first; a real intent change uses the ordinary
 // fresh-build path rather than reusing stale bytes or guessing a migration.
 if(decision.decision==='build')return decision;
 return {...current,...decision};
}
function signatureIdentity(output){
 const text=String(output?.stdout??'')+'\n'+String(output?.stderr??'');demand(Buffer.byteLength(text)<=65536,'UI_SIGNATURE_OUTPUT_LIMIT');
 const identifier=/^Identifier=(.+)$/m.exec(text)?.[1],cdhash=/^CDHash=([a-f0-9]{40})$/m.exec(text)?.[1],requirement=/^#?\s*designated => ([^\r\n]+)$/m.exec(text)?.[1];
 const identity={identifier,cdhash,designatedRequirement:requirement};demand(identifier==='com.gsa-localconnector.mac.desktop'&&/^[a-f0-9]{40}$/.test(cdhash??'')&&requirement===`cdhash H"${cdhash}"`,'UI_SIGNATURE_INVALID');return identity;
}
async function verifyIdentity(bundle,command){
 demand(typeof command==='function','UI_COMMAND_REQUIRED');await command('/usr/bin/codesign',['--verify','--strict',bundle]);
 return signatureIdentity(await command('/usr/bin/codesign',['--display','--verbose=4','-r-',bundle]));
}
export async function copyVerifiedUi({selection,destinationBundle,command}){
 demand(selection?.decision==='reuse','UI_SELECTION_INVALID');validateRecord(selection.provenance);
 await ancestry(path.dirname(destinationBundle),{privateLeaf:true});demand(await absent(destinationBundle),'UI_DESTINATION_EXISTS');
 const before=await bundleFiles(selection.bundle);demand(isDeepStrictEqual(before,selection.files)&&isDeepStrictEqual(before,selection.provenance.artifact.files),'UI_ARTIFACT_CHANGED');
 demand(isDeepStrictEqual(await verifyIdentity(selection.bundle,command),selection.provenance.artifact.identity),'UI_SIGNATURE_CHANGED');
 // Preserve signed bytes while restricting modes to private runtime defaults.
 await fs.mkdir(destinationBundle,{mode:0o700});
 for(const name of uiBundleFiles){const source=path.join(selection.bundle,name),destination=path.join(destinationBundle,name);await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});
  const bytes=await readRegular(source);demand(sha(bytes)===before[name],'UI_ARTIFACT_CHANGED');await fs.writeFile(destination,bytes,{mode:name==='Contents/MacOS/GSA Local Connector'?0o500:0o400,flag:'wx'});
 }
 demand(isDeepStrictEqual(await bundleFiles(destinationBundle),before)&&isDeepStrictEqual(await bundleFiles(selection.bundle),before),'UI_ARTIFACT_CHANGED');
 const manifestBytes=await readRegular(path.join(selection.releaseRoot,'manifest.json'),1024*1024);demand(sha(manifestBytes)===selection.manifestSha256,'UI_MANIFEST_CHANGED');
 const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));
 await candidatePreflight(selection.releaseRoot,manifest);
 await verifyReleaseManifest({releaseRoot:selection.releaseRoot,manifest});
 demand(isDeepStrictEqual(await verifyIdentity(destinationBundle,command),selection.provenance.artifact.identity),'UI_SIGNATURE_CHANGED');
 return {...selection.provenance,reusedFrom:{releaseId:selection.releaseId,manifestSha256:selection.manifestSha256}};
}
export async function recordBuiltUi({bundle,intent,command,buildMetadata={}}){
 validateIntent(intent);const files=await bundleFiles(bundle),identity=await verifyIdentity(bundle,command);
 return validateRecord({format:'gsa-desktop-ui-provenance-v1',desiredIntent:intent,artifact:{files,identity},origin:'observed-local-build',sourceBuildAttestation:'observed-local-build',build:{...buildMetadata,target,recipe}});
}

/** Validate stage metadata and its signed bytes again before activation. */
export async function verifyRecordedUi({releaseRoot,command}){
 await ancestry(releaseRoot,{privateLeaf:true});
 const record=validateRecord(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readRegular(path.join(releaseRoot,provenanceName),65536))));
 const bundle=path.join(releaseRoot,bundleName);demand(isDeepStrictEqual(await bundleFiles(bundle),record.artifact.files),'UI_ARTIFACT_CHANGED');
 demand(isDeepStrictEqual(await verifyIdentity(bundle,command),record.artifact.identity),'UI_SIGNATURE_CHANGED');return record;
}
