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
test("only exact host-bound native qualification qualifies for checked Recovery",async()=>{
 const report=await fs.readFile(archive);
 const source=JSON.parse(report.toString("utf8"));
 const build=source.builds.production;
 const eligible=macFileRecoveryActivation(report,build);
 assert.equal(eligible.available,process.platform==="darwin"&&process.arch==="arm64"&&os.release()==="27.0.0");
 const changed=Buffer.from(report);changed[0]^=1;
 assert.equal(macFileRecoveryActivation(changed,build).available,false,"changed evidence denied");
 assert.equal(macFileRecoveryActivation(report,{...build,release_sha256:"0".repeat(64)}).available,false,"different release denied");
 assert.equal(macFileRecoveryActivation(report,{...build,hostRelease:"0.0.0"}).available,false,"different kernel denied");
});
