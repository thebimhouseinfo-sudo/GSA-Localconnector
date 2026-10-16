// Experimental EFI Linux ARM64 boot probe. Runs ONLY when explicitly invoked on Mac.
// NO workspace share, network, host secrets, or connector execution capability.
// Native VM boot != SEC01 isolation verification.
import Foundation
import Virtualization
import CryptoKit
import Darwin

struct Request: Decodable {
    let protocolVersion: String
    let imagePath: String
    let expectedSHA256: String
    let expectedBytes: Int64
    let timeoutSeconds: Int
}
struct Report: Encodable {
    let state: String
    let imageVerified: Bool
    let vmStarted: Bool
    let securityVerified: Bool
    let executionAuthorized: Bool
    let serialLogPath: String?
    let diagnostic: String?
}
func report(_ state: String, _ imageVerified: Bool, _ vmStarted: Bool,
            _ log: String? = nil, detail: String? = nil) {
    let result = Report(state: state, imageVerified: imageVerified, vmStarted: vmStarted,
                        securityVerified: false, executionAuthorized: false,
                        serialLogPath: log, diagnostic: detail)
    if let data = try? JSONEncoder().encode(result) {
        print(String(decoding: data, as: UTF8.self))
        fflush(stdout)
    }
}
let data = FileHandle.standardInput.readDataToEndOfFile()
guard data.count > 0, data.count <= 4096,
      let request = try? JSONDecoder().decode(Request.self, from: data),
      request.protocolVersion == "gsa-vm-boot-probe-v1",
      request.expectedSHA256.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil,
      (10...180).contains(request.timeoutSeconds),
      request.expectedBytes >= 4096 && request.expectedBytes <= 32 * 1024 * 1024 * 1024,
      request.imagePath.hasPrefix("/"), request.imagePath != "/",
      !request.imagePath.contains("\0"), !request.imagePath.contains("\n"),
      !request.imagePath.split(separator:"/").contains(where:{$0 == "." || $0 == ".."})
else { report("BLOCKED", false, false, detail:"INVALID_INPUT"); exit(2) }
var st = stat()
let imageURL = URL(fileURLWithPath:request.imagePath)
guard lstat(request.imagePath,&st) == 0,
      (st.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),
      st.st_size == request.expectedBytes,
      imageURL.standardizedFileURL.path == imageURL.resolvingSymlinksInPath().standardizedFileURL.path
else { report("BLOCKED",false,false,detail:"IMAGE_IDENTITY_INVALID"); exit(2) }
let fd = open(request.imagePath,O_RDONLY | O_NOFOLLOW)
guard fd >= 0 else { report("BLOCKED",false,false,detail:"IMAGE_OPEN_FAILED"); exit(2) }
var fdst = stat()
guard fstat(fd,&fdst) == 0, fdst.st_dev == st.st_dev, fdst.st_ino == st.st_ino else {
    close(fd); report("BLOCKED",false,false,detail:"IMAGE_RACE"); exit(2)
}
var hash = SHA256()
let buf = UnsafeMutablePointer<UInt8>.allocate(capacity: 1024*1024)
defer { buf.deallocate() }
while true {
    let n = read(fd,buf,1024*1024)
    if n < 0 { close(fd); report("BLOCKED",false,false,detail:"IMAGE_READ_FAILED"); exit(2) }
    if n == 0 { break }
    hash.update(data: Data(bytes:buf,count:n))
}
var after = stat()
let stable = fstat(fd,&after) == 0 && after.st_dev == st.st_dev &&
    after.st_ino == st.st_ino && after.st_size == st.st_size &&
    after.st_mtimespec.tv_sec == st.st_mtimespec.tv_sec &&
    after.st_mtimespec.tv_nsec == st.st_mtimespec.tv_nsec
