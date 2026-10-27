import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const executeFile=promisify(execFile);

// This is daemon readiness plus an observed successful control-plane poll, not
// end-to-end plugin acceptance or proof that every later poll remains successful.
export async function probeDesktopHealth({client,pid,urlFile,privateFile,environment,execute=executeFile,now=Date.now}){
 if(!Number.isSafeInteger(pid)||pid<=0)return 'UNKNOWN';
 let bytes;
 try{({bytes}=await privateFile.readVerified(urlFile));}
 catch(error){return error?.code==='FILE_MISSING'?'CONNECTING':'UNKNOWN';}
 if(!Buffer.isBuffer(bytes)||bytes.length>128)return 'UNKNOWN';
 const url=bytes.toString('utf8').trim();
 if(!url)return 'CONNECTING';
 const match=/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/?$/.exec(url);
 if(!match||Number(match[1])>65535)return 'UNKNOWN';
 let stdout;
 try{
  ({stdout}=await execute(client,['health','--url',url,'--pid',String(pid),'--require-control-plane-poll','--json'],{
   env:environment,timeout:2500,maxBuffer:16384,windowsHide:true
  }));
 }catch(error){stdout=error?.stdout;}
 try{
  const result=JSON.parse(stdout);
  if(result.process?.pid!==pid||result.process?.running!==true||result.healthz?.ok!==true||result.healthz?.status!==200||
     result.readyz?.ok!==true||result.readyz?.status!==200||result.control_plane_poll?.ok!==true||result.result!=='ok')return 'CONNECTING';
  const lastPoll=result.control_plane_poll.value,age=now()/1000-lastPoll;
  if(!Number.isFinite(lastPoll)||lastPoll<=0||age< -5||age>120)return 'CONNECTING';
  return 'CONNECTED';
 }catch{return 'UNKNOWN';}
}
