import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {downloadChatGptImage} from "../src/mcp/image-file-transfer.js";

const sample=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/t1sAAAAASUVORK5CYII=","base64");
const file={file_id:"file_test_asset_123456",download_url:"https://files.oaiusercontent.com/file?token=private"};
function stub(bytes:Uint8Array=sample,status=200,headers?:Record<string,string>):typeof fetch{
 return (async (_input,options)=>{
  assert.equal(options?.redirect,"manual");
  return new Response(Uint8Array.from(bytes).buffer as ArrayBuffer,{status,headers:headers??{"content-type":"application/octet-stream"}});
 }) as typeof fetch;
}
test("ChatGPT file param imports exact PNG bytes, MIME and SHA without altering data",async()=>{
 const r=await downloadChatGptImage({...file,mime_type:"image/png",file_name:"source.png"},"assets/output.png",stub());
 assert.deepEqual(r.bytes,sample);
 assert.equal(r.size,sample.length);
 assert.equal(r.mime_type,"image/png");
 assert.equal(r.sha256,createHash("sha256").update(sample).digest("hex"));
});
test("unresolved fileParams produce a distinct error and never download",async()=>{
 let calls=0;
 const noFetch=(async()=>{calls++;throw Error("UNEXPECTED_DOWNLOAD");}) as typeof fetch;
 for(const input of [file.file_id,"chat_upload://image_0",{file_id:file.file_id}]){
  await assert.rejects(downloadChatGptImage(input,"output.png",noFetch),{code:"FILEPARAM_UNRESOLVED"});
 }
 assert.equal(calls,0);
});
test("file input rejects arbitrary URL, local network, redirects, opaque file id and spoofed MIME",async()=>{
 for(const url of [
  "http://files.oaiusercontent.com/image",
  "https://127.0.0.1/image","https://localhost/a",
  "https://files.oaiusercontent.com.evil.example/a",
  "https://evil.example/a","https://user:secret@files.oaiusercontent.com/a",
  "https://files.oaiusercontent.com:8443/a",
  "file:///private/tmp/a.png"
 ])await assert.rejects(downloadChatGptImage({...file,download_url:url},"x.png",stub()),{code:"IMAGE_URL_REJECTED"});
 await assert.rejects(downloadChatGptImage({...file,file_id:"unknown"},"x.png",stub()),{code:"INVALID_IMAGE_FILE"});
 await assert.rejects(downloadChatGptImage(file,"x.png",stub(sample,302,{Location:"http://169.254.169.254"})),{code:"IMAGE_DOWNLOAD_FAILED"});
 await assert.rejects(downloadChatGptImage({...file,mime_type:"image/jpeg"},"x.png",stub()),{code:"IMAGE_MIME_MISMATCH"});
 await assert.rejects(downloadChatGptImage(file,"x.jpg",stub()),{code:"IMAGE_EXTENSION_MISMATCH"});
 await assert.rejects(downloadChatGptImage(file,"x.png",stub(Buffer.from("not an image"))),{code:"INVALID_IMAGE_BYTES"});
});
test("stream download enforces a strict eight-megabyte limit",async()=>{
 const huge=8*1024*1024+1;
 await assert.rejects(downloadChatGptImage(file,"x.png",stub(sample,200,{"content-length":String(huge)})),{code:"FILE_TOO_LARGE"});
 const body=new ReadableStream<Uint8Array>({start(controller){
  controller.enqueue(new Uint8Array(huge));controller.close();
 }});
 const fetcher=(async()=>new Response(body,{status:200})) as typeof fetch;
 await assert.rejects(downloadChatGptImage(file,"x.png",fetcher),{code:"FILE_TOO_LARGE"});
});
