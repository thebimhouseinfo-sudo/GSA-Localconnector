import {test} from "node:test";
import assert from "node:assert/strict";
import {validateWorkflow} from "../src/core/ci-dag.js";
test("CI DAG dependency order",()=>{
 assert.deepEqual(validateWorkflow({name:"build",jobs:[
  {id:"test",needs:["compile"],steps:[{id:"t",command:"node",args:["test.js"]}]},
  {id:"compile",steps:[{id:"b",command:"node",args:["build.js"]}]}
 ]}).job_order,["compile","test"]);
});
test("CI DAG fails on unknown dependency, cycles and unrecognized instructions",()=>{
 const step=[{id:"a",command:"echo"}];
 for(const workflow of [
  {name:"w",jobs:[{id:"a",needs:["missing"],steps:step}]},
  {name:"w",jobs:[{id:"a",needs:["b"],steps:step},{id:"b",needs:["a"],steps:step}]},
  {name:"w",jobs:[{id:"a",steps:step,script:"arbitrary"}]},
  {name:"w",jobs:[{id:"a",steps:[{id:"x",command:"node",shell:"bash"}]}]}
 ])assert.throws(()=>validateWorkflow(workflow),(e:any)=>e.code==="CI_INVALID");
});
