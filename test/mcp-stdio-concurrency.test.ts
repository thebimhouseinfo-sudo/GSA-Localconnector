import {test} from "node:test";
import assert from "node:assert/strict";
import {PassThrough} from "node:stream";
import {runStdio,type ToolResult} from "../src/mcp/server.js";
import {WorkspaceRegistry} from "../src/core/workspace.js";
const result:ToolResult={content:[{type:"text",text:'{"ok":true}'}]};
test("stdio processes release_control and ping while a command is still running",async()=>{
 const input=new PassThrough(),output=new PassThrough();const frames:any[]=[];let buffer="";
 output.on("data",bytes=>{buffer+=bytes.toString();let next:number;while((next=buffer.indexOf("\n"))>=0){frames.push(JSON.parse(buffer.slice(0,next)));buffer=buffer.slice(next+1);}});
 let release!:(r:ToolResult)=>void,entered!:()=>void;const started=new Promise<void>(r=>{entered=r;});
 const serve=runStdio(new WorkspaceRegistry(),async call=>{if(call.name==="run_command"){entered();return new Promise(r=>{release=r;});}return result;},{input,output});
 const send=(id:number,method:string,params?:object)=>input.write(JSON.stringify({jsonrpc:"2.0",id,method,params})+"\n");
 send(1,"tools/call",{name:"run_command",arguments:{}});await started;
 send(2,"tools/call",{name:"release_control",arguments:{}});send(3,"ping");
 try{
  await new Promise(r=>setTimeout(r,30));
  assert.deepEqual(frames.map(frame=>frame.id).sort(),[2,3]);
 }finally{release(result);input.end();await serve;output.end();}
 assert.equal(frames[frames.length-1].id,1);
});
test("stdio rejects excess ordinary calls while reserving control capacity and ping",async()=>{
 const input=new PassThrough(),output=new PassThrough();const frames:any[]=[];let buffer="";const held:Array<(r:ToolResult)=>void>=[];
 output.on("data",bytes=>{buffer+=bytes.toString();let next:number;while((next=buffer.indexOf("\n"))>=0){frames.push(JSON.parse(buffer.slice(0,next)));buffer=buffer.slice(next+1);}});
 const serve=runStdio(new WorkspaceRegistry(),async call=>call.name==="release_control"?result:new Promise(resolve=>{held.push(resolve);}),{input,output});
 for(let id=1;id<=40;id++)input.write(JSON.stringify({jsonrpc:"2.0",id,method:"tools/call",params:{name:"run_command",arguments:{}}})+"\n");
 input.write(JSON.stringify({jsonrpc:"2.0",id:100,method:"ping"})+"\n");
 input.write(JSON.stringify({jsonrpc:"2.0",id:101,method:"tools/call",params:{name:"release_control",arguments:{}}})+"\n");
 try{
  await new Promise(r=>setTimeout(r,30));assert.equal(held.length,32);
  assert.equal(frames.filter(frame=>frame.error?.message==="SERVER_BUSY").length,8);assert(frames.some(frame=>frame.id===100&&frame.result));assert(frames.some(frame=>frame.id===101&&frame.result));
 }finally{for(const resolve of held)resolve(result);input.end();await serve;output.end();}
});
test("stdio also bounds the reserved control lane",async()=>{
 const input=new PassThrough(),output=new PassThrough();const frames:any[]=[];let buffer="";const held:Array<(r:ToolResult)=>void>=[];
 output.on("data",bytes=>{buffer+=bytes.toString();let next:number;while((next=buffer.indexOf("\n"))>=0){frames.push(JSON.parse(buffer.slice(0,next)));buffer=buffer.slice(next+1);}});
 const serve=runStdio(new WorkspaceRegistry(),async()=>new Promise(resolve=>{held.push(resolve);}),{input,output});
 for(let id=1;id<=6;id++)input.write(JSON.stringify({jsonrpc:"2.0",id,method:"tools/call",params:{name:"stop_process",arguments:{}}})+"\n");
 try{await new Promise(r=>setTimeout(r,30));assert.equal(held.length,4);assert.equal(frames.filter(frame=>frame.error?.message==="SERVER_BUSY").length,2);}
 finally{for(const resolve of held)resolve(result);input.end();await serve;output.end();}
});
