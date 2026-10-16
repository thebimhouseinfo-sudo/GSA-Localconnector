import {test} from "node:test";
import assert from "node:assert/strict";
import {planWindowsAppContainer} from "../src/hosts/windows-appcontainer-candidate.js";
test("AppContainer planner keeps only bound Workspace writable and defaults network denied",()=>{
 const p=planWindowsAppContainer("C:\\Repos\\Project",["C:\\Program Files\\Node"]);
 assert.equal(p.verified,false);
 assert.equal(p.spec.app_container,true);
 assert.equal(p.spec.fs_read_write.length,1);
 assert.deepEqual(p.spec.fs_read_only,["C:\\Program Files\\Node"]);
 assert.equal(p.spec.capabilities,"");
 assert.equal(p.spec.disallow_win32k_system_calls,true);
});
test("AppContainer planner rejects drive root, UNC, parent traversal and overlapping grants",()=>{
 for(const root of ["C:\\","..\\Project","\\\\server\\share\\Project","C:\\Repos\\..\\Secrets","/etc"])
  assert.throws(()=>planWindowsAppContainer(root));
 assert.throws(()=>planWindowsAppContainer("C:\\Repos\\Project",["C:\\Repos"]));
});
