#!/usr/bin/env node
/** Reconstruct only missing ORIGINAL BASE archive inputs from an authenticated
 * installed BASE proof. No installation, owner mutation or activation occurs.
 * Source evidence hashes in the independently pinned recovery report are final.
 */
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {identityDirectory} from '../dist/src/local/identity.js';
import {loadTrustedRegistry} from '../dist/src/local/grants.js';
import {requireMacRecoveryQualification} from '../dist/src/hosts/macos-recovery-evidence.js';
import {requireMacFileEvidence} from '../dist/src/hosts/macos-file-evidence.js';
const here=path.dirname(fileURLToPath(import.meta.url));
const defaultArchive=path.resolve(here,'../docs/reports/2026-10-28-mac27-recovery-native-archive');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const deny=message=>{throw Object.assign(Error(message),{code:'SECURITY_BLOCKED'});};
async function privateDir(dir){
 if(!path.isAbsolute(dir)||path.normalize(dir)!==dir||await fs.realpath(dir)!==dir)deny('Unsafe archive directory path');
 const s=await fs.lstat(dir,{bigint:true});
 if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==BigInt(process.getuid())||(s.mode&0o777n)!==0o700n)deny('Unsafe archive directory');
}
async function safeRead(file,max){
 const s=await fs.lstat(file,{bigint:true});
 if(!s.isFile()||s.isSymbolicLink()||s.uid!==BigInt(process.getuid())||(s.mode&0o077n)!==0n||s.nlink!==1n||s.size>BigInt(max))deny('Unsafe archive input');
 const f=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try {
  const opened=await f.stat({bigint:true});
  if(opened.dev!==s.dev||opened.ino!==s.ino)deny('Archive file changed');
  const bytes=await f.readFile();
  const end=await f.stat({bigint:true}),named=await fs.lstat(file,{bigint:true});
  if(bytes.length!==Number(s.size)||end.dev!==s.dev||end.ino!==s.ino||end.mtimeNs!==s.mtimeNs||end.ctimeNs!==s.ctimeNs||named.dev!==s.dev||named.ino!==s.ino)deny('Archive file changed');
  return bytes;
 }finally{await f.close();}
}
/** Pure byte recreation. Reject a would-be substitute not EXACTLY pinned by
 * the accepted report. Raw baseEvidence was originally JSON indented by two. */
export function recreatePinnedBaseInputs(build,evidence,pins){
 if(!pins||typeof pins.baseBuild!=='string'||typeof pins.baseEvidence!=='string')deny('Missing accepted BASE pins');
 const result=Object.freeze([
  Object.freeze({name:'base-build.json',bytes:Buffer.from(JSON.stringify(build)),sha256:pins.baseBuild}),
  Object.freeze({name:'base-evidence.json',bytes:Buffer.from(JSON.stringify(evidence,null,2)),sha256:pins.baseEvidence})
 ]);
 if(result.some(v=>! /^[a-f0-9]{64}$/.test(v.sha256)||hash(v.bytes)!==v.sha256))deny('Reconstructed BASE differs from accepted native evidence');
 return result;
}
export async function repairMacRecoveryArchive(archive=defaultArchive,identityRoot=identityDirectory()){
 if(process.platform!=='darwin'||process.arch!=='arm64')deny('Mac ARM64 required');
 await privateDir(archive);await privateDir(identityRoot);const installed=path.join(identityRoot,'scoped-files');await privateDir(installed);
 const reportBytes=await safeRead(path.join(archive,'report.json'),512*1024);
 let report;try{report=JSON.parse(reportBytes.toString('utf8'));}catch{deny('Recovery report invalid');}
 const qualification=requireMacRecoveryQualification(reportBytes,report.builds?.production);
 if(qualification.host_release!==os.release()||qualification.arch!==process.arch)deny('Recovery host differs');
 const key=await safeRead(path.join(installed,'proof-key'),32),envelopeBytes=await safeRead(path.join(installed,'install.json'),1024*1024);
 if(key.length!==32)deny('Invalid installed proof key');
 let envelope,proof;try{envelope=JSON.parse(envelopeBytes.toString('utf8'));proof=JSON.parse(envelope.body);}catch{deny('Invalid installed BASE proof');}
 if(typeof envelope.body!=='string'||!/^[a-f0-9]{64}$/.test(envelope.hmac??''))deny('Invalid installed BASE proof');
 const provided=Buffer.from(envelope.hmac,'hex'),expected=createHmac('sha256',key).update(envelope.body).digest();
 if(!timingSafeEqual(provided,expected))deny('Installed BASE proof HMAC differs');
 if(proof.format!=='gsa-scoped-files-v2'||proof.hostRelease!==os.release()||proof.arch!==process.arch||
    proof.recoveryQualification!==undefined||proof.recoveryBuild!==undefined||!Array.isArray(proof.grants))deny('Not a BASE-only installed proof');
 requireMacFileEvidence(proof.evidence,proof.build);
 const registry=await loadTrustedRegistry(identityRoot),grants=registry.list();
 if(proof.grants.length!==grants.length||grants.some(g=>!proof.grants.some(p=>p.id===g.id&&p.root===g.canonicalRoot&&p.revision===g.revision&&p.role===g.role&&p.rootIdentity?.device===g.rootIdentity.device&&p.rootIdentity?.inode===g.rootIdentity.inode)))deny('Installed grants changed');
 const inputs=recreatePinnedBaseInputs(proof.build,proof.evidence,report.sourceHashes);
 const binary=await safeRead(path.join(archive,'base-release-broker'),16*1024*1024);
 if(hash(binary)!==report.sourceHashes.baseBinary||hash(binary)!==proof.build.release_sha256)deny('Qualified BASE binary differs');
 const recovery=await safeRead(path.join(archive,'production-release-recovery'),16*1024*1024);
 if(hash(recovery)!==qualification.release_sha256)deny('Qualified recovery binary differs');
 const state=[];
 for(const item of inputs){
  const dest=path.join(archive,item.name);
  let action='VERIFIED_EXISTING';
  try{
   const f=await fs.open(dest,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
   try{await f.writeFile(item.bytes);await f.sync();}finally{await f.close();}
   action='RESTORED_EXACT';
  }catch(error){
   if(error.code!=='EEXIST')throw error;
   if(hash(await safeRead(dest,64*1024))!==item.sha256)deny('Existing archive file is not pinned');
  }
  state.push({name:item.name,state:action,sha256:item.sha256});
 }
 const d=await fs.open(archive,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{await d.sync();}finally{await d.close();}
 return {state:'RECOVERY_ARCHIVE_BASE_INPUTS_EXACT',host_release:qualification.host_release,files:state};
}
async function main(){
 const args=process.argv.slice(2);
 if(args.length!==0)deny('No external archive/root arguments: only repository-qualified archive is supported');
 console.log(JSON.stringify(await repairMacRecoveryArchive()));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
