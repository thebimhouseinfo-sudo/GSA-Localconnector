import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {StringDecoder} from 'node:string_decoder';
import {inspectDesktopConfig,saveDesktopConfig} from './desktop-config.mjs';
import {createMacPrivateFile} from './mac-desktop-private-file.mjs';

const fail=code=>Object.assign(new Error(code),{code});

// Raw input disables terminal echo before showing the prompt. Secrets never enter
// readline history, argv, shell interpolation, or output (including mask length).
export function promptTerminal({label,secret=false,input=process.stdin,output=process.stdout}){
 if(!input.isTTY||!output.isTTY||typeof input.setRawMode!=='function')throw fail('SETUP_REQUIRES_TTY');
 return new Promise((resolve,reject)=>{
  const wasRaw=!!input.isRaw,wasFlowing=input.readableFlowing===true,decoder=new StringDecoder('utf8');let value='',finished=false;
  const finish=(error)=>{
   if(finished)return;finished=true;
   input.removeListener('data',onData);input.removeListener('end',onEnd);input.removeListener('error',onError);
   input.setRawMode(wasRaw);if(!wasFlowing)input.pause();output.write('\n');
   if(error)reject(error);else resolve(value);
  };
  const onEnd=()=>finish(fail('SETUP_CANCELLED')),onError=()=>finish(fail('SETUP_INPUT_FAILED'));
  const onData=chunk=>{
   for(const char of decoder.write(chunk)){
    if(char==='\x03'||char==='\x04'){finish(fail('SETUP_CANCELLED'));return;}
    if(char==='\r'||char==='\n'){finish();return;}
    if(char==='\x7f'||char==='\b'){if(value){value=Array.from(value).slice(0,-1).join('');if(!secret)output.write('\b \b');}continue;}
    if(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(char)){finish(fail('CONFIG_INVALID'));return;}
    value+=char;if(Buffer.byteLength(value)>16384){finish(fail('CONFIG_INVALID'));return;}
    if(!secret)output.write(char);
   }
  };
  input.setRawMode(true);input.on('data',onData);input.once('end',onEnd);input.once('error',onError);
  input.resume();output.write(label);
 });
}

export async function resolveTerminalTarget({home=os.homedir(),requestedEnvPath,privateFile=createMacPrivateFile()}={}){
 const desktop=path.join(home,'Library/Application Support/GSA-Localconnector/desktop');
 let configured;
 try{
  const metadata=JSON.parse((await privateFile.readVerified(path.join(desktop,'config.json'))).bytes.toString('utf8'));
  configured=metadata.envPath;
  if(typeof configured!=='string'||!path.isAbsolute(configured))throw fail('CONFIG_PATH_INVALID');
 }catch(error){if(error.code!=='FILE_MISSING')throw fail(error.code??'CONFIG_PATH_INVALID');}
 if(configured&&requestedEnvPath&&configured!==requestedEnvPath)throw fail('CONFIG_PATH_CONFLICT');
 const target=configured??requestedEnvPath??path.join(desktop,'.env');
 if(!path.isAbsolute(target)||/[\u0000-\u001f\u007f]/u.test(target))throw fail('CONFIG_PATH_INVALID');
 if(target===path.join(desktop,'.env')){
  await fs.mkdir(desktop,{recursive:true,mode:0o700});
  const stat=await fs.lstat(desktop);
  if(!stat.isDirectory()||stat.uid!==process.getuid()||(stat.mode&0o777)!==0o700||await fs.realpath(desktop)!==desktop)throw fail('FILE_UNSAFE');
 }
 return target;
}

export async function setupTerminal({envPath,privateFile=createMacPrivateFile(),replace=false,prompt=promptTerminal}){
 const inspected=await inspectDesktopConfig({envPath,privateFile}),current=inspected.result;
 if(current.state==='READY'&&!replace)return {state:'READY'};
 if(current.state!=='READY'&&current.reason!=='FILE_MISSING'&&!(replace&&current.reason==='CONFIG_INVALID'&&inspected.identity!==null))throw fail(current.reason);
 const old=current.state==='READY'?current.values:null;
 const tunnelId=await prompt({label:`Tunnel ID${old?' (Enter to keep saved value)':''}: `,secret:false});
 const apiKey=await prompt({label:`API key (hidden${old?'; Enter to keep saved value':''}): `,secret:true});
 await saveDesktopConfig({envPath,privateFile,values:{tunnelId:tunnelId||old?.tunnelId,apiKey:apiKey||old?.apiKey},expectedIdentity:inspected.identity});
 return {state:'SAVED'};
}
