import Foundation
import CryptoKit
import Darwin
import Security

// Separate read-only tree capture helper. Compilation does not certify native confinement.
// Capture describes observed bytes and structure, never an atomic global tree snapshot.
struct Failure: Error { let code: String }
func fail(_ code:String) throws -> Never { throw Failure(code:code) }
func check(_ condition:Bool,_ code:String) throws { if !condition { try fail(code) } }
func hash(_ bytes:Data)->String { SHA256.hash(data:bytes).map{String(format:"%02x",$0)}.joined() }
func parts(_ path:String)throws->[String] {
 let p=path.split(separator:"/",omittingEmptySubsequences:false).map(String.init)
 try check(path.utf8.count<=4096 && !p.isEmpty && !p.contains(where:{$0.isEmpty || $0=="." || $0==".." || $0.utf8.contains(0) || $0.contains("\\") || $0.lowercased()==".gsa-trash"}),"PATH_OUTSIDE_SCOPE")
 return p
}
func statFD(_ fd:Int32)throws->stat {var s=stat();try check(fstat(fd,&s)==0,"IO_ERROR");return s}
func same(_ a:stat,_ b:stat)->Bool {a.st_dev==b.st_dev && a.st_ino==b.st_ino && a.st_size==b.st_size && a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec && a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec && a.st_nlink==b.st_nlink}
func openCanonicalRoot(_ root:String)throws->Int32 {
 let chain=root.split(separator:"/",omittingEmptySubsequences:false)
 try check(root.hasPrefix("/") && root.utf8.count<=4096 && !root.utf8.contains(0) && chain.count>1 && !chain.dropFirst().contains(where:{$0.isEmpty || $0=="." || $0==".."}),"ROOT_UNVERIFIED")
 // Search-only ancestors need no read grant outside the selected root.
 var fd=open("/",O_SEARCH|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);try check(fd>=0,"ROOT_UNVERIFIED")
 do {
  let directories=chain.dropFirst()
  for (index,component) in directories.enumerated() {
   let access=index==directories.count-1 ? O_RDONLY : O_SEARCH
   let next=openat(fd,String(component),access|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(fd);fd=next;try check(fd>=0,"ROOT_UNVERIFIED")
  }
  return fd
 }catch{if fd>=0{close(fd)};throw error}
}
func requireSignedSandbox(_ root:String,_ role:String)throws {
 var code:SecCode?;try check(SecCodeCopySelf(SecCSFlags(),&code)==errSecSuccess,"SIGNED_SANDBOX_REQUIRED")
 guard let running=code else{try fail("SIGNED_SANDBOX_REQUIRED")}
 try check(SecCodeCheckValidity(running,SecCSFlags(),nil)==errSecSuccess,"SIGNED_SANDBOX_REQUIRED")
 var staticCode:SecStaticCode?;try check(SecCodeCopyStaticCode(running,SecCSFlags(),&staticCode)==errSecSuccess,"SIGNED_SANDBOX_REQUIRED")
 guard let signed=staticCode else{try fail("SIGNED_SANDBOX_REQUIRED")}
 var information:CFDictionary?;try check(SecCodeCopySigningInformation(signed,SecCSFlags(rawValue:kSecCSSigningInformation),&information)==errSecSuccess,"SIGNED_SANDBOX_REQUIRED")
 guard let signing=information as? [String:Any],let entitlements=signing[kSecCodeInfoEntitlementsDict as String] as? [String:Any] else{try fail("SIGNED_SANDBOX_REQUIRED")}
 let sandbox="com.apple.security.app-sandbox",right="com.apple.security.temporary-exception.files.absolute-path.read-only"
 try check(Set(entitlements.keys)==Set([sandbox,right]) && entitlements[sandbox] as? Bool==true,"SIGNED_SANDBOX_REQUIRED")
 guard let grants=entitlements[right] as? [String] else{try fail("SIGNED_SANDBOX_REQUIRED")}
 try check(grants.count==1 && grants[0].utf8.elementsEqual((root+"/").utf8),"SIGNED_SANDBOX_REQUIRED")
}
let byteLimit=8*1024*1024,entryLimit=1024,manifestLimit=512*1024,responseLimit=12*1024*1024
let deadline=ProcessInfo.processInfo.systemUptime+15
func timely()throws {try check(ProcessInfo.processInfo.systemUptime<=deadline,"CAPTURE_TIMEOUT")}
func json(_ value:Any)throws->Data {try JSONSerialization.data(withJSONObject:value,options:[.withoutEscapingSlashes])}
func decimalNanoseconds(_ time:timespec)throws->String {
 let (seconds,overflow)=Int64(time.tv_sec).multipliedReportingOverflow(by:1_000_000_000)
 let (value,additionOverflow)=seconds.addingReportingOverflow(Int64(time.tv_nsec))
 try check(!overflow && !additionOverflow && value>=0,"UNSUPPORTED_STAT");return String(value)
}
func observation(_ path:String,_ kind:String,_ value:stat)throws->[String:Any] {
 try check(value.st_size>=0 && value.st_size<=9_007_199_254_740_991,"UNSUPPORTED_STAT")
 return ["path":path,"kind":kind,"device":String(value.st_dev),"inode":String(value.st_ino),"size":Int(value.st_size),"mtime_ns":try decimalNanoseconds(value.st_mtimespec),"ctime_ns":try decimalNanoseconds(value.st_ctimespec)]
}
func duplicate(_ fd:Int32)throws->Int32 {let result=fcntl(fd,F_DUPFD_CLOEXEC,4);try check(result>=0,"IO_ERROR");return result}
func utf8Less(_ a:String,_ b:String)->Bool {a.utf8.lexicographicallyPrecedes(b.utf8)}
struct Child {let name:String;let identity:stat}
func enumerate(_ fd:Int32,_ device:dev_t)throws->[Child] {
 let owned=try duplicate(fd)
 guard let stream=fdopendir(owned) else {close(owned);try fail("IO_ERROR")}
 defer{closedir(stream)}
 // dup shares the directory offset; every bounded enumeration starts at its beginning.
 rewinddir(stream)
 var children=[Child]()
 while true {
  try timely();errno=0
  guard let entry=readdir(stream) else {try check(errno==0,"IO_ERROR");break}
  let nameBytes=withUnsafeBytes(of:&entry.pointee.d_name){raw->[UInt8] in Array(raw.prefix(while:{$0 != 0}))}
  guard let name=String(bytes:nameBytes,encoding:.utf8),Array(name.utf8)==nameBytes else {try fail("UNSUPPORTED_NAME")}
  if name=="." || name==".." {continue}
  _ = try parts(name)
  try check(!name.contains("/"),"UNSUPPORTED_NAME")
  var identity=stat();try check(fstatat(fd,name,&identity,AT_SYMLINK_NOFOLLOW)==0,"CONCURRENT_CHANGE")
  try check(identity.st_dev==device,"DEVICE_BOUNDARY")
  let kind=identity.st_mode&S_IFMT
  try check(kind==S_IFDIR || (kind==S_IFREG && identity.st_nlink==1),"UNSAFE_FILE_TYPE")
  children.append(Child(name:name,identity:identity));try check(children.count<entryLimit,"ENTRY_LIMIT_EXCEEDED")
 }
 children.sort{utf8Less($0.name,$1.name)}
 for index in children.indices.dropFirst(){try check(!children[index-1].name.utf8.elementsEqual(children[index].name.utf8),"CONCURRENT_CHANGE")}
 return children
}
// Exact JSON.stringify string encoding for the portable digest, including slash,
// control characters and U+2028/U+2029. Wire object key order is irrelevant.
func quote(_ value:String)->String {
 var output="\""
 for scalar in value.unicodeScalars {
  switch scalar.value {
  case 0x22:output += "\\\""
  case 0x5c:output += "\\\\"
  case 8:output += "\\b"
  case 9:output += "\\t"
  case 10:output += "\\n"
  case 12:output += "\\f"
  case 13:output += "\\r"
  case 0...31:output += String(format:"\\u%04x",scalar.value)
  default:output.unicodeScalars.append(scalar)
  }
 }
 return output+"\""
}
struct CapturedEntry {let path:String;let entry:[String:Any];let tuple:String;let observation:[String:Any];let base64:String?}
final class Capture {
 var entries=[CapturedEntry](),total=0,canonicalBytes=0
 let device:dev_t
 init(_ device:dev_t){self.device=device}
 func append(_ path:String,_ kind:String,_ identity:stat,_ bytes:Data?=nil)throws {
  try timely();try check(entries.count<entryLimit,"ENTRY_LIMIT_EXCEEDED")
  let tuple:String,entry:[String:Any]
  if let bytes=bytes {
   try check(bytes.count<=byteLimit && total<=byteLimit-bytes.count,"BYTE_LIMIT_EXCEEDED");total+=bytes.count
   let digest=hash(bytes);tuple="["+quote(path)+",\"file\","+String(bytes.count)+","+quote(digest)+"]";entry=["path":path,"kind":kind,"size":bytes.count,"sha256":digest]
  }else{tuple="["+quote(path)+",\"directory\"]";entry=["path":path,"kind":kind]}
  // The exact final encoding is checked again after canonical ordering.
  canonicalBytes += tuple.utf8.count+1
  try check(canonicalBytes<=manifestLimit,"MANIFEST_LIMIT_EXCEEDED")
  entries.append(CapturedEntry(path:path,entry:entry,tuple:tuple,observation:try observation(path,kind,identity),base64:bytes?.base64EncodedString()))
 }
 func file(_ parent:Int32,_ child:Child,_ path:String)throws {
  let fd=openat(parent,child.name,O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC)
  try check(fd>=0,"CONCURRENT_CHANGE");defer{close(fd)}
  let before=try statFD(fd)
  try check(same(before,child.identity) && before.st_mode==child.identity.st_mode,"CONCURRENT_CHANGE")
  try check(before.st_dev==device && (before.st_mode&S_IFMT)==S_IFREG && before.st_nlink==1,"UNSAFE_FILE_TYPE")
  try check(before.st_size>=0 && before.st_size<=byteLimit-total,"BYTE_LIMIT_EXCEEDED")
  var bytes=Data(),buffer=[UInt8](repeating:0,count:65536)
  while true {
   try timely()
   let n=Darwin.read(fd,&buffer,min(buffer.count,byteLimit-total-bytes.count+1))
   if n<0 && errno==EINTR{continue};try check(n>=0,"IO_ERROR");if n==0{break}
   try check(n<=byteLimit-total-bytes.count,"BYTE_LIMIT_EXCEEDED");bytes.append(contentsOf:buffer.prefix(n))
  }
  try check(bytes.count==before.st_size && same(before,try statFD(fd)),"CONCURRENT_CHANGE")
  try append(path,"file",before,bytes)
 }
 func directory(_ fd:Int32,_ path:String,_ depth:Int,_ expected:stat?)throws {
  try timely();try check(depth<=16,"DEPTH_LIMIT_EXCEEDED")
  let before=try statFD(fd)
  try check(before.st_dev==device && (before.st_mode&S_IFMT)==S_IFDIR,"UNSAFE_DIRECTORY")
  if let expected=expected{try check(same(before,expected) && before.st_mode==expected.st_mode,"CONCURRENT_CHANGE")}
  try append(path,"directory",before)
  let initial=try enumerate(fd,device)
  for child in initial {
   let childPath=path.isEmpty ? child.name : path+"/"+child.name
   _ = try parts(childPath);try check(depth+1<=16,"DEPTH_LIMIT_EXCEEDED")
   if (child.identity.st_mode&S_IFMT)==S_IFDIR {
    let next=openat(fd,child.name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC)
    try check(next>=0,"CONCURRENT_CHANGE")
    do{defer{close(next)};try directory(next,childPath,depth+1,child.identity)}
   }else{try file(fd,child,childPath)}
  }
  let final=try enumerate(fd,device)
  try check(initial.count==final.count,"CONCURRENT_CHANGE")
  for (a,b) in zip(initial,final){try check(a.name.utf8.elementsEqual(b.name.utf8) && same(a.identity,b.identity) && a.identity.st_mode==b.identity.st_mode,"CONCURRENT_CHANGE")}
  try check(same(before,try statFD(fd)),"CONCURRENT_CHANGE")
 }
 func payload()throws->[String:Any] {
  entries.sort{utf8Less($0.path,$1.path)}
  let canonical=Data(("[\"gsa-directory-manifest-v1\",["+entries.map{$0.tuple}.joined(separator:",")+"]]").utf8)
  try check(canonical.count<=manifestLimit,"MANIFEST_LIMIT_EXCEEDED")
  return ["manifest":["format":"gsa-directory-manifest-v1","entries":entries.map{$0.entry},"total_bytes":total,"sha256":hash(canonical)],"files":entries.compactMap{entry->[String:Any]? in guard let base64=entry.base64 else{return nil};return ["path":entry.path,"base64":base64]},"observations":entries.map{$0.observation}]
 }
}
func boundedInput()throws->Data {
 var data=Data(),buffer=[UInt8](repeating:0,count:16384)
 while true {
  try timely();let n=Darwin.read(STDIN_FILENO,&buffer,min(buffer.count,65536-data.count+1))
  if n<0 && errno==EINTR{continue};try check(n>=0,"IO_ERROR");if n==0{return data}
  try check(data.count+n<=65536,"INPUT_LIMIT_EXCEEDED");data.append(contentsOf:buffer.prefix(n))
 }
}
func run(_ req:[String:Any])throws->[String:Any] {
 if fcntl(3,F_GETFD)>=0{try check(fcntl(3,F_SETFD,FD_CLOEXEC)==0,"IO_ERROR")}
 try check(Set(req.keys)==Set(["operation","workspace_id","role","root","device","inode","revision","path"]),"INVALID_REQUEST")
 guard req["operation"] as? String=="capture_tree",let id=req["workspace_id"] as? String,let role=req["role"] as? String,["workspace","reference"].contains(role),let root=req["root"] as? String,let device=req["device"] as? String,let inode=req["inode"] as? String,let revision=req["revision"] as? NSNumber,CFGetTypeID(revision) != CFBooleanGetTypeID(),revision.doubleValue.rounded()==revision.doubleValue,revision.doubleValue>0,revision.doubleValue<=9_007_199_254_740_991,let path=req["path"] as? String else{try fail("INVALID_REQUEST")}
 try check(id.range(of:"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$",options:.regularExpression) != nil && device.range(of:"^(0|[1-9][0-9]{0,31})$",options:.regularExpression) != nil && inode.range(of:"^(0|[1-9][0-9]{0,31})$",options:.regularExpression) != nil,"INVALID_REQUEST")
 let info=Bundle.main.infoDictionary ?? [:]
 try check((info["GSAWorkspaceRoot"] as? String)?.utf8.elementsEqual(root.utf8)==true && info["GSAWorkspaceID"] as? String==id && info["GSAWorkspaceRole"] as? String==role && info["GSADevice"] as? String==device && info["GSAInode"] as? String==inode && info["GSARevision"] as? NSNumber==revision,"GRANT_BINDING_MISMATCH")
 try requireSignedSandbox(root,role)
 let rootFD=try openCanonicalRoot(root);defer{close(rootFD)}
 let identity=try statFD(rootFD)
 try check(String(identity.st_dev)==device && String(identity.st_ino)==inode,"ROOT_UNVERIFIED")
 let target:Int32
 if path=="."{target=try duplicate(rootFD)}else{
  let components=try parts(path);var current=try duplicate(rootFD)
  do {
   for component in components {
    let next=openat(current,component,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC)
    try check(next>=0,"PATH_OR_ACCESS_DENIED")
    close(current);current=next
    try check((try statFD(current)).st_dev==identity.st_dev,"DEVICE_BOUNDARY")
   }
   target=current
  }catch{close(current);throw error}
 }
 defer{close(target)}
 let capture=Capture(identity.st_dev);try capture.directory(target,"",0,nil)
 let binding:[String:Any]=["workspace_id":id,"role":role,"root":root,"device":device,"inode":inode,"revision":revision,"path":path]
 return ["ok":true,"format":"gsa-directory-capture-response-v1","binding":binding,"capture":try capture.payload()]
}
// A hard wall-clock cap also covers blocking reads; termination is transport failure,
// never a partial successful capture. Native execution/proof is a separate task.
alarm(15)
do {
 let input=try boundedInput()
 guard let request=try JSONSerialization.jsonObject(with:input) as? [String:Any] else{try fail("INVALID_REQUEST")}
 let output=try json(run(request));try check(output.count<=responseLimit,"RESPONSE_LIMIT_EXCEEDED");try timely()
 FileHandle.standardOutput.write(output)
}catch{let code=(error as? Failure)?.code ?? "IO_ERROR";FileHandle.standardOutput.write(try! json(["ok":false,"error":code]))}
