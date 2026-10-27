import {spawn,type ChildProcessWithoutNullStreams} from "node:child_process";
import {WorkspaceRegistry} from "./workspace.js";
import {validateWorkspaceRelative} from "./workspace-path.js";
import {ConnectorError,type WorkspaceGrant} from "./contracts.js";

// The child owns all descriptors until finish. No pathname is reopened for content.
// Postchecks withhold responses on observed relocation; this is not a host-command sandbox.
const reader=String.raw`
import os,sys,json,stat,base64,errno
nodes=[]
cache={}
root=None
MAX_FDS=1024
class Refusal(Exception): pass
def reject(code='SOURCE_UNVERIFIED'): raise Refusal(code)
def ident(s): return (s.st_dev,s.st_ino,stat.S_IFMT(s.st_mode))
def version(s): return (ident(s),s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_nlink)
def add(fd,parent,name):
    if len(nodes)>=MAX_FDS:
        os.close(fd);reject('READ_LIMIT_EXCEEDED')
    try: s=os.fstat(fd)
    except BaseException:
        os.close(fd);raise
    n={'fd':fd,'parent':parent,'name':name,'id':ident(s),'version':None}
    nodes.append(n)
    return n
def check():
    for n in nodes:
        s=os.fstat(n['fd'])
        if ident(s)!=n['id']: reject()
        if n['parent'] is not None:
            visible=os.stat(n['name'],dir_fd=n['parent']['fd'],follow_symlinks=False)
            if ident(visible)!=n['id']: reject()
        if n['version'] is not None and version(s)!=n['version']: reject()
def open_child(parent,name,directory=False):
    flags=os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC
    if directory: flags|=os.O_DIRECTORY
    fd=os.open(name,flags,dir_fd=parent['fd'])
    n=add(fd,parent,name)
    if directory and not stat.S_ISDIR(os.fstat(fd).st_mode): reject()
    return n
def target(relative):
    if relative=='.': return root
    current=root;prefix=''
    parts=relative.split('/')
    if any(not x or x in ('.','..') for x in parts): reject('PATH_OUTSIDE_SCOPE')
    for i,name in enumerate(parts):
        prefix=prefix+'/'+name
        if prefix not in cache: cache[prefix]=open_child(current,name,i<len(parts)-1)
        current=cache[prefix]
    return current
def metadata(s):
    return {'kind':'directory' if stat.S_ISDIR(s.st_mode) else 'file','size':s.st_size,'mtimeMs':s.st_mtime_ns/1000000}
def operation(q):
    global root
    action=q['action']
    if action=='init':
        if root is not None: reject()
        if not all(hasattr(os,k) for k in ('O_NOFOLLOW','O_NONBLOCK','O_DIRECTORY')): reject('SECURITY_BLOCKED')
        if os.open not in os.supports_dir_fd or os.stat not in os.supports_dir_fd: reject('SECURITY_BLOCKED')
        current=add(os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_CLOEXEC),None,None)
        absolute=q['root']
        if not absolute.startswith('/') or os.path.normpath(absolute)!=absolute: reject()
        for part in absolute.split('/')[1:]:
            if part: current=open_child(current,part,True)
        root=current
        s=os.fstat(root['fd'])
        if str(s.st_dev)!=q['device'] or str(s.st_ino)!=q['inode']: reject()
        check();return {}
    check()
    if action=='finish': return {}
    n=target(q['path']);check();s=os.fstat(n['fd'])
    if not (stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode)): reject()
    if stat.S_ISREG(s.st_mode) and s.st_nlink!=1: reject()
    before=version(s)
    result=metadata(s)
    if action=='list':
        if not stat.S_ISDIR(s.st_mode): reject('NOT_A_DIRECTORY')
        limit=q['limit'];entries=[];truncated=False
        # scandir(fd) uses the retained directory, never a /dev/fd pathname.
        os.lseek(n['fd'],0,os.SEEK_SET)
        with os.scandir(n['fd']) as scan:
            for entry in scan:
                if len(entries)>=limit: truncated=True;break
                # Refuse undecodable filesystem bytes rather than emitting JSON surrogates.
                entry.name.encode('utf-8',errors='strict')
                info=entry.stat(follow_symlinks=False)
                kind='directory' if stat.S_ISDIR(info.st_mode) else 'file' if stat.S_ISREG(info.st_mode) else 'other'
                entries.append({'name':entry.name,'kind':kind,'symlink':stat.S_ISLNK(info.st_mode)})
        result={'entries':entries,'truncated':truncated}
    elif action in ('read','info'):
        if action=='read' and not stat.S_ISREG(s.st_mode): reject('READ_LIMIT_EXCEEDED')
        limit=q['limit']
        if stat.S_ISREG(s.st_mode) and (action=='read' or s.st_size<=limit):
            if s.st_size>limit: reject('READ_LIMIT_EXCEEDED')
            os.lseek(n['fd'],0,os.SEEK_SET)
            data=bytearray()
            while len(data)<=limit:
                chunk=os.read(n['fd'],min(65536,limit+1-len(data)))
                if not chunk: break
                data.extend(chunk)
            if len(data)>limit: reject('READ_LIMIT_EXCEEDED')
            if len(data)!=s.st_size: reject()
            result['base64']=base64.b64encode(data).decode('ascii')
    else: reject()
    if version(os.fstat(n['fd']))!=before: reject()
    if n['version'] is not None and n['version']!=before: reject()
    n['version']=before
    check()
    return result
try:
    while True:
        line=sys.stdin.buffer.readline(65537)
        if not line: break
        if len(line)>65536: reject('READ_LIMIT_EXCEEDED')
        try:
            q=json.loads(line);result=operation(q)
            # One last chain check immediately before writing even private buffered bytes.
            check()
            print(json.dumps({'ok':True,'result':result},ensure_ascii=True),flush=True)
            if q['action']=='finish': break
        except Exception as e:
            code=str(e) if isinstance(e,Refusal) else 'ENOENT' if isinstance(e,FileNotFoundError) else 'SOURCE_UNVERIFIED'
            print(json.dumps({'ok':False,'code':code}),flush=True)
            if code not in ('ENOENT','READ_LIMIT_EXCEEDED','NOT_A_DIRECTORY'): break
finally:
    for n in reversed(nodes):
        try: os.close(n['fd'])
        except OSError: pass
`;
export interface WorkspaceReadEntry {name:string;kind:"directory"|"file"|"other";symlink:boolean}
interface ReadMetadata {kind:"directory"|"file";size:number;mtimeMs:number;base64?:string}
interface Reply {ok:boolean;code?:string;result?:unknown}
const fail=(code:string):Error=>Object.assign(new Error(code),{code});

