import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {enrollRolesTrustedBatch,grantPath,loadTrustedRegistry} from '../src/local/grants.js';
import {loadStartupRegistry} from '../src/mcp/startup-registry.js';
import {bootstrapMcpTools} from '../src/mcp/runtime-bootstrap.js';

async function fixture(t:test.TestContext){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-startup-registry-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const identity=path.join(root,'identity'),workspace=path.join(root,'workspace');
 await fs.mkdir(workspace,{mode:0o700});
 await enrollRolesTrustedBatch([{id:'fixture',root:workspace,role:'workspace'}],identity);
 return {root,identity,workspace};
}
test('valid startup registry preserves the explicitly enrolled authority',{skip:process.platform!=='darwin'},async t=>{
 const {identity}=await fixture(t),loaded=await loadStartupRegistry(identity);
 assert.equal(loaded.workspaceStartupIssue,undefined);assert.equal(loaded.registry.requireGrant('fixture','write').role,'workspace');
});
test('changed root keeps transport bootstrap possible with zero workspace authority and unchanged pins',{skip:process.platform!=='darwin'},async t=>{
 const {root,identity,workspace}=await fixture(t),before=await fs.readFile(grantPath(identity));
 await fs.rename(workspace,path.join(root,'old-root'));await fs.mkdir(workspace,{mode:0o700});
 await assert.rejects(loadTrustedRegistry(identity),/Workspace root identity changed/);
 const loaded=await loadStartupRegistry(identity);
 assert.equal(loaded.workspaceStartupIssue,'WORKSPACE_ROOT_CHANGED');assert.deepEqual(loaded.registry.list(),[]);
 assert.throws(()=>loaded.registry.requireGrant('fixture','read'));assert.throws(()=>loaded.registry.requireGrant('fixture','write'));
 assert.deepEqual(await fs.readFile(grantPath(identity)),before);
 const {invoke}=await bootstrapMcpTools(loaded.registry,identity,undefined,undefined,loaded.workspaceStartupIssue);
 const status=JSON.parse((await invoke({name:'connector_status',arguments:{}})).content[0].text);
 assert.equal(status.ok,true);assert.equal(status.result.workspaceStartupIssue,'WORKSPACE_ROOT_CHANGED');
 assert.equal(status.result.workspaceSelectionRequired,true);assert.deepEqual(loaded.registry.list(),[]);
});
test('unsafe store permissions never become a recoverable workspace-selection issue',{skip:process.platform!=='darwin'},async t=>{
 const {identity}=await fixture(t);await fs.chmod(grantPath(identity),0o644);
 await assert.rejects(loadStartupRegistry(identity),/UNSAFE_GRANT_STORE/);
});
test('missing root degrades without modifying persisted selection; malformed stores still refuse',{skip:process.platform!=='darwin'},async t=>{
 const {identity,workspace}=await fixture(t),before=await fs.readFile(grantPath(identity));
 await fs.rmdir(workspace);
 const loaded=await loadStartupRegistry(identity);assert.equal(loaded.workspaceStartupIssue,'WORKSPACE_ROOT_UNAVAILABLE');
 assert.deepEqual(loaded.registry.list(),[]);assert.deepEqual(await fs.readFile(grantPath(identity)),before);
 await fs.writeFile(grantPath(identity),'invalid JSON');
 await assert.rejects(loadStartupRegistry(identity));
});
