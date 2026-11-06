import {test} from "node:test";
import assert from "node:assert/strict";
import {validateWorkflow,validateArtifactPaths} from "../src/core/ci-dag.js";
import {parseCiManifest} from "../src/core/ci-manifest.js";
test("legacy CI artifact-path and workflow validation remains portable without the VM",{timeout:5000},()=>{
 const doc={name:"build",artifacts:["out/report.bin"],jobs:[{id:"build",steps:[{id:"run",command:"true"}]}]};
 validateWorkflow(doc);assert.deepEqual(parseCiManifest(JSON.stringify(doc)),doc);
 assert.deepEqual(parseCiManifest('name: build\\nartifacts: ["out/report.bin"]\\njobs:\\n  - id: build\\n    steps:\\n      - id: run\\n        command: true\\n'),doc);
 for(const paths of [["../escape"],["/absolute"],["a","A"],["a/*"],["a?"],["a\\\\b"],["NUL"],["é"],Array(21).fill("x")]) assert.throws(()=>validateArtifactPaths(paths));
});
