import Foundation
import CryptoKit
import Darwin

// This broker accepts only fixed filesystem operations. No process spawning or networking.
// App Sandbox is the write boundary; no-follow directory descriptors are the read boundary.
struct Failure: Error { let code: String }
func fail(_ code:String) throws -> Never { throw Failure(code:code) }
func check(_ condition:Bool,_ code:String) throws { if !condition { try fail(code) } }
func hash(_ bytes:Data)->String { SHA256.hash(data:bytes).map{String(format:"%02x",$0)}.joined() }
func parts(_ path:String)throws->[String] {
 let p=path.split(separator:"/",omittingEmptySubsequences:false).map(String.init)
 try check(!p.isEmpty && !p.contains(where:{$0.isEmpty || $0=="." || $0==".." || $0.utf8.contains(0) || $0.contains("\\") || $0.lowercased()==".gsa-trash"}),"PATH_OUTSIDE_SCOPE")
 return p
}
func statFD(_ fd:Int32)throws->stat {var s=stat();try check(fstat(fd,&s)==0,"IO_ERROR");return s}
func same(_ a:stat,_ b:stat)->Bool {a.st_dev==b.st_dev && a.st_ino==b.st_ino && a.st_size==b.st_size && a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec && a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec && a.st_nlink==b.st_nlink}
func readFile(_ parent:Int32,_ name:String,_ cap:Int)throws->Data {
 let fd=openat(parent,name,O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);try check(fd>=0,"PATH_OR_ACCESS_DENIED");defer{close(fd)}
 let before=try statFD(fd);try check((before.st_mode&S_IFMT)==S_IFREG && before.st_nlink==1,"UNSAFE_FILE_TYPE")
 try check(before.st_size>=0 && before.st_size<=cap,"READ_LIMIT_EXCEEDED")
 var data=Data();var buffer=[UInt8](repeating:0,count:65536)
 while true {let n=Darwin.read(fd,&buffer,min(buffer.count,cap-data.count+1));try check(n>=0,"IO_ERROR");if n==0{break};data.append(contentsOf:buffer.prefix(n));try check(data.count<=cap,"READ_LIMIT_EXCEEDED")}
 try check(same(before,try statFD(fd)),"CONCURRENT_CHANGE");return data
}
func writeExclusive(_ parent:Int32,_ name:String,_ bytes:Data)throws {
 let fd=openat(parent,name,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0o600);try check(fd>=0,"ALREADY_EXISTS_OR_DENIED");defer{close(fd)}
 var offset=0
 while offset<bytes.count {let n=bytes.withUnsafeBytes{Darwin.write(fd,$0.baseAddress!.advanced(by:offset),bytes.count-offset)};if n<=0{try fail("MUTATION_OUTCOME_UNKNOWN")};offset+=n}
 try check(fsync(fd)==0,"MUTATION_OUTCOME_UNKNOWN")
}
func run(_ req:[String:Any])throws->[String:Any] {
 // Preserve the owner's kernel lease in this trusted process, never across an exec.
 if fcntl(3,F_GETFD)>=0 {_ = fcntl(3,F_SETFD,FD_CLOEXEC)}
 guard let root=req["root"] as? String,let device=req["device"] as? String,let inode=req["inode"] as? String,let relative=req["path"] as? String,let operation=req["operation"] as? String else {try fail("INVALID_REQUEST")}
 let info=Bundle.main.infoDictionary ?? [:]
 try check(info["GSAWorkspaceRoot"] as? String == root && info["GSADevice"] as? String == device && info["GSAInode"] as? String == inode && info["GSARevision"] as? Int == req["revision"] as? Int,"GRANT_BINDING_MISMATCH")
 try check(root.hasPrefix("/") && !root.utf8.contains(0),"INVALID_REQUEST")
 let rootFD=open(root,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);try check(rootFD>=0,"ROOT_UNVERIFIED");defer{close(rootFD)}
 let identity=try statFD(rootFD);try check(String(identity.st_dev)==device && String(identity.st_ino)==inode,"ROOT_UNVERIFIED")
 func parent(_ relative:String)throws->(Int32,String) {
  let p=try parts(relative);var fd=dup(rootFD);try check(fd>=0,"IO_ERROR")
  for component in p.dropLast(){let next=openat(fd,component,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(fd);try check(next>=0,"PATH_OR_ACCESS_DENIED");fd=next}
  return(fd,p.last!)
 }
 let (fd,name)=try parent(relative);defer{close(fd)}
 #if CONTAINMENT_TESTS
 if req["testPause"] as? Bool == true {print("READY");fflush(stdout);usleep(500000)}
 #endif
 func expected()throws->Data {guard let expected=req["expectedSha256"] as? String,expected.count==64 else{try fail("INVALID_REQUEST")};let bytes=try readFile(fd,name,8*1024*1024);try check(hash(bytes)==expected,"HASH_CONFLICT");return bytes}
 switch operation {
 case "read":
  guard let cap=req["maxBytes"] as? Int,cap>=0,cap<=8*1024*1024 else{try fail("INVALID_REQUEST")}
  let bytes=try readFile(fd,name,cap);return["ok":true,"base64":bytes.base64EncodedString(),"sha256":hash(bytes)]
 case "create":
  guard let b64=req["base64"] as? String,let bytes=Data(base64Encoded:b64),bytes.count<=8*1024*1024 else{try fail("INVALID_REQUEST")}
  try writeExclusive(fd,name,bytes)
 case "mkdir":try check(mkdirat(fd,name,0o700)==0,"ALREADY_EXISTS_OR_DENIED")
 case "copy":
  let bytes=try expected();guard let dest=req["destination"] as? String else{try fail("INVALID_REQUEST")};let(df,dn)=try parent(dest);defer{close(df)};try writeExclusive(df,dn,bytes)
 case "replace","move","trash":
  _ = try expected()
  // APFS has atomic rename, but no atomic compare-content-and-mutate primitive.
  // Keep these operations blocked until external-writer races can be proven safe.
  try fail("SECURITY_BLOCKED_ATOMIC_COMPARE_UNAVAILABLE")
 default:try fail("INVALID_OPERATION")
 }
 return["ok":true]
}
do {
 let input=FileHandle.standardInput.readDataToEndOfFile();try check(input.count<=12*1024*1024,"INPUT_LIMIT_EXCEEDED")
 guard let req=try JSONSerialization.jsonObject(with:input) as? [String:Any] else{try fail("INVALID_REQUEST")}
 let result=try run(req);FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:result,options:[.sortedKeys]))
} catch {let code=(error as? Failure)?.code ?? "IO_ERROR";FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject:["ok":false,"error":code],options:[.sortedKeys]))}
