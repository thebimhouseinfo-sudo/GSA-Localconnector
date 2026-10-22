// Actual pinned client and loopback HTTP fixture; no real tunnel, key or HOME.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {probeDesktopHealth} from './desktop-health.mjs';
import {createMacPrivateFile} from './mac-desktop-private-file.mjs';

const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-health-native-')));
const client=fileURLToPath(new URL('../bin/tunnel-client',import.meta.url)),urlFile=path.join(root,'health.url');
const privateFile=createMacPrivateFile(),environment={HOME:root,PATH:'/usr/bin:/bin'};
let accept=false,requests=0,child,diagnostic='';
const server=http.createServer((request,response)=>{
 requests++;request.resume();response.writeHead(accept?200:503,{'Content-Type':'application/json'});
 // The pinned binary decodes a PolledCommandEnvelope object, not an array.
 // An empty envelope delivers no command to the embedded synthetic MCP stub.
 response.end('{}');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
async function eventually(predicate){for(let i=0;i<100;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,100));}throw Error('HEALTH_FIXTURE_TIMEOUT');}
try{
 await privateFile.replaceVerified(urlFile,Buffer.alloc(0),null);
 child=spawn(client,['run','--embedded-mcp-stub','--control-plane.tunnel-id','tunnel_0123456789abcdef0123456789abcdef',
  '--control-plane.base-url',`http://127.0.0.1:${server.address().port}`,'--control-plane.poll-timeout','100ms',
  '--health.listen-addr','127.0.0.1:0','--health.url-file',urlFile],{env:{...environment,CONTROL_PLANE_API_KEY:'synthetic-health-only'},stdio:['ignore','pipe','pipe']});
 for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{diagnostic=(diagnostic+chunk).slice(-4096);});
 const probe=()=>probeDesktopHealth({client,pid:child.pid,urlFile,privateFile,environment});
 await eventually(async()=>requests>0&&(await fs.readFile(urlFile,'utf8')).length>0);
 assert.equal(await probe(),'CONNECTING','local health endpoints alone must not pass');
 accept=true;
 await eventually(async()=>await probe()==='CONNECTED');
 console.log('PASS: actual client local health alone stays CONNECTING; successful synthetic server poll verifies health');
}catch(error){
 // Output belongs solely to this synthetic fixture, never a live connector.
 console.error(diagnostic.replaceAll('synthetic-health-only','[SYNTHETIC]'));
 throw error;
}finally{
 if(child&&child.exitCode===null){const closed=new Promise(resolve=>child.once('close',resolve));child.kill('SIGTERM');await closed;}
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 await fs.rm(root,{recursive:true,force:true});
}
