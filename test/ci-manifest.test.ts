import {test} from "node:test";
import assert from "node:assert/strict";
import {parseCiManifest} from "../src/core/ci-manifest.js";
test("strict CI YAML subset supports DAG jobs and argv arrays",()=>{
 const raw=["name: verify","jobs:","  - id: compile","    steps:","      - id: build","        command: node","        args: [\"--version\"]","  - id: test","    needs: [compile]","    steps:","      - id: run","        command: npm","        args: [\"test\"]",""].join("\n");
 const parsed=parseCiManifest(raw);
 assert.equal(parsed.name,"verify");
 assert.deepEqual(parsed.jobs[1].needs,["compile"]);
 assert.deepEqual(parsed.jobs[0].steps?.[0].args,["--version"]);
});
test("strict CI parser refuses implicit YAML anchors, malformed nesting and unknown keys",()=>{
 for(const text of [
  "name: x\njobs:\n  - id: a\n    steps:\n      - id: s\n        command: *shell",
  "name: x\njobs:\n  - id: a\n    shell: bash",
  "name: x\njobs:\n    - id: a",
  "name: x\njobs:\n  - id: a\n    steps:\n      - id: s\n        command: node\n        unsupported: x"
 ])assert.throws(()=>parseCiManifest(text));
});
