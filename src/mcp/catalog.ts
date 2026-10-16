/** Stable GitHub-like local MCP tool catalog.
 * Tool discovery does not imply authorization. Unimplemented or OS-unsafe operations fail closed.
 */
const str={type:"string"} as const;
const root={workspace_id:str} as const;
const target={workspace_id:str,path:str} as const;
function def(name:string,description:string,properties:Record<string,unknown>,required:string[]=Object.keys(properties)){
 return {name,description,inputSchema:{type:"object",properties,required,additionalProperties:false}};
}
export const plannedTools=[
 def("list_capabilities","Report enabled and blocked capabilities",{workspace_id:str},[]),
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
 def("run_command","Execute command through verified native OS sandbox",{workspace_id:str,command:str,args:{type:"array",items:str}}),
 def("start_process","Start a durable sandboxed local process",{workspace_id:str,command:str,args:{type:"array",items:str}}),
 def("list_processes","List connector-owned processes",{workspace_id:str}),
 def("process_status","Read a process status",{workspace_id:str,process_id:str}),
 def("process_output","Read bounded process output",{workspace_id:str,process_id:str}),
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
 def("ci_run","Submit sandboxed durable local CI run",{workspace_id:str,workflow:str}),
 def("ci_status","Read durable local CI status",{workspace_id:str,run_id:str}),
 def("ci_logs","Read bounded CI log lines",{workspace_id:str,run_id:str}),
 def("ci_artifacts","List CI artifacts",{workspace_id:str,run_id:str}),
 def("ci_read_artifact","Read verified CI artifact",{workspace_id:str,run_id:str,artifact:str}),
 def("ci_cancel","Cancel connector-owned CI run",{workspace_id:str,run_id:str}),
 def("ci_list_runs","List past CI runs",{workspace_id:str}),
 def("ci_rerun_failed","Request new run for failed steps",{workspace_id:str,run_id:str}),
] as const;
export const plannedToolNames=new Set<string>(plannedTools.map(x=>x.name));
