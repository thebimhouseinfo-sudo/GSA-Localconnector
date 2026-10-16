import {test} from "node:test";
import assert from "node:assert/strict";
import {securityProbeCases,evaluateSecurityProbes} from "../src/hosts/security-probe.js";
test("native security negative-control suite must be complete",()=>{
 const nominal=securityProbeCases.map(x=>({id:x.id,outcome:x.expected,detail:"synthetic only"}));
 const v=evaluateSecurityProbes(nominal);
 assert.equal(v.passed,true);assert.equal(v.unverified,true);
 assert.equal(evaluateSecurityProbes(nominal.slice(1)).passed,false);
 assert.equal(evaluateSecurityProbes([...nominal,{id:"outside-read",outcome:"DENIED" as const,detail:"duplicate"}]).passed,false);
 assert.equal(evaluateSecurityProbes(nominal.map(x=>x.id==="outside-write"?{...x,outcome:"ALLOWED" as const}:x)).passed,false);
});
