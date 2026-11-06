import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {recreatePinnedBaseInputs} from '../scripts/repair-mac-recovery-archive.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('reconstructed BASE inputs reproduce pinned raw release JSON bytes',()=>{
 const build={build:'accepted',release_sha256:'a'.repeat(64)};
 const evidence={fixture:{name:'original'},observations:[1,2],unresolved:[]};
 const pins={baseBuild:sha(Buffer.from(JSON.stringify(build))),baseEvidence:sha(Buffer.from(JSON.stringify(evidence,null,2)))};
 const result=recreatePinnedBaseInputs(build,evidence,pins);
 assert.deepEqual(result.map(x=>x.name),['base-build.json','base-evidence.json']);
 assert.equal(sha(result[0].bytes),pins.baseBuild);
 assert.equal(sha(result[1].bytes),pins.baseEvidence);
 assert.equal(result[1].bytes.toString(),JSON.stringify(evidence,null,2));
});
test('reject differing evidence instead of replacing the approved archive record',()=>{
 const build={build:'same'},evidence={safe:true};
 const pins={baseBuild:sha(Buffer.from(JSON.stringify(build))),baseEvidence:'0'.repeat(64)};
 assert.throws(()=>recreatePinnedBaseInputs(build,evidence,pins),{code:'SECURITY_BLOCKED'});
});
test('reject missing and malformed qualification pins',()=>{
 for(const pins of [null,{}, {baseBuild:'a'.repeat(64),baseEvidence:'bad'}]){
  assert.throws(()=>recreatePinnedBaseInputs({}, {}, pins),{code:'SECURITY_BLOCKED'});
 }
});
