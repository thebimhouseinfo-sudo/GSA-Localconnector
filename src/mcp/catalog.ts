/** Stable GitHub-like local MCP tool catalog.
 * Tool discovery does not imply authorization. Unimplemented or OS-unsafe operations fail closed.
 */
const str={type:"string"} as const;
const cursor={type:"integer",minimum:0} as const;
const pageLimit=(maximum:number)=>({type:"integer",minimum:1,maximum});
const root={workspace_id:str} as const;
const target={workspace_id:str,path:str} as const;
function def(name:string,description:string,properties:Record<string,unknown>,required:string[]=Object.keys(properties)){
 return {name,description,inputSchema:{type:"object",properties,required,additionalProperties:false}};
}
export const controlledToolNames=new Set([
 "bind_workspaces","unbind_workspace","create_file","update_file","edit_file","apply_patch",
 "delete_file","create_directory","copy_file","move_file","batch_file_operations","run_command",
 "start_process","stop_process","git_status","git_diff","git_log","git_show","compare_commits",
 "git_fetch","git_pull","git_add","git_commit","git_push","create_branch","git_checkout",
 "ci_prepare_source","ci_run","ci_rerun_failed","ci_cancel","get_file_transaction",
 "inspect_directory","copy_directory","get_directory_copy"
]);
const directoryString={type:"string",minLength:1} as const;
const directoryPath={...directoryString,maxLength:4096} as const;
const copyId={...directoryString,pattern:"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"} as const;
export const plannedTools=[
 def("inspect_directory","Inspect a bounded native directory manifest; current controller required",{workspace_id:directoryString,path:directoryPath}),
 def("copy_directory","Copy a bounded directory into a new writable destination; current controller required",{copy_id:copyId,source_workspace_id:directoryString,source_path:directoryPath,destination_workspace_id:directoryString,destination_path:directoryPath,expected_manifest_sha256:{...directoryString,pattern:"^[a-f0-9]{64}$"}}),
 def("get_directory_copy","Read directory copy metadata without retrying; current controller required",{copy_id:copyId}),
 def("acquire_control","Acquire the exclusive authenticated controller lease",{},[]),
 def("renew_control","Renew an unexpired controller lease",{control_token:str}),
 def("release_control","Release the matching controller lease",{control_token:str}),
 def("list_capabilities","Report enabled and blocked capabilities",{workspace_id:str},[]),
 def("get_file_transaction","Explicitly inspect a file transaction; never retry a mutation or restore files",{transaction_id:{type:"string",pattern:"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"}}),
 def("glob","Find files by a bounded relative glob",{...target,pattern:str}),
 def("create_file","Create a new file under a writable workspace, fail on conflict",{...target,content:str}),
 def("update_file","Replace an existing file with expected SHA256 guard",{...target,content:str,expected_sha256:str}),
 def("edit_file","Exact-match replace in a file with expected SHA256",{...target,old_text:str,new_text:str,expected_sha256:str}),
 def("apply_patch","Apply a checked source patch",{...target,patch:str,expected_sha256:str}),
 def("delete_file","Move a file to system Trash/Recycle Bin",{...target,expected_sha256:str}),
 def("create_directory","Create a directory under granted root",target),
 def("copy_file","Copy file between explicitly granted roots",{source_workspace_id:str,source_path:str,destination_workspace_id:str,destination_path:str,expected_sha256:str}),
 def("move_file","Move file between explicitly granted roots",{source_workspace_id:str,source_path:str,destination_workspace_id:str,destination_path:str,expected_sha256:str}),
 def("batch_file_operations","Apply independently reported validated file actions",{workspace_id:str,operations:{type:"array",items:{type:"object"},minItems:1,maxItems:50}}),
 def("run_command","Execute a sandboxed command; macOS uses a disposable Linux Workspace snapshot and never copies guest edits back to the host",{workspace_id:str,command:str,args:{type:"array",items:str}}),
 def("start_process","Start a durable sandboxed local process",{workspace_id:str,command:str,args:{type:"array",items:str}}),
 def("list_processes","List connector-owned processes",{workspace_id:str}),
 def("process_status","Read a process status",{workspace_id:str,process_id:str}),
 def("process_output","Read bounded process output",{workspace_id:str,process_id:str,cursor,limit:pageLimit(65536)},["workspace_id","process_id"]),
 def("stop_process","Stop connector-owned process tree",{workspace_id:str,process_id:str}),
 def("git_status","Read local Git status",{workspace_id:str}),
 def("git_diff","Read local Git diff",{workspace_id:str}),
 def("git_log","Read bounded local Git log",{workspace_id:str}),
 def("git_show","Read local Git object",{workspace_id:str,revision:str}),
 def("git_fetch","Fetch from configured remote with explicit authorization",{workspace_id:str}),
 def("git_pull","Pull without discarding user changes",{workspace_id:str}),
 def("git_add","Stage exact paths",{workspace_id:str,paths:{type:"array",items:str}}),
 def("git_commit","Commit staged local changes",{workspace_id:str,message:str}),
 def("git_push","Push to configured remote",{workspace_id:str}),
 def("create_branch","Create a local branch",{workspace_id:str,branch:str}),
 def("git_checkout","Switch local branch safely",{workspace_id:str,branch:str}),
 def("compare_commits","Compare two local Git revisions",{workspace_id:str,base:str,head:str}),
 def("ci_list_workflows","List local workflows",{workspace_id:str}),
 def("ci_validate_workflow","Validate local CI DAG manifest",{workspace_id:str,workflow:str}),
 def("ci_prepare_source","Capture immutable Workspace source via verified native filesystem backend",{workspace_id:str}),
 def("ci_run","Submit sandboxed durable local CI run",{workspace_id:str,workflow:str,source_run_id:str}),
 def("ci_status","Read durable local CI status",{workspace_id:str,run_id:str}),
 def("ci_logs","Read bounded CI log lines",{workspace_id:str,run_id:str,cursor,limit:pageLimit(100)},["workspace_id","run_id"]),
 def("ci_artifacts","List CI artifacts",{workspace_id:str,run_id:str}),
 def("ci_read_artifact","Read verified CI artifact",{workspace_id:str,run_id:str,artifact:str}),
 def("ci_cancel","Cancel connector-owned CI run",{workspace_id:str,run_id:str}),
 def("ci_list_runs","List past CI runs",{workspace_id:str}),
 def("ci_rerun_failed","Request new run for failed steps",{workspace_id:str,run_id:str}),
] as const;
export const plannedToolNames=new Set<string>(plannedTools.map(x=>x.name));
