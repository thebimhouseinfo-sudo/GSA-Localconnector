import test from "node:test";
import assert from "node:assert/strict";
import {inspectPlatform} from "../scripts/desktop-platform-check.mjs";

const macTools=()=>({node:"22.0.0",swiftc:"6.2",python3:"3.13",iconutil:true,tunnelClient:true});
const readyMac=()=>inspectPlatform({platform:"darwin",arch:"arm64",tools:macTools(),clientHelp:"Usage: tunnel-client run --config <path>",nativeEvidence:null});

test("ready Mac preflight selects the config flag observed in client help",()=>{
 const result=readyMac();
 assert.deepEqual(result,{platform:"darwin",arch:"arm64",ready:true,missing:[],clientRunFlag:"--config"});
});

test("Mac preflight refuses an absent compiler without mutating its observation",()=>{
 const tools=macTools();delete tools.swiftc;
 const observations=Object.freeze({platform:"darwin",arch:"arm64",tools:Object.freeze(tools),clientHelp:"Usage: tunnel-client run --config <path>",nativeEvidence:null});
 const result=inspectPlatform(observations);
 assert.equal(result.ready,false);
 assert.ok(result.missing.includes("swiftc"));
 assert.equal("swiftc" in observations.tools,false);
});

test("Mac preflight rejects Node runtimes below the supported major version",()=>{
 const result=inspectPlatform({platform:"darwin",arch:"arm64",tools:{...macTools(),node:"18.19.0"},clientHelp:"Usage: tunnel-client run --config <path>",nativeEvidence:null});
 assert.equal(result.ready,false);
 assert.ok(result.missing.includes("node>=20"));
});

test("Mac preflight accepts only a tunnel flag present in observed help",()=>{
 const help="Usage: tunnel-client run --profile-file <path>";
 const result=inspectPlatform({platform:"darwin",arch:"arm64",tools:macTools(),clientHelp:help,nativeEvidence:null});
 assert.equal(result.clientRunFlag,"--profile-file");
 assert.equal(result.ready,true);
});

test("Mac preflight prefers --config when the observed client supports both profile flags",()=>{
 const result=inspectPlatform({platform:"darwin",arch:"arm64",tools:macTools(),clientHelp:"Usage: tunnel-client run --config <path> | --profile-file <path>",nativeEvidence:null});
 assert.equal(result.clientRunFlag,"--config");
 assert.equal(result.ready,true);
});

test("Mac preflight fails closed when tunnel help exposes no supported profile flag",()=>{
 const result=inspectPlatform({platform:"darwin",arch:"arm64",tools:macTools(),clientHelp:"Usage: tunnel-client run",nativeEvidence:null});
 assert.equal(result.clientRunFlag,null);
 assert.equal(result.ready,false);
 assert.ok(result.missing.includes("tunnel-client profile flag"));
});

test("Windows preflight stays unverified until actual adapter evidence is supplied",()=>{
 const result=inspectPlatform({platform:"win32",arch:"x64",tools:{node:"22.0.0",powershell:"7.5"},clientHelp:"Usage: tunnel-client run --config <path>",nativeEvidence:null});
 assert.equal(result.platform,"win32");
 assert.equal(result.ready,false);
 assert.ok(result.missing.includes("verified Windows adapter"));
});

test("Windows readiness needs an actual characterization report instead of a documentation guess",()=>{
 const reportPath="docs/reports/2026-10-22-desktop-platform-characterization.md";
 const result=inspectPlatform({platform:"win32",arch:"x64",tools:{node:"22.0.0",powershell:"7.5",csc:"4.8",winforms:true,tunnelClient:true},clientHelp:"Usage: tunnel-client run --config <path>",nativeEvidence:{adapterVerified:true,reportPath}});
 assert.equal(result.ready,true);
 assert.deepEqual(result.missing,[]);
});

test("Windows preflight refuses readiness when the required tunnel client is absent",()=>{
 const result=inspectPlatform({platform:"win32",arch:"x64",tools:{node:"22.0.0",powershell:"7.5",csc:"4.8",winforms:true},clientHelp:"Usage: tunnel-client run --config <path>",nativeEvidence:{adapterVerified:true,reportPath:"docs/reports/native-windows.md"}});
 assert.equal(result.ready,false);
 assert.ok(result.missing.includes("tunnelClient"));
});