close(fd)
let digest = hash.finalize().map{String(format:"%02x",$0)}.joined()
guard stable && digest == request.expectedSHA256 else {
    report("BLOCKED",false,false,detail:"IMAGE_DIGEST_OR_IDENTITY_MISMATCH"); exit(2)
}
do {
    let scratch = FileManager.default.temporaryDirectory.appendingPathComponent("gsa-vm-probe-"+UUID().uuidString,isDirectory:true)
    try FileManager.default.createDirectory(at:scratch,withIntermediateDirectories:false)
    defer { try? FileManager.default.removeItem(at:scratch) }
    let serialURL = scratch.appendingPathComponent("serial.log")
    FileManager.default.createFile(atPath:serialURL.path,contents:Data())
    let serialFile = try FileHandle(forWritingTo:serialURL)
    let nullInput = try FileHandle(forReadingFrom:URL(fileURLWithPath:"/dev/null"))
    defer { try? serialFile.close(); try? nullInput.close() }
    let efi = VZEFIBootLoader()
    efi.variableStore = try VZEFIVariableStore(
        creatingVariableStoreAt:scratch.appendingPathComponent("nvram"),options:[])
    let config = VZVirtualMachineConfiguration()
    config.platform = VZGenericPlatformConfiguration()
    config.bootLoader = efi
    config.cpuCount = 2
    config.memorySize = 2*1024*1024*1024
    let disk = try VZDiskImageStorageDeviceAttachment(url:imageURL,readOnly:true)
    config.storageDevices = [VZVirtioBlockDeviceConfiguration(attachment:disk)]
    let serial = VZVirtioConsoleDeviceSerialPortConfiguration()
    serial.attachment = VZFileHandleSerialPortAttachment(
        fileHandleForReading:nullInput,fileHandleForWriting:serialFile)
    config.serialPorts = [serial]
    config.networkDevices = []
    config.directorySharingDevices = []
    try config.validate()
    let vm = VZVirtualMachine(configuration:config)
    var started = false
    var completed = false
    var failure: String? = nil
    vm.start { result in
        switch result {
        case .success: started = true
        case .failure(let error): failure = String(describing:error).prefix(300).description
        }
        completed = true
    }
    let startDeadline = Date().addingTimeInterval(20)
    while !completed && Date() < startDeadline {
        RunLoop.main.run(mode:.default,before:Date().addingTimeInterval(0.05))
    }
    if !completed {
        Task { try? await vm.stop() }
        let shutdownLimit = Date().addingTimeInterval(5)
        while vm.state != .stopped && Date() < shutdownLimit {
            RunLoop.main.run(mode:.default,before:Date().addingTimeInterval(0.1))
        }
        report("BLOCKED",true,false,detail:"START_TIMEOUT"); exit(2)
    }
    if !started {
        report("BLOCKED",true,false,detail:"VM_START_FAILED: "+(failure ?? "unknown")); exit(2)
    }
    let deadline = Date().addingTimeInterval(TimeInterval(request.timeoutSeconds))
    while Date() < deadline && vm.state != .stopped && vm.state != .error {
        RunLoop.main.run(mode:.default,before:Date().addingTimeInterval(0.1))
    }
    // The guest is not authorized to run connector tasks. Stop the disposable VM.
    if vm.state != .stopped {
        Task { try? await vm.stop() }
        let shutdownLimit = Date().addingTimeInterval(10)
        while vm.state != .stopped && Date() < shutdownLimit {
            RunLoop.main.run(mode:.default,before:Date().addingTimeInterval(0.1))
        }
    }
    try? serialFile.synchronize()
    let logData = (try? Data(contentsOf:serialURL)) ?? Data()
    let snippet = String(decoding:logData.prefix(4096),as:UTF8.self)
    // Logs can contain guest-controlled content; limit printable control characters.
    let sanitized = snippet.unicodeScalars.map { CharacterSet.controlCharacters.contains($0) && $0 != "\n" ? " " : String($0) }.joined()
    report("VM_STARTED_UNVERIFIED",true,true,detail:"serial_bytes=\(logData.count); serial_prefix="+String(sanitized.prefix(1500)))
} catch {
    report("BLOCKED",true,false,detail:String(describing:error).prefix(300).description)
    exit(2)
}
