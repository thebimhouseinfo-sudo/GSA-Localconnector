import Foundation
import CryptoKit
import Darwin
import Security

// SOURCE CANDIDATE ONLY. Protocol gsa-file-recovery-v1: replace/trash/inspect.
// A separately verified signed App Sandbox installation must bind exactly one
// workspace and its private same-volume recovery root. This source is no proof
// of containment and is not connected to the production adapter or installer.
// No shell, move, cleanup, retention policy, automatic retry or mutation replay.
let limit = 8 * 1024 * 1024
struct Failure: Error { let code:String }
func check(_ condition:Bool,_ code:String)throws {if !condition {throw Failure(code:code)}}
func digest(_ bytes:Data)->String {SHA256.hash(data:bytes).map{String(format:"%02x",$0)}.joined()}
func validHash(_ value:String)->Bool {value.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil}
func validID(_ value:String)->Bool {value.range(of:"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$",options:.regularExpression) != nil}
func components(_ value:String)throws->[String] {
 let p=value.split(separator:"/",omittingEmptySubsequences:false).map(String.init)
 try check(value.utf8.count<=4096 && !p.isEmpty && !p.contains(where:{$0.isEmpty || $0=="." || $0==".." || $0.contains("\\") || $0.utf8.contains(0) || $0.lowercased()==".gsa-trash"}),"PATH_OUTSIDE_SCOPE")
 return p
}
func statFD(_ fd:Int32)throws->stat {var s=stat();try check(fstat(fd,&s)==0,"IO_UNCERTAIN");return s}
func identity(_ s:stat)->[String:String] {["device":String(s.st_dev),"inode":String(s.st_ino)]}
func sameInode(_ a:stat,_ b:stat)->Bool {a.st_dev==b.st_dev && a.st_ino==b.st_ino}
func stable(_ a:stat,_ b:stat)->Bool {
 sameInode(a,b) && a.st_size==b.st_size && a.st_nlink==b.st_nlink && a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec && a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec
}
struct Snapshot {let bytes:Data;let info:stat}
func readRegular(_ parent:Int32,_ name:String,_ cap:Int,_ privateFile:Bool=false)throws->Snapshot {
 let fd=openat(parent,name,O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);try check(fd>=0,"ENTRY_UNAVAILABLE");defer{close(fd)}
 let before=try statFD(fd)
 try check((before.st_mode&S_IFMT)==S_IFREG && before.st_nlink==1,"UNSAFE_FILE_TYPE")
 if privateFile {try check(before.st_uid==getuid() && before.st_mode&0o777==0o600,"UNSAFE_JOURNAL")}
 try check(before.st_size>=0 && before.st_size<=cap,"READ_LIMIT_EXCEEDED")
 var data=Data(),buffer=[UInt8](repeating:0,count:65536)
 while true {let n=Darwin.read(fd,&buffer,min(buffer.count,cap-data.count+1));try check(n>=0,"IO_UNCERTAIN");if n==0{break};data.append(contentsOf:buffer.prefix(n));try check(data.count<=cap,"READ_LIMIT_EXCEEDED")}
 var named=stat();try check(fstatat(parent,name,&named,AT_SYMLINK_NOFOLLOW)==0 && stable(before,try statFD(fd)) && sameInode(before,named),"ENTRY_CHANGED")
 return Snapshot(bytes:data,info:before)
}
func writeExclusive(_ parent:Int32,_ name:String,_ bytes:Data)throws {
 let fd=openat(parent,name,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0o600);try check(fd>=0,"IO_UNCERTAIN");defer{close(fd)}
 var offset=0
 while offset<bytes.count {let n=bytes.withUnsafeBytes{Darwin.write(fd,$0.baseAddress!.advanced(by:offset),bytes.count-offset)};try check(n>0,"IO_UNCERTAIN");offset+=n}
 try check(fsync(fd)==0 && fsync(parent)==0,"IO_UNCERTAIN")
}
func encode(_ value:[String:Any])throws->Data {let bytes=try JSONSerialization.data(withJSONObject:value,options:[.sortedKeys]);try check(bytes.count<=32768,"METADATA_LIMIT");return bytes}
func readJSON(_ parent:Int32,_ name:String)throws->[String:Any] {
 guard let result=try JSONSerialization.jsonObject(with:readRegular(parent,name,32768,true).bytes) as? [String:Any] else {throw Failure(code:"INVALID_JOURNAL")};return result
}
func openCanonicalDirectory(_ root:String,_ privateRoot:Bool=false)throws->(fd:Int32,ancestry:[stat]) {
 // Foundation rewrites /private/tmp to /tmp in a signed sandbox, even when
 // /private/tmp is the actual no-symlink grant. Validate spelling without URL
 // normalization; the nofollow walk below verifies every filesystem component.
 let chain=root.split(separator:"/",omittingEmptySubsequences:false)
 try check(root.hasPrefix("/") && root.utf8.count<=4096 && !root.utf8.contains(0) && chain.count>1 && !chain.dropFirst().contains(where:{$0.isEmpty || $0=="." || $0==".."}),"ROOT_UNVERIFIED")
 // Search-only ancestors avoid requesting directory contents outside the two
 // sandbox grants. The selected root itself needs a readable descriptor for I/O/fsync.
 var fd=open("/",O_SEARCH|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);try check(fd>=0,"ROOT_UNVERIFIED")
 do {
  var ancestry=[try statFD(fd)]
  let directories=chain.dropFirst()
  for (index,component) in directories.enumerated() {
   let access=index==directories.count-1 ? O_RDONLY : O_SEARCH
   let next=openat(fd,String(component),access|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(fd);fd=next;try check(fd>=0,"ROOT_UNVERIFIED")
   let info=try statFD(fd)
   ancestry.append(info)
   if privateRoot {try check((info.st_uid==0 || info.st_uid==getuid()) && (info.st_mode&0o022==0 || info.st_uid==0 && info.st_mode&0o1000 != 0),"UNSAFE_RECOVERY_ANCESTRY")}
  }
  if privateRoot {let s=try statFD(fd);try check(s.st_uid==getuid() && s.st_mode&0o777==0o700,"UNSAFE_RECOVERY_ROOT")}
  return(fd,ancestry)
 }catch {if fd>=0{close(fd)};throw error}
}
func requireDisjointRoots(_ workspace:stat,_ recovery:stat,_ workspaceAncestry:[stat],_ recoveryAncestry:[stat])throws {
 // Compare physical directory identities, including each root itself. Path
 // prefixes cannot detect case/normalization aliases on case-insensitive APFS.
 try check(!workspaceAncestry.contains(where:{sameInode($0,recovery)}) && !recoveryAncestry.contains(where:{sameInode($0,workspace)}),"RECOVERY_OVERLAPS_WORKSPACE")
}
func parent(_ root:Int32,_ relative:String)throws->(Int32,String) {
 let p=try components(relative);var fd=dup(root);try check(fd>=0,"IO_UNCERTAIN")
 do {for name in p.dropLast(){let next=openat(fd,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(fd);fd=next;try check(fd>=0,"PATH_OUTSIDE_SCOPE")};return(fd,p.last!)}catch{if fd>=0{close(fd)};throw error}
}
// Public Security.framework APIs inspect the running signature/entitlements.
// This is a runtime prerequisite, not independent evidence of syscall confinement.
func requireSignedSandbox(_ workspace:String,_ recovery:String)throws {
 var code:SecCode?;try check(SecCodeCopySelf(SecCSFlags(),&code)==errSecSuccess,"SIGNED_SANDBOX_REQUIRED")
 guard let running=code else {throw Failure(code:"SIGNED_SANDBOX_REQUIRED")}
 try check(SecCodeCheckValidity(running,SecCSFlags(),nil)==errSecSuccess,"SIGNED_SANDBOX_REQUIRED")
 var staticCode:SecStaticCode?
 try check(SecCodeCopyStaticCode(running,SecCSFlags(),&staticCode)==errSecSuccess,"SIGNED_SANDBOX_REQUIRED")
 guard let signed=staticCode else {throw Failure(code:"SIGNED_SANDBOX_REQUIRED")}
 var information:CFDictionary?
 try check(SecCodeCopySigningInformation(signed,SecCSFlags(rawValue:kSecCSSigningInformation),&information)==errSecSuccess,"SIGNED_SANDBOX_REQUIRED")
 guard let info=information as? [String:Any],let entitlements=info[kSecCodeInfoEntitlementsDict as String] as? [String:Any] else {throw Failure(code:"SIGNED_SANDBOX_REQUIRED")}
 // This candidate supports only the reviewed ad-hoc two-root profile. Even false
 // extra keys and production signing identifiers require separate policy review.
 let accepted:Set<String>=["com.apple.security.app-sandbox","com.apple.security.temporary-exception.files.absolute-path.read-write"]
 guard Set(entitlements.keys)==accepted,let grants=entitlements["com.apple.security.temporary-exception.files.absolute-path.read-write"] as? [String] else {throw Failure(code:"SIGNED_SANDBOX_REQUIRED")}
 try check(entitlements["com.apple.security.app-sandbox"] as? Bool==true && grants.count==2 && Set(grants)==Set([workspace+"/",recovery+"/"]),"SIGNED_SANDBOX_REQUIRED")
}
struct Binding {let root:String;let recovery:String;let id:String;let revision:Int;let workspace:stat;let retained:stat}
func boundRoots()throws->(Binding,Int32,Int32) {
 let info=Bundle.main.infoDictionary ?? [:]
 guard info["GSARecoveryProtocol"] as? String=="gsa-file-recovery-v1",let root=info["GSAWorkspaceRoot"] as? String,let recovery=info["GSARecoveryRoot"] as? String,let id=info["GSAWorkspaceID"] as? String,let revision=info["GSARevision"] as? Int,revision>0 else {throw Failure(code:"GRANT_BINDING_MISMATCH")}
 try requireSignedSandbox(root,recovery)
 try check(root != recovery && !recovery.hasPrefix(root+"/") && !root.hasPrefix(recovery+"/"),"RECOVERY_OVERLAPS_WORKSPACE")
 let openedWork=try openCanonicalDirectory(root),work=openedWork.fd
 do {
  let openedRecovery=try openCanonicalDirectory(recovery,true),retained=openedRecovery.fd
  do {
   let w=try statFD(work),r=try statFD(retained)
   try requireDisjointRoots(w,r,openedWork.ancestry,openedRecovery.ancestry)
   try check(String(w.st_dev)==info["GSADevice"] as? String && String(w.st_ino)==info["GSAInode"] as? String && String(r.st_dev)==info["GSARecoveryDevice"] as? String && String(r.st_ino)==info["GSARecoveryInode"] as? String && w.st_dev==r.st_dev,"ROOT_UNVERIFIED")
   return(Binding(root:root,recovery:recovery,id:id,revision:revision,workspace:w,retained:r),work,retained)
  }catch{close(retained);throw error}
 }catch{close(work);throw error}
}
func recheckRoots(_ b:Binding)throws {
 let work=try openCanonicalDirectory(b.root);defer{close(work.fd)}
 let recovery=try openCanonicalDirectory(b.recovery,true);defer{close(recovery.fd)}
 let w=try statFD(work.fd),r=try statFD(recovery.fd)
 try check(sameInode(w,b.workspace) && sameInode(r,b.retained),"ROOT_CHANGED")
 try requireDisjointRoots(w,r,work.ancestry,recovery.ancestry)
}
func exists(_ fd:Int32,_ name:String)throws->Bool {var s=stat();if fstatat(fd,name,&s,AT_SYMLINK_NOFOLLOW)==0{return true};try check(errno==ENOENT,"IO_UNCERTAIN");return false}
func renamedExclusively(_ from:Int32,_ name:String,_ to:Int32,_ destination:String)->Bool {renameatx_np(from,name,to,destination,UInt32(RENAME_EXCL))==0}
func outcome(_ id:String,_ status:String,_ intent:[String:Any],_ observations:[String:Any],_ retained:Bool,_ reason:String)->[String:Any] {
 ["ok":true,"protocol":"gsa-file-recovery-v1","transaction_id":id,"status":status,"intent":intent,"observations":observations,"retained_handles":retained ? [id] : [],"reason":reason]
}
func inspect(_ id:String,_ tx:Int32,_ b:Binding,_ work:Int32)throws->[String:Any] {
 let intent=try readJSON(tx,"intent.json")
 guard intent["protocol"] as? String=="gsa-file-recovery-v1",intent["transaction_id"] as? String==id,intent["workspace_id"] as? String==b.id,intent["revision"] as? Int==b.revision,let source=intent["path"] as? String,let operation=intent["operation"] as? String,["replace","trash"].contains(operation),let expected=intent["expected_sha256"] as? String,validHash(expected),let after=intent["after_sha256"] as? String,(operation=="trash" ? after.isEmpty : validHash(after)) else {throw Failure(code:"INVALID_JOURNAL")}
 let (fd,name)=try parent(work,source);defer{close(fd)}
 var observations:[String:Any]=[:],retained=false
 do {
  try recheckRoots(b)
  retained=try exists(tx,"captured")
  observations["captured"]=retained
  observations["source_absent"] = try !exists(fd,name)
  let captured=retained ? try readRegular(tx,"captured",limit) : nil
  if let c=captured {observations["capturedIdentity"]=identity(c.info);observations["captured_sha256"]=digest(c.bytes)}
  let final=try readJSON(tx,"final.json")
  try check(final["transaction_id"] as? String==id && final["operation"] as? String==operation,"INVALID_JOURNAL")
  guard let c=captured,let recorded=final["capturedIdentity"] as? [String:String],recorded==identity(c.info),digest(c.bytes)==expected else {return outcome(id,"UNKNOWN",intent,observations,retained,"CAPTURE_READBACK_CHANGED")}
  if operation=="trash" {
   try check(final["stage"] as? String=="CAPTURED","INVALID_JOURNAL")
   if observations["source_absent"] as? Bool != true {return outcome(id,"CONFLICT",intent,observations,retained,"SOURCE_RECREATED")}
  }else {
   let current=try readRegular(fd,name,limit)
   observations["publishedIdentity"]=identity(current.info);observations["destination_sha256"]=digest(current.bytes);observations["destination_present"]=true
   guard final["stage"] as? String=="PUBLISHED",let recordedNew=final["publishedIdentity"] as? [String:String],recordedNew==identity(current.info),digest(current.bytes)==after else {return outcome(id,"UNKNOWN",intent,observations,retained,"PUBLICATION_READBACK_CHANGED")}
   observations["published"]=true
  }
  try recheckRoots(b)
  return outcome(id,"APPLIED",intent,observations,retained,"VERIFIED_READBACK")
 }catch{return outcome(id,"UNKNOWN",intent,observations,retained,(error as? Failure)?.code ?? "IO_UNCERTAIN")}
}
func run(_ req:[String:Any])throws->[String:Any] {
 if fcntl(3,F_GETFD)>=0 {_ = fcntl(3,F_SETFD,FD_CLOEXEC)}
 guard req["protocol"] as? String=="gsa-file-recovery-v1",let operation=req["operation"] as? String,let id=req["transaction_id"] as? String,validID(id) else {throw Failure(code:"INVALID_REQUEST")}
 try check(["replace","trash","inspect"].contains(operation),"INVALID_OPERATION")
 let allowed:Set<String>=operation=="inspect" ? ["protocol","operation","transaction_id"] : operation=="replace" ? ["protocol","operation","transaction_id","workspace_id","revision","path","expected_sha256","base64"] : ["protocol","operation","transaction_id","workspace_id","revision","path","expected_sha256"]
 try check(Set(req.keys)==allowed,"INVALID_REQUEST")
 let (binding,work,recovery)=try boundRoots();defer{close(work);close(recovery)}
 if operation=="inspect" {
  let tx=openat(recovery,id,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);try check(tx>=0,"UNKNOWN_TRANSACTION");defer{close(tx)}
  let s=try statFD(tx);try check(s.st_uid==getuid() && s.st_mode&0o777==0o700 && s.st_dev==binding.retained.st_dev,"UNSAFE_JOURNAL")
  return try inspect(id,tx,binding,work)
 }
 guard req["workspace_id"] as? String==binding.id,req["revision"] as? Int==binding.revision,let source=req["path"] as? String,let expected=req["expected_sha256"] as? String,validHash(expected) else {throw Failure(code:"GRANT_BINDING_MISMATCH")}
 _ = try components(source)
 var replacement=Data()
 if operation=="replace" {guard let text=req["base64"] as? String,let bytes=Data(base64Encoded:text),bytes.count<=limit else {throw Failure(code:"INVALID_REQUEST")};replacement=bytes}
 let intent:[String:Any]=["protocol":"gsa-file-recovery-v1","transaction_id":id,"operation":operation,"workspace_id":binding.id,"revision":binding.revision,"path":source,"expected_sha256":expected,"after_sha256":operation=="replace" ? digest(replacement) : ""]
 let (fd,name)=try parent(work,source);defer{close(fd)}
 try recheckRoots(binding)
 // An existing transaction ID is never replayed, even if arguments match.
 try check(mkdirat(recovery,id,0o700)==0,"TRANSACTION_EXISTS_OR_DENIED")
 let tx=openat(recovery,id,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);try check(tx>=0,"IO_UNCERTAIN");defer{close(tx)}
 var observations:[String:Any]=[:],retained=false
 do {
  try check(fsync(recovery)==0,"IO_UNCERTAIN")
  try writeExclusive(tx,"intent.json",encode(intent))
  var stagedIdentity:stat?
  if operation=="replace" {
   try writeExclusive(tx,"staged",replacement)
   let staged=try readRegular(tx,"staged",limit,true)
   try check(digest(staged.bytes)==digest(replacement),"STAGING_READBACK_CHANGED")
   stagedIdentity=staged.info
  }
  let before=try readRegular(fd,name,limit)
  observations["source_sha256"]=digest(before.bytes)
  if digest(before.bytes) != expected {return outcome(id,"CONFLICT",intent,observations,false,"HASH_CONFLICT")}
  try writeExclusive(tx,"observed.json",encode(["sourceIdentity":identity(before.info),"sha256":expected]))
  try recheckRoots(binding)
  try check(renamedExclusively(fd,name,tx,"captured"),"CAPTURE_UNCERTAIN")
  retained=true;observations["captured"]=true
  try check(fsync(fd)==0 && fsync(tx)==0,"IO_UNCERTAIN")
  let captured:Snapshot
  do {captured=try readRegular(tx,"captured",limit)}catch{
   // Ambiguous read/identity/I/O failures preserve recovery untouched. Only a
   // positively observed unsafe entry is eligible for exclusive restoration.
   guard (error as? Failure)?.code=="UNSAFE_FILE_TYPE" else {throw error}
   try recheckRoots(binding)
   if renamedExclusively(tx,"captured",fd,name){retained=false;observations["restored_exclusively"]=true;try check(fsync(fd)==0 && fsync(tx)==0,"IO_UNCERTAIN")}
   return outcome(id,"CONFLICT",intent,observations,retained,"UNSAFE_CAPTURE_PRESERVED")
  }
  observations["capturedIdentity"]=identity(captured.info);observations["captured_sha256"]=digest(captured.bytes)
  if !sameInode(before.info,captured.info) || digest(captured.bytes) != expected {
   try recheckRoots(binding)
   if renamedExclusively(tx,"captured",fd,name){retained=false;observations["restored_exclusively"]=true;try check(fsync(fd)==0 && fsync(tx)==0,"IO_UNCERTAIN")}
   return outcome(id,"CONFLICT",intent,observations,retained,"CAPTURE_CONFLICT")
  }
  var final:[String:Any]=["transaction_id":id,"operation":operation,"capturedIdentity":identity(captured.info),"stage":"CAPTURED"]
  if operation=="replace" {
   try recheckRoots(binding)
   if !renamedExclusively(tx,"staged",fd,name){return outcome(id,"CONFLICT",intent,observations,true,"DESTINATION_PRESENT_OR_PUBLICATION_DENIED")}
   observations["published"]=true
   try check(fsync(fd)==0 && fsync(tx)==0,"IO_UNCERTAIN")
   let published=try readRegular(fd,name,limit)
   guard let staged=stagedIdentity else {throw Failure(code:"STAGING_UNVERIFIED")}
   try check(sameInode(staged,published.info) && digest(published.bytes)==digest(replacement),"PUBLICATION_READBACK_CHANGED")
   final["stage"]="PUBLISHED";final["publishedIdentity"]=identity(published.info)
  }
  try writeExclusive(tx,"final.json",encode(final))
  return try inspect(id,tx,binding,work)
 }catch{return outcome(id,"UNKNOWN",intent,observations,retained,(error as? Failure)?.code ?? "IO_UNCERTAIN")}
}
do {
 // Bound allocation as well as decoded content; stdin cannot grow without limit.
 var input=Data()
 while true {let chunk=FileHandle.standardInput.readData(ofLength:65536);if chunk.isEmpty{break};try check(input.count+chunk.count<=12*1024*1024,"INPUT_LIMIT_EXCEEDED");input.append(chunk)}
 guard let request=try JSONSerialization.jsonObject(with:input) as? [String:Any] else {throw Failure(code:"INVALID_REQUEST")}
 FileHandle.standardOutput.write(try encode(run(request)))
}catch {FileHandle.standardOutput.write((try? encode(["ok":false,"error":(error as? Failure)?.code ?? "IO_UNCERTAIN"])) ?? Data("{\"ok\":false,\"error\":\"IO_UNCERTAIN\"}".utf8))}
