import {test} from "node:test";
import assert from "node:assert/strict";
import {validateMacHostCommandRequest,MAC_HOST_COMMAND_DISCLOSURE} from "../src/hosts/macos-host-command-request.js";
const base={workspace_id:"work",executable:"/usr/bin/git",argv:["status","--short"],cwd_relative:".",time_limit_ms:10000,max_output_bytes:65536};
test("M3 same-user host request accepts nested workspace cwd and reports no confinement",()=>{
 for(const cwd_relative of [".","src","project/subdir"])assert.doesNotThrow(()=>validateMacHostCommandRequest({...base,cwd_relative}));
 assert.deepEqual(MAC_HOST_COMMAND_DISCLOSURE,{command_confinement:"none (user account)",state_integrity_vs_commands:"not_protected"});
});
test("M3 host request rejects path traversal, cross-root, malformed and unbounded requests",()=>{
 for(const cwd_relative of ["","..","../src","src/../other","/tmp","C:/Windows","src//nested","src/./nested","src\\nested"])assert.throws(()=>validateMacHostCommandRequest({...base,cwd_relative}),{code:"INVALID_PROCESS"});
 for(const patch of [{executable:""},{argv:["a\0b"]},{time_limit_ms:0},{time_limit_ms:120001},{max_output_bytes:0},{max_output_bytes:2097153},{workspace_id:"  "}])assert.throws(()=>validateMacHostCommandRequest({...base,...patch}),{code:"INVALID_PROCESS"});
});
