import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const modulePath='../src/hosts/macos-recovery-evidence.js';
const fixture=()=>fs.readFile(new URL('../../test/fixtures/mac27-recovery-qualification.json',import.meta.url));
const invalid=(error:any)=>error?.code==='RECOVERY_EVIDENCE_INVALID';
test('exact accepted recovery report qualifies only its production build with immutable limited claims',async()=>{
 const {requireMacRecoveryQualification}=await import(modulePath),bytes=await fixture(),report=JSON.parse(bytes.toString());
 const result=requireMacRecoveryQualification(bytes,report.builds.production);
 assert.equal(result.qualification_sha256,'ee918da1ad707489454f49e2180fe048659859a53c213555e23aa62e9c46471b');
 assert.equal(result.source_sha256,report.builds.production.source_sha256);assert.equal(result.code_sha256,report.builds.production.code_sha256);assert.equal(result.release_sha256,report.builds.production.release_sha256);
 assert.equal(Object.isFrozen(result),true);assert.equal(Object.isFrozen(result.limitations),true);
 assert.deepEqual(result.limitations,['relocation:pre-capture-read-denial;capture-publication-restoration-unexercised','constructed-states:structural-readback-only','sync-error:diagnostic-injection-only','power-loss:unverified','compiler-private-descendants:unverified','installed-plugin:unverified']);
 report.builds.production.source_sha256='0'.repeat(64);assert.notEqual(result.source_sha256,report.builds.production.source_sha256);
});
test('caller-selected success claims and any report byte drift cannot qualify recovery',async()=>{
 const {requireMacRecoveryQualification}=await import(modulePath),bytes=await fixture(),report=JSON.parse(bytes.toString());
 for(const input of [Buffer.from(JSON.stringify(report)),Buffer.concat([bytes,Buffer.from('\n')]),Buffer.from('{"state":"RECOVERY_SEQUENCE_OBSERVED","activation":false}'),Buffer.from([0xff,0xfe]),Buffer.from('{')])assert.throws(()=>requireMacRecoveryQualification(input,report.builds.production),invalid);
 const changed=Buffer.from(bytes);changed[100]^=1;assert.throws(()=>requireMacRecoveryQualification(changed,report.builds.production),invalid);
});
test('diagnostic, stale and partial builds never inherit accepted production evidence',async()=>{
 const {requireMacRecoveryQualification}=await import(modulePath),bytes=await fixture(),report=JSON.parse(bytes.toString());
 for(const build of [report.builds.diagnostic,null,{}, {...report.builds.production,source_sha256:'0'.repeat(64)}, {...report.builds.production,code_sha256:'0'.repeat(64)},{...report.builds.production,hostRelease:'26.0.0'}, {...report.builds.production,arch:'x64'},{...report.builds.production,signing_profile:'other'}, {...report.builds.production,uuid:'other'}, {...report.builds.production,extra:true}])assert.throws(()=>requireMacRecoveryQualification(bytes,build),invalid);
});
test('qualification refuses oversized and non-byte input before accepting any build',async()=>{
 const {requireMacRecoveryQualification}=await import(modulePath),report=JSON.parse((await fixture()).toString());
 for(const input of [Buffer.alloc(512*1024+1),null,{},'report',new Uint8Array()])assert.throws(()=>requireMacRecoveryQualification(input,report.builds.production),invalid);
});
