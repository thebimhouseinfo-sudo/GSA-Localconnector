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
test("malformed host fileParams are classified without fetch or disclosure",async()=>{
 let calls=0;
 const noFetch=(async()=>{calls++;throw Error("UNEXPECTED_DOWNLOAD");}) as typeof fetch;
 const cases:Array<[unknown,string]>=[
  [null,"FILEPARAM_NULL"],
  [undefined,"FILEPARAM_MISSING"],
  [file.file_id,"FILEPARAM_UNRESOLVED"],
  ["chat_upload://image_0","FILEPARAM_UNRESOLVED"],
  [[], "FILEPARAM_ARRAY"],
  [42,"FILEPARAM_INVALID_TYPE"],
  [{},"FILEPARAM_EMPTY_OBJECT"],
  [{file_id:file.file_id},"FILEPARAM_UNRESOLVED"],
  [{file_name:"only.png"},"FILEPARAM_DOWNLOAD_URL_MISSING"],
  [{download_url:file.download_url},"FILEPARAM_FILE_ID_MISSING"],
  [{...file,extra_field:"private"},"FILEPARAM_UNEXPECTED_FIELDS"],
  [{...file,download_url:123},"FILEPARAM_DOWNLOAD_URL_INVALID"],
  [{...file,download_url:""},"FILEPARAM_DOWNLOAD_URL_INVALID"],
  [{...file,file_id:42},"FILEPARAM_FILE_ID_TYPE_INVALID"],
  [{...file,file_id:null},"FILEPARAM_FILE_ID_TYPE_INVALID"],
  [{...file,file_id:""},"FILEPARAM_FILE_ID_INVALID"],
  [{...file,file_id:"\n"},"FILEPARAM_FILE_ID_INVALID"],
  [{...file,file_id:"z".repeat(1025)},"FILEPARAM_FILE_ID_INVALID"],
  [{...file,file_name:123},"FILEPARAM_OPTIONAL_FIELDS_INVALID"],
  [{...file,mime_type:123},"FILEPARAM_OPTIONAL_FIELDS_INVALID"]
 ];
 for(const [input,code] of cases){
  await assert.rejects(
   downloadChatGptImage(input,"output.png",noFetch),
   (e:unknown)=>{
    assert.ok(e instanceof Error);
    assert.equal((e as Error&{code?:string}).code,code);
    assert.equal(e.message,code);
    assert.ok(!e.message.includes(file.download_url));
    return true;
   }
  );
 }
 assert.equal(calls,0,"bad host inputs must never trigger a download");
});
test("opaque host file IDs are accepted as metadata without a prefix",async()=>{
 for(const id of ["unknown","9c031f/opaque:v2","chatgpt-artifact:2026-11-12"]){
  const r=await downloadChatGptImage({...file,file_id:id},"output.png",stub());
  assert.deepEqual(r.bytes,sample);
  assert.equal(r.sha256,createHash("sha256").update(sample).digest("hex"));
 }
});
test("approved Azure Blob Storage fileParam transfers original bytes and digest",async()=>{
 const url="https://imageassets123.blob.core.windows.net/artwork/generated.png?sv=2026-01-01&sig=private";
 let count=0;
 const fetcher=(async (input,options)=>{
  count++;
  assert.equal(new URL(String(input)).hostname,"imageassets123.blob.core.windows.net");
  assert.equal(options?.redirect,"manual");
  assert.equal(options?.method,"GET");
  return new Response(Uint8Array.from(sample).buffer as ArrayBuffer,{status:200});
 }) as typeof fetch;
 const r=await downloadChatGptImage({...file,download_url:url},"asset.png",fetcher);
 assert.equal(count,1);
 assert.deepEqual(r.bytes,sample);
 assert.equal(r.size,sample.length);
 assert.equal(r.sha256,createHash("sha256").update(sample).digest("hex"));
});
test("file URL rejects unsafe origins with finite, nonsecret diagnostics",async()=>{
 const bad:Array<[string,string]>=[
  ["http://files.oaiusercontent.com/image","IMAGE_URL_SCHEME_REJECTED"],
  ["https://127.0.0.1/image","IMAGE_URL_HOST_REJECTED"],
  ["https://localhost/a","IMAGE_URL_HOST_REJECTED"],
  ["https://files.oaiusercontent.com.evil.example/a","IMAGE_URL_HOST_REJECTED"],
  ["https://evil.example/a","IMAGE_URL_HOST_REJECTED"],
  ["https://example.windows.net/art","IMAGE_URL_HOST_REJECTED"],
  ["https://someacc.queue.core.windows.net/art","IMAGE_URL_HOST_REJECTED"],
  ["https://someacc.file.core.windows.net/art","IMAGE_URL_HOST_REJECTED"],
  ["https://blob.core.windows.net/art","IMAGE_URL_HOST_REJECTED"],
  ["https://xx.blob.core.windows.net/art","IMAGE_URL_HOST_REJECTED"],
  ["https://account.extra.blob.core.windows.net/art","IMAGE_URL_HOST_REJECTED"],
  ["https://account.blob.core.windows.net.attacker.example/art","IMAGE_URL_HOST_REJECTED"],
  ["https://user:secret@files.oaiusercontent.com/a","IMAGE_URL_CREDENTIALS_REJECTED"],
  ["https://files.oaiusercontent.com:8443/a","IMAGE_URL_PORT_REJECTED"],
  ["file:///private/tmp/a.png","IMAGE_URL_SCHEME_REJECTED"],
  ["https://files.oaiusercontent.com/a#frag","IMAGE_URL_FRAGMENT_REJECTED"],
  ["not a valid URL","IMAGE_URL_MALFORMED"]
 ];
 let calls=0;
 const noFetch=(async()=>{calls++;throw Error("SHOULD_NOT_FETCH");}) as typeof fetch;
 for(const [url,code] of bad){
  await assert.rejects(downloadChatGptImage({...file,download_url:url},"x.png",noFetch),
   (e:unknown)=>{
    assert.ok(e instanceof Error);
    assert.equal((e as Error&{code?:string}).code,code);
    assert.equal(e.message,code);
    assert.ok(!JSON.stringify(e).includes(url),"error must never leak URL");
    return true;
   });
 }
 assert.equal(calls,0);
 await assert.rejects(downloadChatGptImage({...file,download_url:"https://cdn.newvendor.example/download?secret=never-echo"},"x.png",noFetch),
  (e:unknown)=>{
   assert.ok(e instanceof Error);
   assert.equal((e as Error&{code?:string}).code,"IMAGE_URL_HOST_REJECTED");
   assert.equal((e as Error&{host_suffix?:string}).host_suffix,"newvendor.example");
   assert.ok(!JSON.stringify(e).includes("never-echo"));
   assert.ok(!JSON.stringify(e).includes("cdn."));
   return true;
  });
 await assert.rejects(downloadChatGptImage({...file,file_id:42},"x.png",stub()),{code:"FILEPARAM_FILE_ID_TYPE_INVALID"});
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
