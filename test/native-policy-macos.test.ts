import {test} from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {spawnSync} from "node:child_process";
test("native macOS Workspace policy probe never self-certifies security",{
 skip:process.platform!=="darwin"
},()=>{
 const file=path.join(process.cwd(),"scripts","native-policy-macos.mjs");
 const run=spawnSync(process.execPath,[file],{cwd:process.cwd(),encoding:"utf8",timeout:30000,maxBuffer:65536});
 assert.equal(run.status,0,run.stderr);
 const report=JSON.parse(run.stdout);
 assert.equal(report.platform,"macos");
 assert.equal(report.security_verified,false);
 assert.equal(typeof report.temp_path_canonicalized,"boolean");
 assert.ok(report.positive_probe&&Object.hasOwn(report.positive_probe,"exit_code"));
 assert.ok(!JSON.stringify(report).includes("not-for-output"),"probe must not disclose outside fixture contents");
 assert.ok(["SECURITY_BLOCKED","EXTENDED_POLICY_NEGATIVE_CONTROLS_PASS"].includes(report.outcome));
 if(report.outcome==="EXTENDED_POLICY_NEGATIVE_CONTROLS_PASS")
  assert.equal(report.workspace_read_allowed,true);
});
