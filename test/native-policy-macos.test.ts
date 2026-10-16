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
 assert.ok(["SECURITY_BLOCKED","BASIC_POLICY_NEGATIVE_CONTROLS_PASS"].includes(report.outcome));
 if(report.outcome==="BASIC_POLICY_NEGATIVE_CONTROLS_PASS")
  assert.equal(report.workspace_read_allowed,true);
});
