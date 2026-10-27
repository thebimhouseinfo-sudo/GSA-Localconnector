import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {enrollRolesTrustedBatch,loadTrustedRegistry,revokeTrusted,requirePersistedGrant} from '../src/local/grants.js';
import {authorizeMcpWorkspace} from '../src/mcp/runtime-bootstrap.js';
import {ControlLeaseStore} from '../src/local/control-lease.js';
import {withControlToken} from '../src/mcp/control-context.js';
import type {WorkspacePermission} from '../src/core/contracts.js';
const authorize=authorizeMcpWorkspace as (registry:Awaited<ReturnType<typeof loadTrustedRegistry>>,id:string,dir:string,permission?:WorkspacePermission)=>Promise<void>;
const persisted=requirePersistedGrant as (registry:Awaited<ReturnType<typeof loadTrustedRegistry>>,id:string,dir:string,permission?:WorkspacePermission)=>Promise<unknown>;
async function fixture(t:any){const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-file-auth-')));t.after(()=>fs.rm(temp,{recursive:true,force:true}));const reference=path.join(temp,'reference'),identity=path.join(temp,'identity');await fs.mkdir(reference,{mode:0o700});await enrollRolesTrustedBatch([{id:'reference',root:reference,role:'reference'}],identity);const registry=await loadTrustedRegistry(identity),controls=new ControlLeaseStore(identity);const token=(await controls.acquire()).control_token;return {registry,identity,controls,token};}
test('durable reference read is allowed without granting write or default execution',async t=>{const f=await fixture(t);await persisted(f.registry,'reference',f.identity,'read');await assert.rejects(persisted(f.registry,'reference',f.identity,'write'));await assert.rejects(persisted(f.registry,'reference',f.identity));assert.deepEqual(f.registry.get('reference')!.permissions,['read']);});
test('production authorization allows controlled reference read and rejects revocation',async t=>{const f=await fixture(t);await assert.rejects(authorize(f.registry,'reference',f.identity,'read'));await withControlToken(f.controls,f.token,()=>authorize(f.registry,'reference',f.identity,'read'));await revokeTrusted('reference',f.identity);await assert.rejects(withControlToken(f.controls,f.token,()=>authorize(f.registry,'reference',f.identity,'read')));});
