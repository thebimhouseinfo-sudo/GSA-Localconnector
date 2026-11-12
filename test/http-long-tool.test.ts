import {test} from "node:test";
import assert from "node:assert/strict";
import {createConnection} from "node:net";
import type {AddressInfo} from "node:net";
import {createHttpMcpServer} from "../src/mcp/http.js";

const token="test-only-ephemeral-secret-of-at-least-32-chars";

test("HTTP returns a full response for a tool that runs longer than the old 30s socket cut",{timeout:60000},async()=>{
 const server=createHttpMcpServer(token,undefined,async()=>{
  await new Promise(resolve=>setTimeout(resolve,35000));
  return {content:[{type:"text" as const,text:JSON.stringify({ok:true,result:"slow-done"})}]};
 });
 await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
 const port=(server.address() as AddressInfo).port;
 try{
  const res=await fetch(`http://127.0.0.1:${port}/mcp`,{method:"POST",signal:AbortSignal.timeout(55000),
   headers:{authorization:"Bearer "+token,"content-type":"application/json",accept:"application/json, text/event-stream","mcp-protocol-version":"2025-03-26"},
   body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"slow",arguments:{}}})});
  const body=await res.json() as any;
  assert.equal(res.status,200);
  assert.match(body.result.content[0].text,/slow-done/);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

test("HTTP still cuts a client that sends headers slower than headersTimeout",{timeout:30000},async()=>{
 const server=createHttpMcpServer(token);let socket:ReturnType<typeof createConnection>|undefined;
 await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
 const port=(server.address() as AddressInfo).port;
 try{
  const started=Date.now();
  await new Promise<void>((resolve,reject)=>{
   socket=createConnection({host:"127.0.0.1",port},()=>socket!.write("POST /mcp HTTP/1.1\r\nHost: localhost\r\n"));
   socket.on("data",()=>{});socket.on("error",()=>resolve());socket.on("close",()=>resolve());
   setTimeout(()=>reject(Error("slow headers were not cut")),25000).unref();
  });
  const elapsed=Date.now()-started;
  assert.ok(elapsed>=9000&&elapsed<20000,"cut by headersTimeout, took "+elapsed);
 }finally{socket?.destroy();server.closeAllConnections();if(server.listening)await new Promise<void>(r=>server.close(()=>r()));}
});
