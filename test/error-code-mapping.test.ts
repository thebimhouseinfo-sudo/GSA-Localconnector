import {test} from "node:test";
import assert from "node:assert/strict";
import {PassThrough} from "node:stream";
import type {AddressInfo} from "node:net";
import {createHttpMcpServer} from "../src/mcp/http.js";
import {runStdio} from "../src/mcp/server.js";

const token="test-only-ephemeral-secret-of-at-least-32-chars";
async function withHttp<T>(invoke:any,fn:(rpc:(id:number,method:string,params?:unknown)=>Promise<any>)=>Promise<T>):Promise<T>{
 const server=createHttpMcpServer(token,undefined,invoke);
 await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
 const port=(server.address() as AddressInfo).port;
 const rpc=async(id:number,method:string,params:unknown={})=>(await fetch(`http://127.0.0.1:${port}/mcp`,{method:"POST",
  headers:{authorization:"Bearer "+token,"content-type":"application/json",accept:"application/json, text/event-stream","mcp-protocol-version":"2025-03-26"},
  body:JSON.stringify({jsonrpc:"2.0",id,method,params})})).json();
 try{return await fn(rpc);}
 finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}

test("HTTP maps a throwing tool to -32603 without leaking the raw message",async t=>{
 const written:string[]=[];t.mock.method(process.stderr,"write",(text:string)=>{written.push(String(text));return true;});
 await withHttp(async()=>{throw Error("boom /secret/path");},async rpc=>{
  const res=await rpc(1,"tools/call",{name:"x",arguments:{}});
  assert.equal(res.error.code,-32603);
  assert.equal(res.error.message,"Internal error");
  assert.ok(!JSON.stringify(res).includes("/secret/path"));
 });
 assert.ok(written.some(line=>line.includes("boom /secret/path")),"details go to stderr");
});

test("HTTP keeps -32602 for invalid params",async()=>{
 await withHttp(async()=>({content:[]}),async rpc=>{
  const res=await rpc(2,"tools/call",{name:42});
  assert.equal(res.error.code,-32602);
 });
});

test("stdio maps INVALID_REQUEST to -32600 and METHOD_NOT_FOUND to -32601",async()=>{
 const input=new PassThrough(),output=new PassThrough();
 const lines:any[]=[];output.setEncoding("utf8");output.on("data",chunk=>{for(const l of String(chunk).split("\n"))if(l.trim())lines.push(JSON.parse(l));});
 const done=runStdio(undefined,async()=>({content:[]}),{input,output});
 input.write(JSON.stringify({jsonrpc:"1.0",id:1,method:"ping"})+"\n");
 input.write(JSON.stringify({jsonrpc:"2.0",id:2,method:"nope"})+"\n");
 input.end();await done;
 assert.equal(lines.find(l=>l.id===1).error.code,-32600);
 assert.equal(lines.find(l=>l.id===2).error.code,-32601);
});
