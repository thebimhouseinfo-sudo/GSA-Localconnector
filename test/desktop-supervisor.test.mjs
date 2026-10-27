import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import os from "node:os";
import path from "node:path";
import {startDesktopRuntime} from "../scripts/desktop-supervisor.mjs";

const apiKey="synthetic-supervisor-key";
const setup={state:"READY",identity:"fixture-config-identity",values:{tunnelId:"tunnel_0123456789abcdef0123456789abcdef",apiKey}};
class FakeChild extends EventEmitter {
 constructor(){super();this.stdout=new PassThrough();this.stderr=new PassThrough();this.exitCode=null;this.signals=[];}
 kill(signal){this.signals.push(signal);queueMicrotask(()=>{this.exitCode=0;this.emit("close",0,signal);});return true;}
}
function makeAdapter(overrides={}){
 const child=new FakeChild(),neighbor=new FakeChild(),calls={spawn:[],loadSetup:0,logs:[],released:0};
 const {loadSetup:customLoadSetup,...rest}=overrides;
 const owner={installationId:"install-00000000-0000-4000-8000-000000000001",sessionId:"session-00000000-0000-4000-8000-000000000002",lockFD:3};
 const adapter={
  loadSetup:async()=>{calls.loadSetup++;return setup;},
  acquireOwner:async()=>owner,
  tunnelClient:()=>"/fixture/runtime/bin/tunnel-client",
  runFlag:"--config",
  prepareProfile:async({runtimeRoot,tunnelId})=>({path:path.join(runtimeRoot,"private-profile.yaml"),tunnelId}),
  baseEnvironment:{HOME:"/fixture/home",PATH:"/usr/bin:/bin"},
  spawn:async(command,args,options)=>{calls.spawn.push({command,args,options});return child;},
  connectionStatus:async()=>"DISCONNECTED",
  ownedWorkState:async()=>"IDLE",
  writeLog:async(chunk)=>calls.logs.push(Buffer.from(chunk)),
  releaseOwner:async()=>{calls.released++;},
  ...rest,
 };
 if(customLoadSetup) adapter.loadSetup=async()=>{calls.loadSetup++;return customLoadSetup();};
 return {adapter,child,neighbor,calls,owner};
}
const runtimeRoot=()=>path.join(os.tmpdir(),"gsa-runtime-test-fixture");

test("missing saved setup yields SETUP_REQUIRED without prompting or starting a child",async()=>{
 const {adapter,calls}=makeAdapter({loadSetup:async()=>({state:"SETUP_REQUIRED",reason:"CONFIG_MISSING"})});
 const runtime=await startDesktopRuntime({runtimeRoot:runtimeRoot(),envPath:"/fixture/setup/.env",platformAdapter:adapter});
 assert.equal((await runtime.status()).state,"SETUP_REQUIRED");
 assert.equal(calls.spawn.length,0);
 assert.equal(calls.loadSetup,1);
});

test("child receives the saved key only in its explicit environment, never argv or status",async()=>{
 const {adapter,calls}=makeAdapter();
 const runtime=await startDesktopRuntime({runtimeRoot:runtimeRoot(),envPath:"/fixture/setup/.env",platformAdapter:adapter});
 const [{command,args,options}]=calls.spawn;
 assert.equal(command,"/fixture/runtime/bin/tunnel-client");
 assert.deepEqual(args,["run","--config",path.join(runtimeRoot(),"private-profile.yaml")]);
 assert.equal(options.env.CONTROL_PLANE_API_KEY,apiKey);
 assert.deepEqual(options.stdio,["ignore","pipe","pipe"]);
 assert.equal(Object.hasOwn(options.env,"NODE_OPTIONS"),false);
 assert.equal(JSON.stringify(args).includes(apiKey),false);
 assert.equal(JSON.stringify(await runtime.status()).includes(apiKey),false);
});

test("live process status stays separate from a disconnected control-plane state",async()=>{
 const {adapter}=makeAdapter({connectionStatus:async()=>"DISCONNECTED"});
 const runtime=await startDesktopRuntime({runtimeRoot:runtimeRoot(),envPath:"/fixture/setup/.env",platformAdapter:adapter});
 const status=await runtime.status();
 assert.equal(status.state,"RUNNING");
 assert.equal(status.connection,"DISCONNECTED");
 assert.equal(status.installationId,"install-00000000-0000-4000-8000-000000000001");
});

test("duplicate owner is refused before another tunnel child starts",async()=>{
 const {adapter,calls}=makeAdapter({acquireOwner:async()=>{throw Object.assign(Error("OWNER_ACTIVE"),{code:"OWNER_ACTIVE"});}});
 await assert.rejects(startDesktopRuntime({runtimeRoot:runtimeRoot(),envPath:"/fixture/setup/.env",platformAdapter:adapter}),{code:"OWNER_ACTIVE"});
 assert.equal(calls.spawn.length,0);
});

