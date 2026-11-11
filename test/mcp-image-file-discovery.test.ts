import {test} from "node:test";
import assert from "node:assert/strict";
import {once} from "node:events";
import {createHttpMcpServer} from "../src/mcp/http.js";

/**
 * Proves the shipping HTTP MCP endpoint advertises import_image_file with
 * all documented ChatGPT fileParams fields; it cannot prove that an already
 * connected ChatGPT app has refreshed its cached tool inventory.
 */
test("authenticated tools/list advertises image importer as model-visible fileParam tool",async t=>{
 const token="image-import-tools-list-test-token-32-bytes-valid";
 const server=createHttpMcpServer(token);
 server.listen(0,"127.0.0.1");await once(server,"listening");
 t.after(()=>new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve())));
 const address=server.address();
 assert.ok(address&&typeof address!=="string");
 const url="http://127.0.0.1:"+address.port+"/mcp";
 const call=async bearer=>{
  const response=await fetch(url,{method:"POST",
   headers:{"content-type":"application/json","accept":"application/json, text/event-stream",
    "mcp-protocol-version":"2025-03-26",authorization:"Bearer "+bearer},
   body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list",params:{}})});
  return {status:response.status,body:await response.json() as any};
 };
 const unauthorized=await call("invalid");assert.equal(unauthorized.status,401);
 const response=await call(token);
 assert.equal(response.status,200);
 const tools=response.body.result?.tools;
 assert.ok(Array.isArray(tools));
 const importers=tools.filter((tool:any)=>tool.name==="import_image_file");
 assert.equal(importers.length,1);
 const importer=importers[0];
 assert.deepEqual(importer._meta?.["openai/fileParams"],["file"]);
 assert.equal(importer._meta?.ui?.visibility,undefined,"default is model + app");
 assert.deepEqual(importer.inputSchema.required.sort(),["workspace_id","path","file","control_token"].sort());
 assert.deepEqual(importer.inputSchema.properties.file.required,["download_url","file_id"]);
 assert.deepEqual(Object.keys(importer.inputSchema.properties.file.properties).sort(),["download_url","file_id","mime_type","file_name"].sort());
 assert.deepEqual(importer.annotations,{readOnlyHint:false,destructiveHint:false,openWorldHint:false,idempotentHint:false});
});
