import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';

test('macOS native atomic rename broker compiles without running or installing it',{skip:process.platform!=='darwin',timeout:120000},async t=>{
 const temp=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'gsa-mac-rename-compile-'));
 await fs.chmod(temp,0o700);
 t.after(async()=>{await fs.rm(temp,{recursive:true,force:true});});
 const source=path.resolve('native/macos-files/broker.swift');
 const binary=path.join(temp,'candidate-broker');
 const sdk=execFileSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{encoding:'utf8',timeout:10000,maxBuffer:65536}).trim();
 assert.ok(path.isAbsolute(sdk));
 execFileSync('/usr/bin/xcrun',['--sdk','macosx','swiftc','-sdk',sdk,source,'-o',binary],{timeout:110000,maxBuffer:1024*1024});
 assert.equal((await fs.stat(binary)).isFile(),true);
 // Compiling is NOT a signed, sandboxed, native operation qualification.
});
