// Offline RAW disk attachment preflight. No VM is started.
// The attachment is READ ONLY. A matching checksum never proves boot or isolation.
import Foundation
import Virtualization
import CryptoKit
import Darwin

struct DiskRequest: Decodable {
    let protocolVersion: String
    let imagePath: String
    let expectedSHA256: String
    let expectedBytes: Int64
}
struct DiskReport: Encodable {
    let state: String
    let rawSHA256Verified: Bool
    let nativeAttachmentConstructed: Bool
    let readOnly: Bool
    let vmStarted: Bool
    let securityVerified: Bool
    let executionAuthorized: Bool
    let errorCode: String?
}
func emit(_ state: String, _ verified: Bool, _ attached: Bool, _ code: String?) {
    let r = DiskReport(state:state, rawSHA256Verified:verified,
        nativeAttachmentConstructed:attached,readOnly:true,vmStarted:false,
        securityVerified:false,executionAuthorized:false,errorCode:code)
    if let data = try? JSONEncoder().encode(r) { print(String(decoding:data,as:UTF8.self)) }
}
let incoming = FileHandle.standardInput.readDataToEndOfFile()
guard incoming.count > 0, incoming.count < 4096,
      let req = try? JSONDecoder().decode(DiskRequest.self,from:incoming),
      req.protocolVersion == "gsa-vm-raw-preflight-v1",
      req.expectedSHA256.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil,
      req.expectedBytes >= 4096, req.expectedBytes <= 32 * 1024 * 1024 * 1024,
      req.imagePath.hasPrefix("/"), req.imagePath != "/",
      !req.imagePath.contains("\0"), !req.imagePath.contains("\n"),
      !req.imagePath.split(separator:"/").contains(where:{$0 == "." || $0 == ".."})
else { emit("BLOCKED",false,false,"INVALID_INPUT"); exit(2) }
var s = stat()
guard lstat(req.imagePath,&s) == 0,
      (s.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),
      s.st_size == req.expectedBytes,
      URL(fileURLWithPath:req.imagePath).standardizedFileURL.path ==
       URL(fileURLWithPath:req.imagePath).resolvingSymlinksInPath().standardizedFileURL.path
else { emit("BLOCKED",false,false,"IMAGE_IDENTITY_MISMATCH"); exit(2) }

do {
    let fd = open(req.imagePath,O_RDONLY | O_NOFOLLOW)
    guard fd >= 0 else { emit("BLOCKED",false,false,"OPEN_FAILED"); exit(2) }
    defer { close(fd) }
    var current = stat()
    guard fstat(fd,&current) == 0, current.st_ino == s.st_ino,
          current.st_dev == s.st_dev, current.st_size == s.st_size
    else { emit("BLOCKED",false,false,"FILE_CHANGED"); exit(2) }
    var hasher = SHA256()
    let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity:1024*1024)
    defer { buffer.deallocate() }
    while true {
        let n = read(fd,buffer,1024*1024)
        if n < 0 { emit("BLOCKED",false,false,"READ_FAILED"); exit(2) }
        if n == 0 { break }
        hasher.update(data:Data(bytes:buffer,count:n))
    }
    var after = stat()
    guard fstat(fd,&after) == 0, after.st_ino == s.st_ino,
          after.st_size == req.expectedBytes, after.st_mtimespec.tv_sec == s.st_mtimespec.tv_sec,
          after.st_mtimespec.tv_nsec == s.st_mtimespec.tv_nsec
    else { emit("BLOCKED",false,false,"FILE_CHANGED"); exit(2) }
    let sha = hasher.finalize().map{String(format:"%02x",$0)}.joined()
    guard sha == req.expectedSHA256 else { emit("BLOCKED",false,false,"DIGEST_MISMATCH"); exit(2) }
    // This API reopens a pathname: it is for preflight only, NOT an immutable FD lease.
    // The image must remain private/immutable before a separately reviewed VM boot worker.
    let attachment = try VZDiskImageStorageDeviceAttachment(
        url:URL(fileURLWithPath:req.imagePath),readOnly:true)
    _ = VZVirtioBlockDeviceConfiguration(attachment:attachment)
    emit("CANDIDATE_ONLY",true,true,"BOOT_AND_SEC01_NOT_VERIFIED")
} catch {
    emit("BLOCKED",false,false,"NATIVE_ATTACHMENT_FAILED")
    exit(2)
}
