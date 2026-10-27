import {assertDirectoryCopyId} from "../core/directory-copy.js";
import {validateWorkspaceRelative} from "../core/workspace-path.js";
import {WorkspaceRegistry} from "../core/workspace.js";
import {requireNativeBackend,type NativeScopedFiles,type ScopedFileRef} from "../core/native-io.js";
import {createFile,updateFile,editFile,applyPatch,createDirectory,trashFile,copyFile,moveFile} from "../core/write-engine.js";
const str=(v:unknown):string=>{if(typeof v!=="string")throw Error("INVALID_ARGUMENTS");return v;};
const fields=(args:Record<string,unknown>,keys:readonly string[])=>{
 if(Object.keys(args).some(k=>!keys.includes(k))||keys.some(k=>typeof args[k]!=="string"))throw Error("INVALID_ARGUMENTS");
};
const ref=(reg:WorkspaceRegistry,id:string,path:string,permission:"read"|"write"):ScopedFileRef=>{
 reg.requireGrant(id,permission);
 return {workspace_id:id,path};
};
export function directoryPath(value:unknown,source:boolean):string {
 if(typeof value!=="string"||!value||Buffer.byteLength(value)>4096||Buffer.from(value).toString("utf8")!==value||value.split("/").some(p=>p.toLowerCase()===".gsa-trash"))throw Error("INVALID_ARGUMENTS");
 return validateWorkspaceRelative(value,source);
}
/** Functional MCP mutation dispatcher; may only be called when a native backend has
 * been securely provided AND the Workspace registry has the required grants. */
export async function dispatchFileMutation(name:string,args:Record<string,unknown>,registry:WorkspaceRegistry,backend:NativeScopedFiles|null){
 const io=requireNativeBackend(backend);
 switch(name){
  case "copy_directory":{
   fields(args,["copy_id","source_workspace_id","source_path","destination_workspace_id","destination_path","expected_manifest_sha256"]);
   try{assertDirectoryCopyId(str(args.copy_id));}catch{throw Error("INVALID_ARGUMENTS");}
   if(typeof args.expected_manifest_sha256!=="string"||!/^[a-f0-9]{64}$/.test(args.expected_manifest_sha256))throw Error("INVALID_ARGUMENTS");
   const src=ref(registry,str(args.source_workspace_id),directoryPath(args.source_path,true),"read");
   const dst=ref(registry,str(args.destination_workspace_id),directoryPath(args.destination_path,false),"write");
   if(registry.requireGrant(dst.workspace_id,"write").role!=="workspace")throw Error("SECURITY_BLOCKED");
   if(!io.directoryCopies||!io.supportedOperations?.includes("copy_directory"))throw Error("SECURITY_BLOCKED");
   return io.directoryCopies.copy(str(args.copy_id),src,dst,args.expected_manifest_sha256);
  }
  case "create_file":{
   fields(args,["workspace_id","path","content"]);
   const file=ref(registry,str(args.workspace_id),str(args.path),"write");
   return createFile(io,file,str(args.content));
  }
  case "update_file":{
   fields(args,["workspace_id","path","content","expected_sha256"]);
   const file=ref(registry,str(args.workspace_id),str(args.path),"write");
   return updateFile(io,file,str(args.content),str(args.expected_sha256));
  }
  case "edit_file":{
   fields(args,["workspace_id","path","old_text","new_text","expected_sha256"]);
   const file=ref(registry,str(args.workspace_id),str(args.path),"write");
   return editFile(io,file,str(args.old_text),str(args.new_text),str(args.expected_sha256));
  }
  case "apply_patch":{
   fields(args,["workspace_id","path","patch","expected_sha256"]);
   const file=ref(registry,str(args.workspace_id),str(args.path),"write");
   return applyPatch(io,file,str(args.patch),str(args.expected_sha256));
  }
  case "create_directory":{
   fields(args,["workspace_id","path"]);
   const file=ref(registry,str(args.workspace_id),str(args.path),"write");
   await createDirectory(io,file);return {workspace_id:file.workspace_id,path:file.path,created:true,committed:false};
  }
  case "delete_file":{
   fields(args,["workspace_id","path","expected_sha256"]);
   const file=ref(registry,str(args.workspace_id),str(args.path),"write");
   return trashFile(io,file,str(args.expected_sha256));
  }
  case "copy_file":
  case "move_file":{
   fields(args,["source_workspace_id","source_path","destination_workspace_id","destination_path","expected_sha256"]);
   const src=ref(registry,str(args.source_workspace_id),str(args.source_path),"read");
   if(name==="move_file")registry.requireGrant(src.workspace_id,"write");
   const dst=ref(registry,str(args.destination_workspace_id),str(args.destination_path),"write");
   return name==="copy_file"?copyFile(io,src,dst,str(args.expected_sha256)):moveFile(io,src,dst,str(args.expected_sha256));
  }
  default:throw Error("UNKNOWN_FILE_TOOL");
 }
}
