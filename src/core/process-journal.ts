import type {NativeProcessStatus} from "./native-io.js";
export interface ProcessJournalRecord {
 format:"gsa-process-v1";process_id:string;workspace_id:string;native_id:string|null;
 owner_session:string;revision:number;status:NativeProcessStatus;stopped:boolean;
 stdout:string;stderr:string;output_complete:boolean;
}
export interface ProcessJournal {
 list():Promise<ProcessJournalRecord[]>;
 load(id:string):Promise<ProcessJournalRecord|null>;
 create(record:ProcessJournalRecord):Promise<void>;
 save(record:ProcessJournalRecord,expectedRevision:number):Promise<void>;
}
