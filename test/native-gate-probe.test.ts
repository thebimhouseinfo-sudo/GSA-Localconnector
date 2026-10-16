import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import path from "node:path";
const root=path.resolve(process.cwd(),"scripts");
test("Windows read-only sandbox capability probe returns unverified metadata",{
 skip:process.platform!=="win32"
},()=>{
 const result=spawnSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",path.join(root,"native-gate-windows.ps1")],{encoding:"utf8",timeout:30000,maxBuffer:65536});
 assert.equal(result.status,0,result.stderr);
 const report=JSON.parse(result.stdout);
 assert.equal(report.platform,"windows");
 assert.notEqual(report.result,"SECURITY_PASS");
 assert.equal(typeof report.experimental_sandbox_export,"boolean");
});
test("macOS read-only sandbox capability probe reports baseline without certifying isolation",{
 skip:process.platform!=="darwin"
},()=>{
 const result=spawnSync("/bin/sh",[path.join(root,"native-gate-macos.sh")],{encoding:"utf8",timeout:15000,maxBuffer:65536});
 assert.equal(result.status,0,result.stderr);
 const report=JSON.parse(result.stdout);
 assert.equal(report.platform,"macos");
 assert.equal(typeof report.baseline_runs,"boolean");
 assert.equal(report.security_verified,false);
});
