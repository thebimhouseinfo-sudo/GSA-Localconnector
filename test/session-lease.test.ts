import {test} from "node:test";
import assert from "node:assert/strict";
import {SingleControllerLease} from "../src/core/session-lease.js";
test("controller lease rejects simultaneous claim, wrong token and expired renewal",()=>{
 const lease=new SingleControllerLease(1000);
 const a=lease.acquire(10000);
 assert.equal(lease.snapshot(10001).state,"LEASE_ACTIVE");
 assert.throws(()=>lease.acquire(10010),(e:any)=>e.code==="SESSION_BUSY");
 assert.throws(()=>lease.renew("0".repeat(64),10020),(e:any)=>e.code==="SESSION_INVALID");
 const b=lease.renew(a.token,10020);assert.equal(b.expires_at,11020);
 assert.throws(()=>lease.renew(a.token,12000),(e:any)=>e.code==="SESSION_EXPIRED");
 const c=lease.acquire(12000);assert.notEqual(c.token,a.token);
 lease.release(c.token,12010);assert.equal(lease.snapshot(12010).state,"IDLE");
});
