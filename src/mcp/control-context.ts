import {AsyncLocalStorage} from "node:async_hooks";
import {ControlLeaseError,type ControlLease,type ControlLeaseStore} from "../local/control-lease.js";
interface ControlContext {store:ControlLeaseStore;token:string}
const context=new AsyncLocalStorage<ControlContext>();
/** Scope an authenticated tool call. Async jobs retain the originating credential. */
export async function withControlToken<T>(store:ControlLeaseStore,token:string,operation:()=>Promise<T>):Promise<T>{
 await store.require(token);
 return context.run({store,token},operation);
}
export async function requireCurrentControl():Promise<ControlLease>{
 const current=context.getStore();
 if(!current)throw new ControlLeaseError("SESSION_INVALID","Controller context is required");
 return current.store.require(current.token);
}
/** Capture once at native operation start; polling rechecks the durable lease. */
export function captureControlAuthorization():()=>Promise<void>{
 const current=context.getStore();
 if(!current)throw new ControlLeaseError("SESSION_INVALID","Controller context is required");
 return async()=>{await current.store.require(current.token);};
}
