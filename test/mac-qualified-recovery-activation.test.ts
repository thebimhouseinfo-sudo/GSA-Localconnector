import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import {macFileRecoveryActivation} from "../src/hosts/macos-scoped-files.js";
const archive="docs/reports/2026-10-28-mac27-recovery-native-archive/report.json";

test("Recovery stays disabled without the exact independently pinned report",()=>{
 assert.equal(macFileRecoveryActivation().available,false);
 assert.equal(macFileRecoveryActivation(Buffer.from("{}"),{}).available,false);
 assert.equal(macFileRecoveryActivation(Buffer.alloc(0),{}).available,false);
});
test("Recovery qualification denies invalid evidence; private positive archive is host-local",async t=>{
 const report=await fs.readFile(archive).catch(error=>{
  if((error as NodeJS.ErrnoException).code==="ENOENT")return null;
  throw error;
 });
 if(!report){
  assert.equal(macFileRecoveryActivation(Buffer.from("not-qualified"),{}).available,false);
  assert.equal(macFileRecoveryActivation(Buffer.from("{}"),{}).available,false);
  t.diagnostic("Exact signed native archive is retained on the real Mac, not checked into source; host-specific positive proof must be verified on that Mac.");
  return;
 }
 const source=JSON.parse(report.toString("utf8"));
 const build=source.builds.production;
 const eligible=macFileRecoveryActivation(report,build);
 assert.equal(eligible.available,process.platform==="darwin"&&process.arch==="arm64"&&os.release()==="27.0.0");
 // Exercise a positive qualification path on macOS CI even when the runner
 // kernel is newer/older than the recorded real-Mac release.
 if(process.platform==="darwin"&&process.arch==="arm64"){
  const previous=os.release;
  try{
   (os as typeof os & {release:()=>string}).release=()=> "27.0.0";
   assert.equal(macFileRecoveryActivation(report,build).available,true);
  }finally{(os as typeof os & {release:()=>string}).release=previous;}
 }
 const changed=Buffer.from(report);changed[0]^=1;
 assert.equal(macFileRecoveryActivation(changed,build).available,false,"changed evidence denied");
 assert.equal(macFileRecoveryActivation(report,{...build,release_sha256:"0".repeat(64)}).available,false,"different release denied");
 assert.equal(macFileRecoveryActivation(report,{...build,hostRelease:"0.0.0"}).available,false,"different kernel denied");
});
