import {createHash} from "node:crypto";
import type {CiRunRecord} from "./ci-journal.js";
/** In-memory evidence framing; persistence and process isolation remain separate gates. */
export type EvidenceChunk={readonly sequence:number;readonly stream:"stdout"|"stderr";readonly text:string;readonly sha256:string};
export class EvidenceError extends Error {constructor(message:string){super(message);this.name="EvidenceError";}}
export class BoundedEvidence {
 private chunks:EvidenceChunk[]=[];
 private bytes=0;
 constructor(readonly runId:string,private readonly maxBytes=2*1024*1024){
  if(!runId||maxBytes<1)throw new EvidenceError("INVALID_EVIDENCE_LIMIT");
 }
 append(stream:"stdout"|"stderr",text:string):EvidenceChunk{
  const size=Buffer.byteLength(text,"utf8");
  if(size>65536||this.bytes+size>this.maxBytes)throw new EvidenceError("EVIDENCE_QUOTA_EXCEEDED");
  const entry=Object.freeze({sequence:this.chunks.length+1,stream,text,sha256:createHash("sha256").update(text).digest("hex")});
  this.chunks.push(entry);this.bytes+=size;return entry;
 }
 page(cursor=0,limit=50){
  if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new EvidenceError("INVALID_CURSOR");
  const entries=this.chunks.slice(cursor,cursor+limit);
  return {entries,next_cursor:cursor+entries.length<this.chunks.length?cursor+entries.length:null,bytes:this.bytes};
 }
 digest():string{return createHash("sha256").update(JSON.stringify(this.chunks)).digest("hex");}
 snapshot(run:CiRunRecord){return {run_id:run.run_id,revision:run.revision,state:run.state,log_sha256:this.digest(),total_chunks:this.chunks.length};}
}