/** A single tool invocation owns this session and must finish before emitting its result. */
export class WorkspaceReadSession {
 private readonly pin:WorkspaceGrant;
 private child:ChildProcessWithoutNullStreams|null=null;
 private ready:Promise<void>|null=null;
 private pending:{resolve:(reply:Reply)=>void;reject:(error:Error)=>void}|null=null;
 private timer:ReturnType<typeof setTimeout>|null=null;
 private buffer:Buffer=Buffer.alloc(0);
 private received=0;
 private closed=false;
 private terminal:Error|null=null;
 private exit:Promise<void>|null=null;
 private closure:{code:number|null;signal:NodeJS.Signals|null}|null=null;
 private cleanup:Promise<void>|null=null;
 constructor(private readonly registry:WorkspaceRegistry,private readonly id:string){this.pin=registry.requireGrant(id,"read");}
 private current():void {
  if(this.registry.requireGrant(this.id,"read")!==this.pin)throw new ConnectorError("SOURCE_UNVERIFIED","Workspace grant changed during read");
 }
 private stop(error:Error):void {
  this.terminal??=error;this.pending?.reject(this.terminal);this.pending=null;
  // Event handlers cannot await, but the invocation owner must await this same cleanup.
  void this.dispose().catch(()=>{});
 }
 private async awaitClose():Promise<void>{
  if(this.closure)return;
  if(!this.exit)throw fail("READ_CLEANUP_UNCONFIRMED");
  let deadline:ReturnType<typeof setTimeout>|undefined;
  try{
   await Promise.race([this.exit,new Promise<never>((_,reject)=>{
    deadline=setTimeout(()=>reject(fail("READ_CLEANUP_UNCONFIRMED")),1000);
   })]);
  }finally{if(deadline)clearTimeout(deadline);}
 }
 private async start():Promise<void>{
  if(this.ready)return this.ready;
  this.ready=(async()=>{
   if(this.closed)throw this.terminal??fail("SOURCE_UNVERIFIED");
   this.current();
   if(process.platform==="win32")throw fail("SECURITY_BLOCKED");
   const child=spawn("/usr/bin/python3",["-I","-u","-c",reader],{env:{PATH:"/usr/bin:/bin",LANG:"C",LC_ALL:"C"},stdio:["pipe","pipe","pipe"]});
   this.child=child;
   this.exit=new Promise<void>(resolve=>{
    child.once("error",()=>this.stop(fail("SECURITY_BLOCKED")));
    child.once("close",(code,signal)=>{
     this.closure={code,signal};
     if(this.timer)clearTimeout(this.timer);this.timer=null;
     resolve();
     if(this.pending||(!this.closed&&(code!==0||signal!==null)))this.stop(fail("SOURCE_UNVERIFIED"));
    });
   });
   child.stderr.on("data",()=>{});
   child.stdin.on("error",()=>this.stop(fail("SOURCE_UNVERIFIED")));
   child.stdout.on("data",(chunk:Buffer)=>{
    this.received+=chunk.length;
    if(this.received>32*1024*1024||this.buffer.length+chunk.length>12*1024*1024){this.stop(fail("READ_LIMIT_EXCEEDED"));return;}
    this.buffer=Buffer.concat([this.buffer,chunk]);
    const end=this.buffer.indexOf(10);
    if(end<0)return;
    if(!this.pending||end!==this.buffer.length-1){this.stop(fail("SOURCE_UNVERIFIED"));return;}
    const pending=this.pending;this.pending=null;
    try{const reply=JSON.parse(this.buffer.subarray(0,end).toString("utf8")) as Reply;this.buffer=Buffer.alloc(0);pending.resolve(reply);}catch{const error=fail("SOURCE_UNVERIFIED");pending.reject(error);this.stop(error);}
   });
   this.timer=setTimeout(()=>this.stop(fail("READ_LIMIT_EXCEEDED")),30000);
   await this.exchange({action:"init",root:this.pin.canonicalRoot,device:this.pin.rootIdentity.device,inode:this.pin.rootIdentity.inode});
   this.current();
  })();
  return this.ready;
 }
 private async exchange(request:Record<string,unknown>):Promise<unknown>{
  if(this.closed||this.closure||!this.child||this.terminal)throw this.terminal??fail("SOURCE_UNVERIFIED");
  if(this.pending)throw fail("SOURCE_UNVERIFIED");
  const reply=await new Promise<Reply>((resolve,reject)=>{
   this.pending={resolve,reject};
   try{this.child!.stdin.write(JSON.stringify(request)+"\n");}catch{this.stop(fail("SOURCE_UNVERIFIED"));}
  });
  if(this.terminal)throw this.terminal;
  this.current();
  if(reply.ok!==true)throw fail(reply.code??"SOURCE_UNVERIFIED");
  return reply.result;
 }
 private async request(action:string,relative:string,limit:number):Promise<unknown>{
  validateWorkspaceRelative(relative,true);
  if(!Number.isSafeInteger(limit)||limit<1||limit>8*1024*1024)throw fail("READ_LIMIT_EXCEEDED");
  await this.start();this.current();return this.exchange({action,path:relative,limit});
 }
 async read(relative:string,limit:number):Promise<Buffer>{
  const result=await this.request("read",relative,limit) as ReadMetadata;
  if(typeof result.base64!=="string")throw fail("SOURCE_UNVERIFIED");
  return Buffer.from(result.base64,"base64");
 }
 async info(relative:string):Promise<ReadMetadata>{return await this.request("info",relative,8*1024*1024) as ReadMetadata;}
 async list(relative:string,limit=500):Promise<{entries:WorkspaceReadEntry[];truncated:boolean}>{return await this.request("list",relative,limit) as {entries:WorkspaceReadEntry[];truncated:boolean};}
 async finish():Promise<void>{
  try{
   this.current();await this.start();await this.exchange({action:"finish"});
   this.child!.stdin.end();await this.awaitClose();
   if(this.terminal)throw this.terminal;
   if(this.closure?.code!==0||this.closure.signal!==null)throw fail("SOURCE_UNVERIFIED");
   this.current();this.closed=true;
  }catch(error){
   this.stop(error instanceof Error?error:fail("SOURCE_UNVERIFIED"));
   await this.dispose();throw error;
  }
 }
 dispose():Promise<void> {
  if(this.cleanup)return this.cleanup;
  this.closed=true;
  if(this.timer)clearTimeout(this.timer);this.timer=null;
  this.pending?.reject(this.terminal??fail("SOURCE_UNVERIFIED"));this.pending=null;
  this.buffer=Buffer.alloc(0);
  this.cleanup=Promise.resolve().then(async()=>{
   if(!this.child)return;
   // Only signal the exact child this session created; never infer ownership from a PID.
   if(!this.closure){try{this.child.kill("SIGKILL");}catch{/* Closure still needs confirmation. */}}
   await this.awaitClose();
  });
  return this.cleanup;
 }
}
