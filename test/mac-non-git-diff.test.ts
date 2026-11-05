import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {diffCapturedMacText} from '../src/hosts/macos-scoped-files.js';

const bytes=(s:string)=>new TextEncoder().encode(s);
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');

test('non-Git diff uses explicit captured text baseline and reports a bounded line patch',()=>{
 const before=bytes('one\ntwo\nthree'),after=bytes('one\nchanged\nthree');
 const result=diffCapturedMacText(before,after);
 assert.deepEqual(result,{before_sha256:hash(before),after_sha256:hash(after),changed:true,patch:'@@ -2,1 +2,1 @@\n-two\n+changed\n'});
 assert.equal(Object.isFrozen(result),true);
});
test('non-Git diff preserves byte-identical baseline and returns no change',()=>{
 const content=bytes('same\n');
 const result=diffCapturedMacText(content,new Uint8Array(content));
 assert.equal(result.changed,false);assert.equal(result.patch,'');assert.equal(result.before_sha256,result.after_sha256);
});
test('non-Git diff rejects binary, invalid UTF-8 and unbounded content',()=>{
 assert.throws(()=>diffCapturedMacText(new Uint8Array([0]),bytes('ok')),/NON_TEXT_DIFF_UNSUPPORTED/);
 assert.throws(()=>diffCapturedMacText(new Uint8Array([0xff]),bytes('ok')),/NON_TEXT_DIFF_UNSUPPORTED/);
 assert.throws(()=>diffCapturedMacText(bytes('ok'),new Uint8Array(1_048_577)),/DIFF_LIMIT_EXCEEDED/);
});
