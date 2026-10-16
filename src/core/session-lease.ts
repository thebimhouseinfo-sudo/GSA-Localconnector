import {randomBytes,timingSafeEqual} from "node:crypto";
export class LeaseError extends Error {constructor(public readonly code:"SESSION_BUSY"|"SESSION_EXPIRED"|"SESSION_INVALID",message:string){super(message);}}
export interface LeaseSnapshot {readonly state:"IDLE"|"LEASE_ACTIVE";readonly expires_at:number|null;readonly revision:number}
/** Host-owned single-controller lease logic. Transport authentication is a separate prerequisite. */
export class SingleControllerLease {
 private secret:Buffer|null=null;
 private expires=0;
 private revision=0;
 constructor(private readonly ttlMs:number=300000){if(ttlMs<1000)throw Error("INVALID_TTL");}
 acquire(now=Date.now()):{token:string;revision:number;expires_at:number}{
  if(this.secret&&this.expires>now)throw new LeaseError("SESSION_BUSY","Another controller holds the lease");
  this.secret=randomBytes(32);this.expires=now+this.ttlMs;this.revision++;
  return {token:this.secret.toString("hex"),revision:this.revision,expires_at:this.expires};
 }
 renew(token:string,now=Date.now()):LeaseSnapshot {
  this.require(token,now);this.expires=now+this.ttlMs;this.revision++;
  return this.snapshot(now);
 }
 require(token:string,now=Date.now()):void {
  if(!this.secret||now>=this.expires)throw new LeaseError("SESSION_EXPIRED","No active controller lease");
  if(!/^[0-9a-f]{64}$/.test(token)||!timingSafeEqual(Buffer.from(token,"hex"),this.secret))throw new LeaseError("SESSION_INVALID","Invalid controller credential");
 }
 release(token:string,now=Date.now()):void{
  this.require(token,now);this.secret=null;this.expires=0;this.revision++;
 }
 snapshot(now=Date.now()):LeaseSnapshot{return {state:this.secret&&this.expires>now?"LEASE_ACTIVE":"IDLE",expires_at:this.secret&&this.expires>now?this.expires:null,revision:this.revision};}
}
