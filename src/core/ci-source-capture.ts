import {randomUUID} from "node:crypto";
import {createSnapshotManifest} from "./ci-snapshot.js";
import {NativeBackendUnavailable} from "./native-io.js";
import type {CiSnapshotStore} from "../local/ci-snapshot-store.js";
import type {CiJournalStore} from "../local/ci-store.js";
import {createQueuedRun} from "./ci-journal.js";

/** Only a host-native directory-handle-safe enumerator may implement this.
 * TypeScript and mock tests do not prove OS sandboxing or atomic source capture.
 */
export interface VerifiedWorkspaceSourceCapture {
 readonly verified:true;
 readonly platform:"windows"|"macos";
 readonly policy_fingerprint:string;
 capture(workspaceId:string):Promise<ReadonlyArray<{path:string;bytes:Uint8Array}>>;
}
export class CiSourceCaptureService{
 constructor(private readonly native:VerifiedWorkspaceSourceCapture|null,
  private readonly snapshots:CiSnapshotStore,private readonly journal:CiJournalStore){}
 async prepare(workspaceId:string){
  if(!this.native?.verified)throw new NativeBackendUnavailable();
  const entries=await this.native.capture(workspaceId);
  const manifest=createSnapshotManifest(entries);
  // A provenance journal record binds this source ID to the exact workspace.
  const record=createQueuedRun(workspaceId,"__source_capture__",manifest.source_sha256);
  await this.snapshots.persist(record.run_id,entries);
  await this.journal.save(record,null);
  return {source_run_id:record.run_id,source_sha256:manifest.source_sha256,file_count:manifest.files.length};
 }
 async requireOwned(workspaceId:string,sourceRunId:string){
  const record=await this.journal.load(sourceRunId);
  if(record.workspace_id!==workspaceId||record.workflow!=="__source_capture__")
   throw Error("SOURCE_OWNERSHIP_DENIED");
  const manifest=await this.snapshots.verify(sourceRunId);
  if(manifest.source_sha256!==record.source_sha256)throw Error("SOURCE_FINGERPRINT_MISMATCH");
  return manifest;
 }
}