test("owned stop signals only its retained child and leaves a neighboring process alive",async()=>{
 const {adapter,child,neighbor,calls}=makeAdapter();
 const runtime=await startDesktopRuntime({runtimeRoot:runtimeRoot(),envPath:"/fixture/setup/.env",platformAdapter:adapter});
 const result=await runtime.stopOwned();
 assert.deepEqual(result,{stopped:true});
 assert.deepEqual(child.signals,["SIGTERM"]);
 assert.deepEqual(neighbor.signals,[]);
 assert.equal(calls.released,1);
});

test("unknown retained work refuses stop without signalling the child",async()=>{
 const {adapter,child,calls}=makeAdapter({ownedWorkState:async()=>"UNKNOWN"});
 const runtime=await startDesktopRuntime({runtimeRoot:runtimeRoot(),envPath:"/fixture/setup/.env",platformAdapter:adapter});
 const result=await runtime.stopOwned();
 assert.equal(result.stopped,false);
 assert.equal(result.reason,"ACTIVE_WORK_UNKNOWN");
 assert.deepEqual(child.signals,[]);
 assert.equal(calls.released,0);
});

test('unexpected successful tunnel exit is a startup failure with its numeric exit code',async()=>{
 const {adapter,child}=makeAdapter();
 const runtime=await startDesktopRuntime({runtimeRoot:runtimeRoot(),envPath:'/fixture/setup/.env',platformAdapter:adapter});
 child.exitCode=0;child.emit('close',0,null);
 const status=await runtime.status();
 assert.equal(status.state,'FAILED');assert.equal(status.reason,'CHILD_EXITED');assert.equal(status.childExitCode,0);
});

test("authentication rejection stops this child without retry or clearing setup",async()=>{
 const {adapter,child,calls}=makeAdapter({connectionStatus:async()=>"AUTH_REJECTED"});
 const runtime=await startDesktopRuntime({runtimeRoot:runtimeRoot(),envPath:"/fixture/setup/.env",platformAdapter:adapter});
 const status=await runtime.status();
 assert.equal(status.state,"SETUP_REQUIRED");
 assert.deepEqual(child.signals,["SIGTERM"]);
 assert.equal(calls.spawn.length,1);
 assert.equal(calls.loadSetup,1);
 assert.equal(JSON.stringify(status).includes(apiKey),false);
});

test("child output logging redacts the saved key and enforces the configured bound",async()=>{
 const {adapter,child,calls}=makeAdapter();
 await startDesktopRuntime({runtimeRoot:runtimeRoot(),envPath:"/fixture/setup/.env",platformAdapter:adapter});
 child.stderr.write(Buffer.from(`tunnel diagnostic ${apiKey}\n${"x".repeat(70*1024)}`));
 await new Promise(resolve=>setImmediate(resolve));
 const logged=Buffer.concat(calls.logs);
 assert.ok(logged.length<=64*1024);
 assert.equal(logged.includes(Buffer.from(apiKey)),false);
});

test("redacts a key split across output chunks",async()=>{
 const {adapter,child,calls}=makeAdapter();
 await startDesktopRuntime({runtimeRoot:runtimeRoot(),envPath:"/fixture/setup/.env",platformAdapter:adapter});
 const split=Math.floor(apiKey.length/2);
 child.stderr.write(Buffer.from(`prefix ${apiKey.slice(0,split)}`));
 child.stderr.write(Buffer.from(`${apiKey.slice(split)} suffix`));
 child.emit("close",0);
 await new Promise(resolve=>setImmediate(resolve));
 const logged=Buffer.concat(calls.logs);
 assert.equal(logged.includes(Buffer.from(apiKey)),false);
 assert.ok(logged.includes(Buffer.from("[REDACTED]")));
});

test("releases installation ownership when profile preparation fails",async()=>{
 const {adapter,calls}=makeAdapter({prepareProfile:async()=>{throw new Error("synthetic failure");}});
 await assert.rejects(startDesktopRuntime({runtimeRoot:runtimeRoot(),envPath:"/fixture/setup/.env",platformAdapter:adapter}),{code:"RUNTIME_START_FAILED"});
 assert.equal(calls.spawn.length,0);
 assert.equal(calls.released,1);
});

test("releases installation ownership when child creation fails",async()=>{
 const {adapter,calls}=makeAdapter({spawn:async()=>{throw new Error("synthetic failure");}});
 await assert.rejects(startDesktopRuntime({runtimeRoot:runtimeRoot(),envPath:"/fixture/setup/.env",platformAdapter:adapter}),{code:"RUNTIME_START_FAILED"});
 assert.equal(calls.spawn.length,0);
 assert.equal(calls.released,1);
});

test("releases installation ownership exactly once after confirmed child close",async()=>{
 const {adapter,child,calls}=makeAdapter();
 const runtime=await startDesktopRuntime({runtimeRoot:runtimeRoot(),envPath:"/fixture/setup/.env",platformAdapter:adapter});
 child.emit("close",0);
 assert.equal((await runtime.stopOwned()).stopped,true);
 assert.equal(calls.released,1);
});
