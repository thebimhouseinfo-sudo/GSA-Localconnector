import path from "node:path";
import fs from "node:fs/promises";
import {validateWorkspaceRelative} from "./workspace-path.js";
import { ConnectorError, type WorkspaceGrant, type WorkspacePermission, type WorkspaceRole, type WorkspaceRoleRequest } from "./contracts.js";

const validId=(id:unknown):id is string=>typeof id==="string"&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id);
const validRole=(role:unknown):role is WorkspaceRole=>role==="workspace"||role==="reference";
const rolePermissions=(role:WorkspaceRole):readonly WorkspacePermission[]=>role==="workspace"?["read","write","execute"]:["read"];
const sameIdentity=(a:WorkspaceGrant,b:WorkspaceGrant)=>a.rootIdentity.device===b.rootIdentity.device&&a.rootIdentity.inode===b.rootIdentity.inode;
const sameGrant=(a:WorkspaceGrant,b:WorkspaceGrant)=>a.id===b.id&&a.canonicalRoot===b.canonicalRoot&&sameIdentity(a,b)&&a.role===b.role&&
  new Set(a.permissions).size===new Set(b.permissions).size&&a.permissions.every(value=>b.permissions.includes(value));
const immutableGrant=(grant:WorkspaceGrant):WorkspaceGrant=>Object.freeze({...grant,rootIdentity:Object.freeze({...grant.rootIdentity}),permissions:Object.freeze([...grant.permissions])});

/** Use platform path rules; canonicalize EXISTING targets. Never treat this alone as a sandbox. */
export class WorkspaceRegistry {
  private readonly grants = new Map<string, WorkspaceGrant>();
  private readonly revisions = new Map<string, number>();
  private readonly explicitHistory = new Set<string>();
  private readonly pendingExplicit = new Map<string,Set<{cancelled:boolean}>>();
  private mutationGeneration = 0;
  constructor(private readonly pathApi: typeof path = path) {}

