import test from 'node:test';
import assert from 'node:assert/strict';
import {probeDesktopHealth} from '../scripts/desktop-health.mjs';

// Shape characterized from the pinned binary, including result:"ok" and the
// Unix timestamp of its most recent successful control-plane poll.
const report={result:'ok',process:{pid:12345,running:true},healthz:{ok:true,status:200},readyz:{ok:true,status:200},control_plane_poll:{ok:true,value:1000}};
const options={client:'/fixture/tunnel-client',pid:12345,urlFile:'/fixture/health.url',privateFile:{readVerified:async()=>({bytes:Buffer.from('http://127.0.0.1:54321\n')})},environment:{HOME:'/fixture',PATH:'/usr/bin:/bin'},now:()=>1000_000};
test('health requires the retained PID, live endpoints and successful control-plane poll',async()=>{
 let called;
 assert.equal(await probeDesktopHealth({...options,execute:async(...args)=>{called=args;return {stdout:JSON.stringify(report)};}}),'CONNECTED');
 assert.deepEqual(called[1],['health','--url','http://127.0.0.1:54321','--pid','12345','--require-control-plane-poll','--json']);
 assert.deepEqual(called[2].env,options.environment);
 for(const changed of [{result:'fail'},{process:{pid:54321,running:true}},{process:{pid:12345,running:false}},{healthz:{ok:false,status:500}},{readyz:{ok:false,status:503}},{control_plane_poll:{ok:false}}]){
  assert.equal(await probeDesktopHealth({...options,execute:async()=>({stdout:JSON.stringify({...report,...changed})})}),'CONNECTING');
 }
});
test('a historical success cannot leave health verified indefinitely',async()=>{
 for(const value of [undefined,'1000',0,879,1006]){
  assert.equal(await probeDesktopHealth({...options,execute:async()=>({stdout:JSON.stringify({...report,control_plane_poll:{ok:true,value}})})}),'CONNECTING');
 }
});
test('health refuses remote URLs, unsafe locator files and absent PID without executing',async()=>{
 for(const url of ['https://example.com','http://localhost:8080','http://127.0.0.1:99999','http://127.0.0.1:8080/metrics','http://127.0.0.1:8080\nhttp://remote:1']){
  assert.equal(await probeDesktopHealth({...options,privateFile:{readVerified:async()=>({bytes:Buffer.from(url)})},execute:()=>assert.fail('must refuse')}),'UNKNOWN');
 }
 assert.equal(await probeDesktopHealth({...options,pid:undefined,execute:()=>assert.fail('no retained PID')}),'UNKNOWN');
 assert.equal(await probeDesktopHealth({...options,privateFile:{readVerified:async()=>{throw Error('unsafe');}},execute:()=>assert.fail('unsafe file')}),'UNKNOWN');
});
test('missing startup locator is connecting; failed or malformed probes do not claim connection',async()=>{
 assert.equal(await probeDesktopHealth({...options,privateFile:{readVerified:async()=>{throw Object.assign(Error(),{code:'FILE_MISSING'});}}}),'CONNECTING');
 assert.equal(await probeDesktopHealth({...options,privateFile:{readVerified:async()=>({bytes:Buffer.alloc(0)})}}),'CONNECTING');
 assert.equal(await probeDesktopHealth({...options,execute:async()=>{throw Error('probe failed');}}),'UNKNOWN');
 assert.equal(await probeDesktopHealth({...options,execute:async()=>({stdout:'invalid json'})}),'UNKNOWN');
});
