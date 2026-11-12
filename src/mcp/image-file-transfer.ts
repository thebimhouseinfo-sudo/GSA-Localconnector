import {createHash} from "node:crypto";
import path from "node:path";

export type ChatGptFileInput={
 download_url:string;
 file_id:string;
 mime_type?:string;
 file_name?:string;
};
export type DownloadedImage={bytes:Buffer;size:number;sha256:string;mime_type:"image/png"|"image/jpeg"|"image/webp"};
const MAX_IMAGE_BYTES=8*1024*1024;
const fail=(code:string):never=>{throw Object.assign(new Error(code),{code});};
function approvedHost(hostname:string):boolean{
 return hostname==="files.oaiusercontent.com"||
  hostname.endsWith(".oaiusercontent.com")||
  hostname==="chatgpt.com"||
  hostname.endsWith(".chatgpt.com");
}
function source(value:unknown):ChatGptFileInput{
 // An opaque model-facing string is not a host-provided download object.
 // Diagnose the *shape only*, never values, keys, URLs, IDs, or tokens.
 if(value===null)fail("FILEPARAM_NULL");
 if(value===undefined)fail("FILEPARAM_MISSING");
 if(typeof value==="string")fail("FILEPARAM_UNRESOLVED");
 if(Array.isArray(value))fail("FILEPARAM_ARRAY");
 if(typeof value!=="object")fail("FILEPARAM_INVALID_TYPE");
 const v=value as Record<string,unknown>,keys=Object.keys(v);
 if(keys.length===0)fail("FILEPARAM_EMPTY_OBJECT");
 if(keys.some(key=>!["download_url","file_id","mime_type","file_name"].includes(key)))fail("FILEPARAM_UNEXPECTED_FIELDS");
 if(!Object.hasOwn(v,"download_url")){
  if(Object.hasOwn(v,"file_id"))fail("FILEPARAM_UNRESOLVED");
  fail("FILEPARAM_DOWNLOAD_URL_MISSING");
 }
 if(!Object.hasOwn(v,"file_id"))fail("FILEPARAM_FILE_ID_MISSING");
 if(typeof v.download_url!=="string"||v.download_url.length===0)fail("FILEPARAM_DOWNLOAD_URL_INVALID");
 // file_id is opaque metadata; OpenAI's fileParam schema specifies string,
 // not a fixed file_ or file- prefix. Authorization comes from the bounded URL.
 const fileId=v.file_id;
 if(typeof fileId!=="string")fail("FILEPARAM_FILE_ID_TYPE_INVALID");
 if(!fileId.length||fileId.length>1024||/[\u0000-\u001f\u007f]/.test(fileId))fail("FILEPARAM_FILE_ID_INVALID");
 if(v.mime_type!==undefined&&typeof v.mime_type!=="string"||
    v.file_name!==undefined&&typeof v.file_name!=="string")fail("FILEPARAM_OPTIONAL_FIELDS_INVALID");
 return v as ChatGptFileInput;
}
function approvedUrl(downloadUrl:string):URL{
 if(downloadUrl.length>8192||/[\u0000-\u001f\u007f]/.test(downloadUrl))fail("IMAGE_URL_REJECTED");
 let url:URL;
 try{url=new URL(downloadUrl);}catch{return fail("IMAGE_URL_REJECTED");}
 if(url.protocol!=="https:"||url.username||url.password||url.port||url.hash||!approvedHost(url.hostname))fail("IMAGE_URL_REJECTED");
 return url;
}
function detectedType(bytes:Buffer):DownloadedImage["mime_type"]{
 if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from("89504e470d0a1a0a","hex"))&&
    bytes.subarray(12,16).toString("ascii")==="IHDR"&&
    bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(20)>0)return "image/png";
 if(bytes.length>=4&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff&&bytes.at(-2)===0xff&&bytes.at(-1)===0xd9)return "image/jpeg";
 if(bytes.length>=16&&bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP"&&
    bytes.readUInt32LE(4)+8===bytes.length)return "image/webp";
 return fail("INVALID_IMAGE_BYTES");
}
function assertMatchingExtension(target:string,mime:DownloadedImage["mime_type"]){
 const ext=path.posix.extname(target).toLowerCase();
 if(mime==="image/png"&&ext!==".png"||
    mime==="image/jpeg"&&![".jpg",".jpeg"].includes(ext)||
    mime==="image/webp"&&ext!==".webp")fail("IMAGE_EXTENSION_MISMATCH");
}
/**
 * Only host-provided temporary ChatGPT file URLs, never arbitrary remote URLs.
 * This prepares bytes; the caller must still prove current controller/write
 * authority and use the existing signed native create-exclusive backend.
 *
 * No URL, signed query string, or response payload is included in errors.
 */
export async function downloadChatGptImage(
 value:unknown,targetRelativePath:string,fetcher:typeof fetch=fetch
):Promise<DownloadedImage>{
 const file=source(value),url=approvedUrl(file.download_url);
 if(typeof targetRelativePath!=="string"||!targetRelativePath)fail("INVALID_ARGUMENTS");
 let response:Response;
 try{
  response=await fetcher(url.toString(),{
   method:"GET",redirect:"manual",signal:AbortSignal.timeout(30000),
   headers:{Accept:"image/png, image/jpeg, image/webp, application/octet-stream"}
  });
 }catch{
  // Never expose signed URLs, query parameters, or transport diagnostics.
  return fail("IMAGE_DOWNLOAD_FAILED");
 }
 if(response.status!==200||!response.body)throw Object.assign(new Error("IMAGE_DOWNLOAD_FAILED"),{code:"IMAGE_DOWNLOAD_FAILED"});
 const body=response.body;
 const length=response.headers.get("content-length");
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_IMAGE_BYTES))fail("FILE_TOO_LARGE");
 const reader=body.getReader(),parts:Buffer[]=[];let total=0;
 try{
  for(;;){
   const {done,value}=await reader.read();
   if(done)break;
   total+=value.byteLength;
   if(total>MAX_IMAGE_BYTES)fail("FILE_TOO_LARGE");
   parts.push(Buffer.from(value));
  }
 }catch(error){
  await reader.cancel().catch(()=>undefined);
  if(error&&typeof error==="object"&&"code" in error&&error.code==="FILE_TOO_LARGE")throw error;
  return fail("IMAGE_DOWNLOAD_FAILED"); // never echo network/internal errors or signed URL
 }finally{reader.releaseLock();}
 const bytes=Buffer.concat(parts,total),mime=detectedType(bytes);
 assertMatchingExtension(targetRelativePath,mime);
 if(file.mime_type&&file.mime_type!==mime&&file.mime_type!=="application/octet-stream")fail("IMAGE_MIME_MISMATCH");
 return {bytes,size:total,sha256:createHash("sha256").update(bytes).digest("hex"),mime_type:mime};
}