  private nextRevision(id:string):number {
    const revision=(this.revisions.get(id)??0)+1;
    if(!Number.isSafeInteger(revision))throw new ConnectorError("SOURCE_UNVERIFIED","Workspace revision exhausted");
    return revision;
  }
  private checkPreparedState(generation:number,prior:ReadonlyMap<string,readonly [WorkspaceGrant|undefined,number|undefined]>):void {
    if(generation===this.mutationGeneration)return;
    for(const [id,[grant,revision]] of prior)if(this.grants.get(id)!==grant||this.revisions.get(id)!==revision)
      throw new ConnectorError("SOURCE_UNVERIFIED","Workspace changed during enrollment; select it again");
  }
  private checkFinalSet(grants:ReadonlyMap<string,WorkspaceGrant>):void {
    const values=[...grants.values()];
    const authority=(grant:WorkspaceGrant)=>grant.role??(grant.permissions.some(value=>value==="write"||value==="execute")?"workspace":"reference");
    const contains=(parent:string,child:string)=>{
      const relative=this.pathApi.relative(parent,child);
      return relative===""||relative!==".."&&!relative.startsWith(".."+this.pathApi.sep)&&!this.pathApi.isAbsolute(relative);
    };
    for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++){
      const a=values[i]!,b=values[j]!;
      if(a.canonicalRoot===b.canonicalRoot||sameIdentity(a,b))throw new ConnectorError("PERMISSION_DENIED","Different workspace IDs cannot select the same directory");
      if(authority(a)!==authority(b)&&(contains(a.canonicalRoot,b.canonicalRoot)||contains(b.canonicalRoot,a.canonicalRoot)))
        throw new ConnectorError("PERMISSION_DENIED","Workspace and reference roots must not overlap");
    }
  }
  /** Atomic explicit selection. Metadata checks detect observed replacement, not filesystem TOCTOU confinement. */
  async enrollRolesTrusted(requests:readonly WorkspaceRoleRequest[]):Promise<readonly WorkspaceGrant[]> {
    if(!Array.isArray(requests)||requests.length<1||requests.length>16)throw new ConnectorError("SOURCE_UNVERIFIED","Select one through sixteen roots");
    const selections=Array.from(requests,request=>{
      if(!request||!validId(request.id)||!validRole(request.role))throw new ConnectorError("SOURCE_UNVERIFIED","Invalid workspace role selection");
      if(typeof request.root!=="string"||!this.pathApi.isAbsolute(request.root)||request.root.includes("\0"))throw new ConnectorError("PATH_OUTSIDE_SCOPE","Root must be an absolute directory path");
      return {id:request.id,root:request.root,role:request.role};
    });
    const pending={cancelled:false},pendingIds=new Set(selections.map(selection=>selection.id));
    for(const id of pendingIds){
      let entries=this.pendingExplicit.get(id);
      if(!entries){entries=new Set();this.pendingExplicit.set(id,entries);}
      entries.add(pending);
    }
    try {
    const generation=this.mutationGeneration;
    const prior=new Map(selections.map(({id})=>[id,[this.grants.get(id),this.revisions.get(id)] as const]));
    const prepared=new Map<string,WorkspaceGrant>();
    const observed:{root:string;grant:WorkspaceGrant}[]=[];
    for(const selection of selections){
      let canonicalRoot:string,rootStat;
      try {canonicalRoot=await fs.realpath(selection.root);rootStat=await fs.stat(canonicalRoot,{bigint:true});}
      catch {throw new ConnectorError("PATH_OUTSIDE_SCOPE","Root must be an existing directory");}
      if(!rootStat.isDirectory())throw new ConnectorError("PATH_OUTSIDE_SCOPE","Root must be a directory");
      const grant=immutableGrant({id:selection.id,role:selection.role,canonicalRoot,rootIdentity:{device:String(rootStat.dev),inode:String(rootStat.ino)},permissions:rolePermissions(selection.role),revision:1});
      const duplicate=prepared.get(grant.id);
      if(duplicate&&!sameGrant(duplicate,grant))throw new ConnectorError("PERMISSION_DENIED","Conflicting selections for one workspace ID");
      if(!duplicate)prepared.set(grant.id,grant);
      observed.push({root:selection.root,grant});
    }
    for(const {root,grant} of observed){
      try {
        const canonical=await fs.realpath(root),info=await fs.stat(canonical,{bigint:true});
        if(canonical!==grant.canonicalRoot||!info.isDirectory()||String(info.dev)!==grant.rootIdentity.device||String(info.ino)!==grant.rootIdentity.inode)
          throw new Error("changed");
      }catch {throw new ConnectorError("SOURCE_UNVERIFIED","Workspace root changed during selection");}
    }
    // All awaited work is finished: revalidate against the complete current set and publish synchronously.
    if(pending.cancelled)throw new ConnectorError("SOURCE_UNVERIFIED","Workspace selection was revoked during enrollment");
    this.checkPreparedState(generation,prior);
    const final=new Map(this.grants),result:WorkspaceGrant[]=[];
    for(const [id,grant] of prepared){
      const active=this.grants.get(id);
      const pinned=active&&sameGrant(active,grant)?active:immutableGrant({...grant,revision:this.nextRevision(id)});
      final.set(id,pinned);result.push(pinned);
    }
    this.checkFinalSet(final);
    for(const grant of result){this.grants.set(grant.id,grant);this.revisions.set(grant.id,grant.revision);this.explicitHistory.add(grant.id);}
    this.mutationGeneration++;
    return Object.freeze(result);
    } finally {
      for(const id of pendingIds){
        const entries=this.pendingExplicit.get(id);
        entries?.delete(pending);
        if(entries?.size===0)this.pendingExplicit.delete(id);
      }
    }
  }

  /** Trusted local enrollment only; never expose via an ordinary MCP tool. */
  async enrollTrusted(id: string, root: string, permissions: readonly WorkspacePermission[]): Promise<WorkspaceGrant> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) throw new ConnectorError("WORKSPACE_NOT_FOUND", "Invalid workspace ID");
    if (!this.pathApi.isAbsolute(root)) throw new ConnectorError("PATH_OUTSIDE_SCOPE", "Root must be absolute");
    const generation=this.mutationGeneration,prior=new Map([[id,[this.grants.get(id),this.revisions.get(id)] as const]]);
    const copiedPermissions=[...new Set(permissions)];
    const canonicalRoot = await fs.realpath(root);
    const rootStat=await fs.stat(canonicalRoot,{bigint:true});
    if(!rootStat.isDirectory())throw new ConnectorError("PATH_OUTSIDE_SCOPE","Workspace root must be a directory");
    const rootIdentity=Object.freeze({device:String(rootStat.dev),inode:String(rootStat.ino)});
    this.checkPreparedState(generation,prior);
    const revision=this.nextRevision(id);
    const grant: WorkspaceGrant = Object.freeze({ id, canonicalRoot, rootIdentity, permissions: Object.freeze(copiedPermissions), revision });
    if(this.explicitHistory.size){const final=new Map(this.grants);final.set(id,grant);this.checkFinalSet(final);}
    this.grants.set(id, grant);this.revisions.set(id,grant.revision);
    this.mutationGeneration++;
    return grant;
  }
  /** Import a durable pin without authorizing the directory currently at its path. */
  async importTrusted(grant:WorkspaceGrant):Promise<WorkspaceGrant>{
    if(!grant||!validId(grant.id)||typeof grant.canonicalRoot!=="string"||!this.pathApi.isAbsolute(grant.canonicalRoot)||
       !Number.isSafeInteger(grant.revision)||grant.revision<1||
       !grant.rootIdentity||!Array.isArray(grant.permissions)||
       ![grant.rootIdentity.device,grant.rootIdentity.inode].every(value=>typeof value==="string"&&/^(0|[1-9][0-9]{0,31})$/.test(value))||
       grant.permissions.some(value=>!["read","write","execute"].includes(value))||
       (grant.role!==undefined&&(!validRole(grant.role)||new Set(grant.permissions).size!==rolePermissions(grant.role).length||!rolePermissions(grant.role).every(value=>grant.permissions.includes(value)))))
      throw new ConnectorError("SOURCE_UNVERIFIED","Invalid persisted Workspace grant");
    grant=immutableGrant({id:grant.id,canonicalRoot:grant.canonicalRoot,rootIdentity:grant.rootIdentity,permissions:grant.permissions,revision:grant.revision,...(grant.role===undefined?{}:{role:grant.role})});
    const generation=this.mutationGeneration,prior=new Map([[grant.id,[this.grants.get(grant.id),this.revisions.get(grant.id)] as const]]);
    let canonical:string,info;
    try {canonical=await fs.realpath(grant.canonicalRoot);info=await fs.lstat(grant.canonicalRoot,{bigint:true});}
    catch {throw new ConnectorError("SOURCE_UNVERIFIED","Workspace root identity unavailable");}
    if(canonical!==grant.canonicalRoot||!info.isDirectory()||String(info.dev)!==grant.rootIdentity.device||String(info.ino)!==grant.rootIdentity.inode)
      throw new ConnectorError("SOURCE_UNVERIFIED","Workspace root identity changed");
    this.checkPreparedState(generation,prior);
    const revision=this.revisions.get(grant.id)??0,active=this.grants.get(grant.id);
    const explicit=this.explicitHistory.has(grant.id)||grant.role!==undefined;
    if(grant.revision<revision||explicit&&grant.revision===revision&&(!active||!sameGrant(active,grant)))throw new ConnectorError("SOURCE_UNVERIFIED","Workspace revision or authority changed");
    const final=new Map(this.grants);final.set(grant.id,grant);
    if(explicit||this.explicitHistory.size)this.checkFinalSet(final);
    this.grants.set(grant.id,grant);this.revisions.set(grant.id,grant.revision);
    if(grant.role!==undefined)this.explicitHistory.add(grant.id);
    this.mutationGeneration++;return grant;
  }
  list(): readonly WorkspaceGrant[] { return [...this.grants.values()]; }
  /** Apply complete durable active state to this object, preserving local revocation history. */
  async replaceTrustedSnapshot(grants:readonly WorkspaceGrant[]):Promise<readonly WorkspaceGrant[]> {
    if(!Array.isArray(grants)||grants.length>128)throw new ConnectorError("SOURCE_UNVERIFIED","Invalid complete workspace snapshot");
    const generation=this.mutationGeneration;
    // Copy every input before the first await; singleton imports share durable pin validation.
    const copied=Array.from(grants,grant=>{
      if(!grant||!grant.rootIdentity||!Array.isArray(grant.permissions))throw new ConnectorError("SOURCE_UNVERIFIED","Invalid snapshot grant");
      return immutableGrant(grant);
    });
    const prospective=new Map<string,WorkspaceGrant>();
    for(const grant of copied){
      const pinned=await new WorkspaceRegistry(this.pathApi).importTrusted(grant);
      const duplicate=prospective.get(pinned.id);
      if(duplicate&&(!sameGrant(duplicate,pinned)||duplicate.revision!==pinned.revision))throw new ConnectorError("SOURCE_UNVERIFIED","Conflicting snapshot IDs");
      if(!duplicate)prospective.set(pinned.id,pinned);
    }
    if(generation!==this.mutationGeneration)throw new ConnectorError("SOURCE_UNVERIFIED","Workspace state changed during snapshot preparation");
    for(const grant of prospective.values()){
      const revision=this.revisions.get(grant.id)??0,active=this.grants.get(grant.id);
      if(grant.revision<revision||(this.explicitHistory.has(grant.id)||grant.role!==undefined)&&grant.revision===revision&&(!active||!sameGrant(active,grant)))
        throw new ConnectorError("SOURCE_UNVERIFIED","Snapshot revision or authority changed");
    }
    if(this.explicitHistory.size||[...prospective.values()].some(grant=>grant.role!==undefined))this.checkFinalSet(prospective);
    const removed=[...this.grants.keys()].filter(id=>!prospective.has(id)).map(id=>({id,revision:this.nextRevision(id)}));
    // No awaits or fallible preparation after this point.
    for(const {id,revision} of removed){
      this.grants.delete(id);this.revisions.set(id,revision);
      for(const pending of this.pendingExplicit.get(id)??[])pending.cancelled=true;
    }
    for(const grant of prospective.values()){
      this.grants.set(grant.id,grant);this.revisions.set(grant.id,grant.revision);
      if(grant.role!==undefined)this.explicitHistory.add(grant.id);
    }
    // Publish incoming order, including roots replacing IDs removed from the prior active set.
    this.grants.clear();for(const [id,grant] of prospective)this.grants.set(id,grant);
    this.mutationGeneration++;
    return Object.freeze([...prospective.values()]);
  }
  get(id: string): WorkspaceGrant | undefined { return this.grants.get(id); }
  revoke(id: string): void {
    if(this.grants.has(id))this.revisions.set(id,this.nextRevision(id));
    for(const pending of this.pendingExplicit.get(id)??[])pending.cancelled=true;
    this.grants.delete(id);
    this.mutationGeneration++;
  }
  requireGrant(id: string, permission: WorkspacePermission): WorkspaceGrant {
    const grant = this.grants.get(id);
    if (!grant) throw new ConnectorError("WORKSPACE_NOT_FOUND", "Unknown workspace");
    if (!grant.permissions.includes(permission)) throw new ConnectorError("PERMISSION_DENIED", "Permission not granted");
    return grant;
  }
  /** Read-only bootstrap resolver; writes/CI need handle-relative protection and native isolation. */
  async resolveExistingRead(id: string, relative: string): Promise<string> {
    const grant = this.requireGrant(id, "read");
    validateWorkspaceRelative(relative,true);
    const currentRoot=await fs.stat(grant.canonicalRoot,{bigint:true});
    if(String(currentRoot.dev)!==grant.rootIdentity.device||String(currentRoot.ino)!==grant.rootIdentity.inode)
      throw new ConnectorError("SOURCE_UNVERIFIED","Workspace root identity changed");
    if(relative===".")return grant.canonicalRoot;
    const candidate = await fs.realpath(this.pathApi.join(grant.canonicalRoot, relative));
    const rel = this.pathApi.relative(grant.canonicalRoot, candidate);
    if (rel === ".." || rel.startsWith(".." + this.pathApi.sep) || this.pathApi.isAbsolute(rel))
      throw new ConnectorError("PATH_OUTSIDE_SCOPE", "Canonical path escapes workspace");
    return candidate;
  }
}
