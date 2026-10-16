import {test} from "node:test";
import assert from "node:assert/strict";
import {validateWorkspaceRelative} from "../src/core/workspace-path.js";
test("portable Workspace paths allow exact relative names and explicit root",()=>{
 assert.equal(validateWorkspaceRelative("src/main.ts"),"src/main.ts");
 assert.equal(validateWorkspaceRelative(".",true),".");
 assert.throws(()=>validateWorkspaceRelative("."),(e:any)=>e.code==="PATH_OUTSIDE_SCOPE");
});
test("portable Workspace paths reject traversal ADS devices ambiguous and control names",()=>{
 for(const value of ["../secret","src/../secret","src//file","C:/temp/a", "/etc/passwd",
  "src\\file","src/CON","src/NUL.txt","file.txt:ads","a.","a ","src/./file","a\0b",
  "folder/LPT2.prn","folder/COM1"])assert.throws(()=>validateWorkspaceRelative(value),(e:any)=>e.code==="PATH_OUTSIDE_SCOPE",value);
});
