import type {NativeScopedFiles} from "../core/native-io.js";
import {WorkspaceRegistry} from "../core/workspace.js";
import {dispatchFileMutation} from "./write-dispatch.js";
type Op={name:string;arguments:Record<string,unknown>};
const MUTATIONS=new Set(["create_file","update_file","edit_file","apply_patch","create_directory","delete_file","copy_file","move_file"]);
/** Explicit sequential partial outcomes. No false transaction/rollback semantics. */
export async function batchFileOperations(registry:WorkspaceRegistry,native:NativeScopedFiles|null,workspaceId:string,operations:unknown){
 if(!Array.isArray(operations)||operations.length<1||operations.length>50)throw Error("INVALID_ARGUMENTS");
 registry.requireGrant(workspaceId,"write");
 const outcomes:Array<{index:number;name:string;ok:boolean;result?:unknown;code?:string}>=[];
 for(let i=0;i<operations.length;i++){
  const op=operations[i] as Op;
  if(!op||typeof op!=="object"||typeof op.name!=="string"||!MUTATIONS.has(op.name)||!op.arguments||typeof op.arguments!=="object"||Array.isArray(op.arguments)){
   outcomes.push({index:i,name:String(op?.name??""),ok:false,code:"INVALID_OPERATION"});break;
  }
  const input={...op.arguments};
  if(input.workspace_id!==undefined&&input.workspace_id!==workspaceId){
   outcomes.push({index:i,name:op.name,ok:false,code:"WORKSPACE_MISMATCH"});break;
  }
  if(["copy_file","move_file"].includes(op.name)){
   if(input.destination_workspace_id!==workspaceId){
    outcomes.push({index:i,name:op.name,ok:false,code:"WORKSPACE_MISMATCH"});break;
   }
  }else{input.workspace_id=workspaceId;}
  try{
   const result=await dispatchFileMutation(op.name,input,registry,native);
   outcomes.push({index:i,name:op.name,ok:true,result});
  }catch(e){
   const code=e&&typeof e==="object"&&"code" in e?String(e.code):e instanceof Error?e.message:"UNKNOWN_ERROR";
   outcomes.push({index:i,name:op.name,ok:false,code});break;
  }
 }
 return {workspace_id:workspaceId,outcomes,completed:outcomes.filter(o=>o.ok).length,partial:outcomes.some(o=>!o.ok),atomic:false,committed:false};
}
