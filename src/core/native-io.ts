import type {DirectoryCopyOutcome,DirectoryManifest} from "./directory-copy.js";
import type {FileTransactionOutcome} from "./file-transactions.js";

/** Capability-oriented host I/O contract. Implementations MUST enforce OS-native
 * root confinement at time of I/O, including concurrent rename/symlink races.
 * No backend is installed until per-OS containment is independently verified.
 */
export interface ScopedFileRef {readonly workspace_id:string;readonly path:string}
export interface FileSnapshot {readonly bytes:Uint8Array;readonly sha256:string;readonly kind:"file"}
export interface MutationReceipt {
 readonly workspace_id:string;readonly path:string;
 readonly before_sha256:string|null;readonly after_sha256:string|null;
 readonly committed:false;readonly file_mutated:boolean;
}
export interface NativeScopedFiles {
 /** Optional MCP mutation subset. Omission retains the complete legacy contract. */
 readonly supportedOperations?:readonly NativeFileOperation[];
 /** Optional native durable-mutation path. The adapter persists the bound intent
  * before effects and returns readback observations, never a boolean receipt.
  * Presence alone does not activate MCP operations or certify containment. */
 readonly recoverableMutations?:NativeRecoverableFileMutations;
 /** Separate optional directory capability; presence does not certify native proof. */
 readonly directoryCopies?:NativeDirectoryCopies;
 read(ref:ScopedFileRef, maxBytes:number):Promise<FileSnapshot>;
 createExclusive(ref:ScopedFileRef,bytes:Uint8Array):Promise<void>;
 replaceIfHash(ref:ScopedFileRef,bytes:Uint8Array,expectedSha256:string):Promise<void>;
 makeDirectory(ref:ScopedFileRef):Promise<void>;
 copyExclusive(source:ScopedFileRef,dest:ScopedFileRef,expectedSha256:string):Promise<void>;
 moveExclusive(source:ScopedFileRef,dest:ScopedFileRef,expectedSha256:string):Promise<void>;
 trashIfHash(ref:ScopedFileRef,expectedSha256:string):Promise<void>;
}
export interface NativeDirectoryCopies {
 inspect(source:ScopedFileRef):Promise<DirectoryManifest>;
 copy(copyId:string,source:ScopedFileRef,destination:ScopedFileRef,expectedManifestSha256:string):Promise<DirectoryCopyOutcome>;
 readCopy(copyId:string):Promise<DirectoryCopyOutcome>;
}
export interface NativeRecoverableFileMutations {
 replaceIfHash(ref:ScopedFileRef,bytes:Uint8Array,expectedSha256:string):Promise<FileTransactionOutcome>;
 trashIfHash(ref:ScopedFileRef,expectedSha256:string):Promise<FileTransactionOutcome>;
 /** Explicit readback only; never retries a native mutation. */
 readTransaction?(transactionId:string):Promise<FileTransactionOutcome>;
}
export type NativeFileOperation="create_file"|"update_file"|"edit_file"|"apply_patch"|"create_directory"|"delete_file"|"copy_file"|"move_file"|"copy_directory";
export interface SandboxedProcessRequest {
 readonly workspace_id:string;readonly executable:string;readonly argv:readonly string[];
 readonly process_id?:string; // supervisor-assigned stable cancellation identity
 readonly cwd_relative:string;readonly time_limit_ms:number;readonly max_output_bytes:number;
 readonly network_allowed:boolean;
 readonly artifact_paths?:readonly string[];
}
export interface SandboxedProcessArtifact {
 readonly path:string;readonly size:number;readonly sha256:string;readonly base64:string;
}
export interface SandboxedProcessReceipt {
 readonly exit_code:number|null;readonly signal:string|null;
 readonly stdout:string;readonly stderr:string;
 readonly cancelled:boolean;readonly timed_out:boolean;
 readonly output_limited?:boolean;
 readonly artifacts?:readonly SandboxedProcessArtifact[];
 readonly artifact_error?:string|null;
}
export interface VerifiedNativeSandbox {
 readonly platform:"windows"|"macos";readonly policy_fingerprint:string;
 readonly verified:true;
 execute(request:SandboxedProcessRequest):Promise<SandboxedProcessReceipt>;
 /** Optional native-only cancellation of the entire owned process tree.
  * Implementations must verify the process ID belongs to the same sandbox session.
  */
 cancel?(process_id:string,workspace_id:string):Promise<boolean>;
}
export class NativeBackendUnavailable extends Error {
 readonly code="SECURITY_BLOCKED" as const;
 constructor(){super("OS-native root and process containment has not been verified");}
}
export function requireNativeBackend<T>(backend:T|null|undefined):T{
 if(!backend)throw new NativeBackendUnavailable();
 return backend;
}

/** Optional durable-process extension. This contract alone confers no authority.
 * Verified host implementation must own the OS process tree and per-Workspace lease.
 */
export interface NativeProcessStatus {
 readonly state:"QUEUED"|"RUNNING"|"SUCCEEDED"|"FAILED"|"CANCELLED"|"UNKNOWN";
 readonly exit_code:number|null;
 readonly started_at:string;
 readonly ended_at:string|null;
 readonly stopped?:boolean;
}
export interface VerifiedNativeProcessController {
 readonly verified:true;
 readonly platform:"windows"|"macos";
 readonly policy_fingerprint:string;
 start(request:SandboxedProcessRequest):Promise<{native_id:string}>;
 status(nativeId:string):Promise<NativeProcessStatus>;
 output(nativeId:string,cursor:number,limit:number):Promise<{stdout:string;stderr:string;next_cursor:number|null}>;
 stop(nativeId:string):Promise<{stopped:boolean;state:NativeProcessStatus["state"]}>;
 wait?(nativeId:string):Promise<NativeProcessStatus>;
}
