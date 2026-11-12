import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {WorkspaceRegistry} from '../src/core/workspace.js';
import {enrollReadOnly,enrollRolesTrustedBatch,loadTrustedRegistry} from '../src/local/grants.js';
import {createReadOnlyTools} from '../src/mcp/server.js';
import {testIdentityRoot} from './helpers/identity-root.js';
test('persistent enrollment rejects identity ancestors, descendants and aliases atomically',{skip:process.platform==='win32'},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-r3-private-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const identity=path.join(root,'identity'),nested=path.join(identity,'nested'),project=path.join(root,'project'),alias=path.join(root,'alias');
 await fs.mkdir(nested,{recursive:true,mode:0o700});await fs.chmod(identity,0o700);await fs.mkdir(project);await fs.symlink(identity,alias);
 for(const selected of [identity,nested,root,alias,'/']){
  await assert.rejects(enrollReadOnly('bad',selected,identity),/private|reserved|scope|denied/i);
  await assert.rejects(enrollRolesTrustedBatch([{id:'bad',root:selected,role:'reference'}],identity),/private|reserved|scope|denied/i);
 }
 assert.equal(await fs.stat(path.join(identity,'trusted-workspaces.json')).then(()=>true,()=>false),false);
 await enrollReadOnly('good',project,identity);assert.equal((await loadTrustedRegistry(identity)).list().length,1);
 const invoke=createReadOnlyTools(new WorkspaceRegistry(),null,null,null,null,null,null,null,null,null,null,{identityRoot:testIdentityRoot(),grantDirectory:identity});
 const response=JSON.parse((await invoke({name:'bind_workspaces',arguments:{roots:[{path:identity,role:'reference'}]}})).content[0].text);
 assert.equal(response.ok,false);assert.equal((await loadTrustedRegistry(identity)).list().length,1);
});
test('direct registry enrollment refuses HOME and the default connector identity root',{skip:process.platform==='win32'},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-r3-home-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 t.mock.method(os,'homedir',()=>root);
 const identity=path.join(root,'Library','Application Support','GSA-Localconnector');await fs.mkdir(identity,{recursive:true,mode:0o700});
 for(const selected of [root,identity,'/'])await assert.rejects(new WorkspaceRegistry().enrollTrusted('bad',selected,['read']),/private|reserved|scope|denied/i);
 const project=path.join(root,'project');await fs.mkdir(project);
 assert.equal((await new WorkspaceRegistry().enrollTrusted('good',project,['read'])).id,'good');
});
