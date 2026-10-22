import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLoginJob,retireInactiveLoginJob} from '../scripts/mac-desktop-login.mjs';

const label='com.gsa-localconnector.mac';
test('launchctl job list distinguishes registered exited jobs from active processes',()=>{
 assert.equal(parseLoginJob(`PID\tStatus\tLabel\n-\t78\t${label}\n`,label),'INACTIVE');
 assert.equal(parseLoginJob(`123\t0\t${label}\n`,label),'ACTIVE');
 assert.equal(parseLoginJob(`-\t0\t${label}.other\n`,label),'ABSENT');
 assert.equal(parseLoginJob(`unexpected\t78\t${label}\n`,label),'UNKNOWN');
 assert.equal(parseLoginJob(`-\t78\t${label}\n-\t0\t${label}\n`,label),'UNKNOWN');
});
test('only verified inactive owned registration can be retired',async()=>{
 const events=[];let retired=false;
 await retireInactiveLoginJob({query:async()=>retired?'ABSENT':'INACTIVE',verifyOwned:async()=>events.push('verified'),ownerBusy:async()=>false,
  bootout:async()=>{events.push('bootout');retired=true;}});
 assert.deepEqual(events,['verified','bootout']);
});
test('active, unknown, replaced or newly started jobs never receive bootout',async()=>{
 const base={query:async()=> 'INACTIVE',verifyOwned:async()=>{},ownerBusy:async()=>false,bootout:async()=>assert.fail('must not bootout')};
 for(const state of ['ACTIVE','UNKNOWN'])await assert.rejects(retireInactiveLoginJob({...base,query:async()=>state}),{code:'OWNER_ACTIVE'});
 await assert.rejects(retireInactiveLoginJob({...base,verifyOwned:async()=>{throw Object.assign(Error(),{code:'AGENT_COLLISION'});}}),{code:'AGENT_COLLISION'});
 await assert.rejects(retireInactiveLoginJob({...base,ownerBusy:async()=>true}),{code:'OWNER_ACTIVE'});
 let calls=0;await assert.rejects(retireInactiveLoginJob({...base,query:async()=>++calls===1?'INACTIVE':'ACTIVE'}),{code:'OWNER_ACTIVE'});
 await retireInactiveLoginJob({...base,query:async()=> 'ABSENT'});
});
