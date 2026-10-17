// Experimental EFI Linux ARM64 boot probe. Runs ONLY when explicitly invoked on Mac.
// NO workspace share, network, host secrets, or connector execution capability.
// Native VM boot != SEC01 isolation verification.
import Foundation
import Virtualization
import CryptoKit
import Darwin
import AppKit

struct Request: Decodable {
    let protocolVersion: String
    let imagePath: String
    let expectedSHA256: String
    let expectedBytes: Int64
    let timeoutSeconds: Int
    let diskMode: String?
    let preflightOnly: Bool?
    let seedImagePath: String?
    let seedSHA256: String?
    let seedBytes: Int64?
    let smokeNonce: String?
}
struct Report: Encodable {
    let state: String
    let imageVerified: Bool
    let vmStarted: Bool
    let securityVerified: Bool
    let executionAuthorized: Bool
    let serialLogPath: String?
    let diagnostic: String?
    let diskMode: String
    let guestSmokeResult: String?
}
func report(_ state: String, _ imageVerified: Bool, _ vmStarted: Bool,
            _ log: String? = nil, detail: String? = nil,
            diskMode: String = "read-only", guestSmoke: String? = nil) {
    let result = Report(state: state, imageVerified: imageVerified, vmStarted: vmStarted,
                        securityVerified: false, executionAuthorized: false,
                        serialLogPath: log, diagnostic: detail,
                        diskMode: diskMode, guestSmokeResult: guestSmoke)
    if let data = try? JSONEncoder().encode(result) {
        print(String(decoding: data, as: UTF8.self))
        fflush(stdout)
    }
}
func phase(_ name: String) { fputs("GSA_VM_PHASE="+name+"\n", stderr); fflush(stderr) }
phase("INPUT")
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
let diskMode = request.diskMode ?? "read-only"
let hasSeed = request.seedImagePath != nil || request.seedSHA256 != nil ||
    request.seedBytes != nil || request.smokeNonce != nil
guard ["read-only", "disposable-clone"].contains(diskMode),
      !hasSeed || (diskMode == "disposable-clone" &&
        request.seedImagePath?.hasPrefix("/") == true &&
        request.seedSHA256?.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil &&
        request.smokeNonce?.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil &&
        (4096...16777216).contains(request.seedBytes ?? 0))
else { report("BLOCKED",false,false,detail:"INVALID_DISK_OR_SEED_MODE"); exit(2) }

func fileDigest(_ url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var hash = SHA256()
    while let bytes = try handle.read(upToCount: 1024*1024), !bytes.isEmpty {
        hash.update(data: bytes)
    }
    return hash.finalize().map{String(format:"%02x",$0)}.joined()
}
var st = stat()
let imageURL = URL(fileURLWithPath:request.imagePath)
guard lstat(request.imagePath,&st) == 0,
      (st.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),
      st.st_size == request.expectedBytes,
      imageURL.standardizedFileURL.path == imageURL.resolvingSymlinksInPath().standardizedFileURL.path
else { report("BLOCKED",false,false,detail:"IMAGE_IDENTITY_INVALID"); exit(2) }
let fd = open(request.imagePath,O_RDONLY | O_NOFOLLOW)
guard fd >= 0 else { report("BLOCKED",false,false,detail:"IMAGE_OPEN_FAILED"); exit(2) }
defer { close(fd) }
var fdst = stat()
guard fstat(fd,&fdst) == 0, fdst.st_dev == st.st_dev, fdst.st_ino == st.st_ino else {
    close(fd); report("BLOCKED",false,false,detail:"IMAGE_RACE"); exit(2)
}
phase("IMAGE_HASH")
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
let digest = hash.finalize().map{String(format:"%02x",$0)}.joined()
guard stable && digest == request.expectedSHA256 else {
    report("BLOCKED",false,false,detail:"IMAGE_DIGEST_OR_IDENTITY_MISMATCH"); exit(2)
}
phase("IMAGE_VERIFIED")
var finalExitCode:Int32 = 0
do {
    phase("SCRATCH_CREATE")
    let scratch = FileManager.default.temporaryDirectory.appendingPathComponent("gsa-vm-probe-"+UUID().uuidString,isDirectory:true)
    try FileManager.default.createDirectory(at:scratch,withIntermediateDirectories:false,attributes:[.posixPermissions:0o700])
    phase("SCRATCH_PATH="+scratch.path)
    var discardScratch = true
    defer {
        if discardScratch { try? FileManager.default.removeItem(at:scratch) }
        else { phase("SCRATCH_RETAINED="+scratch.path) }
    }
    var attachedImage = imageURL
    if diskMode == "disposable-clone" {
        phase("DISPOSABLE_CLONE")
        let working = scratch.appendingPathComponent("working.raw")
        // Clone the verified open descriptor, not a pathname that could be replaced.
        guard fclonefileat(fd, AT_FDCWD, working.path, 0) == 0 else {
            throw NSError(domain:"APFS_CLONE_FAILED",code:Int(errno))
        }
        var cloned = stat()
        guard lstat(working.path,&cloned) == 0,
              (cloned.st_dev != st.st_dev || cloned.st_ino != st.st_ino),
              cloned.st_size == request.expectedBytes,
              try fileDigest(working) == request.expectedSHA256 else {
            throw NSError(domain:"CLONE_IDENTITY_OR_DIGEST",code:2)
        }
        attachedImage = working
    }
    var seedURL: URL? = nil
    if hasSeed {
        let url = URL(fileURLWithPath:request.seedImagePath!)
        var seedStat = stat()
        guard lstat(url.path,&seedStat) == 0,
              (seedStat.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),
              url.standardizedFileURL.path == url.resolvingSymlinksInPath().standardizedFileURL.path,
              seedStat.st_size == request.seedBytes!,
              try fileDigest(url) == request.seedSHA256! else {
            throw NSError(domain:"SEED_IDENTITY_OR_DIGEST",code:2)
        }
        seedURL = url
    }
    if request.preflightOnly == true {
        if diskMode == "disposable-clone" {
            let writeFD = open(attachedImage.path,O_RDWR | O_NOFOLLOW)
            guard writeFD >= 0 else { throw NSError(domain:"CLONE_WRITE_OPEN",code:Int(errno)) }
            defer { close(writeFD) }
            var sourceByte: UInt8 = 0
            guard pread(fd,&sourceByte,1,0) == 1 else { throw NSError(domain:"SOURCE_READ",code:2) }
            var changed = sourceByte ^ 0xff
            var observed: UInt8 = 0
            guard pwrite(writeFD,&changed,1,0) == 1, fsync(writeFD) == 0,
                  pread(fd,&observed,1,0) == 1, observed == sourceByte,
                  try fileDigest(imageURL) == request.expectedSHA256 else {
                throw NSError(domain:"CLONE_NOT_INDEPENDENT",code:2)
            }
        }
        try FileManager.default.removeItem(at:scratch)
        report("DISK_PREFLIGHT_PASSED",true,false,
               detail:"clone_write_verified=\(diskMode == "disposable-clone")",
               diskMode:diskMode)
        exit(0)
    }
    let serialURL = scratch.appendingPathComponent("serial.log")
    FileManager.default.createFile(atPath:serialURL.path,contents:Data())
    let serialFile = try FileHandle(forWritingTo:serialURL)
    let serialReader = try FileHandle(forReadingFrom:serialURL)
    defer { try? serialReader.close() }
    let nullInput = try FileHandle(forReadingFrom:URL(fileURLWithPath:"/dev/null"))
    defer { try? serialFile.close(); try? nullInput.close() }
    phase("EFI_VARIABLE_STORE")
    let efi = VZEFIBootLoader()
    efi.variableStore = try VZEFIVariableStore(
        creatingVariableStoreAt:scratch.appendingPathComponent("nvram"),options:[])
    let config = VZVirtualMachineConfiguration()
    config.platform = VZGenericPlatformConfiguration()
    config.bootLoader = efi
    config.cpuCount = 2
    config.memorySize = 2*1024*1024*1024
    phase("DISK_ATTACHMENT")
    let disk = try VZDiskImageStorageDeviceAttachment(url:attachedImage,readOnly:diskMode == "read-only")
    config.storageDevices = [VZVirtioBlockDeviceConfiguration(attachment:disk)]
    if let seedURL {
        let seed = try VZDiskImageStorageDeviceAttachment(url:seedURL,readOnly:true)
        config.storageDevices.append(VZVirtioBlockDeviceConfiguration(attachment:seed))
    }
    phase("SERIAL_ATTACHMENT")
    let serial = VZVirtioConsoleDeviceSerialPortConfiguration()
    serial.attachment = VZFileHandleSerialPortAttachment(
        fileHandleForReading:nullInput,fileHandleForWriting:serialFile)
    config.serialPorts = [serial]
    let graphics = VZVirtioGraphicsDeviceConfiguration()
    graphics.scanouts = [VZVirtioGraphicsScanoutConfiguration(widthInPixels: 1024, heightInPixels: 768)]
    config.graphicsDevices = [graphics]
    phase("GRAPHICS_CONFIGURED")
    config.networkDevices = []
    config.directorySharingDevices = []
    phase("CONFIG_VALIDATE")
    try config.validate()
    phase("CONFIG_VALIDATED")
    phase("VM_CONSTRUCT")
    let vm = VZVirtualMachine(configuration:config)
    phase("VM_CONSTRUCTED")
    // Visible diagnostic display; window visibility is not proof of OS boot.
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    app.finishLaunching()
    // RunLoop alone does not dispatch AppKit keyboard/window events. Pump the
    // application queue so GRUB input and the diagnostic window remain usable.
    func pumpEvents(_ duration: TimeInterval) {
        let deadline = Date().addingTimeInterval(duration)
        while Date() < deadline,
              let event = app.nextEvent(matching: .any, until: deadline,
                                        inMode: .default, dequeue: true) {
            app.sendEvent(event)
        }
        app.updateWindows()
    }
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1024, height: 768),
                          styleMask: [.titled, .closable, .miniaturizable],
                          backing: .buffered, defer: false)
    window.title = "GSA Linux ARM64 - guest boot observation only"
    let view = VZVirtualMachineView(frame: NSRect(x: 0, y: 0, width: 1024, height: 768))
    view.virtualMachine = vm
    window.contentView = view
    window.center()
    window.makeKeyAndOrderFront(nil)
    app.activate(ignoringOtherApps: true)
    phase("GRAPHICS_WINDOW_READY")
    var started = false
    var completed = false
    var failure: String? = nil
    phase("VM_START_REQUEST")
    vm.start { result in
        switch result {
        case .success: started = true
        case .failure(let error): failure = String(describing:error).prefix(300).description
        }
        completed = true
        phase("VM_START_CALLBACK")
    }
    let startDeadline = Date().addingTimeInterval(20)
    while !completed && Date() < startDeadline {
        pumpEvents(0.05)
    }
    if !completed {
        Task { @MainActor in try? await vm.stop() }
        let shutdownLimit = Date().addingTimeInterval(5)
        while vm.state != .stopped && Date() < shutdownLimit {
            pumpEvents(0.1)
        }
        if vm.state != .stopped { discardScratch = false }
        throw NSError(domain:"START_TIMEOUT",code:2)
    }
    phase("START_WAIT_COMPLETE")
    if !started {
        throw NSError(domain:"VM_START_FAILED: "+(failure ?? "unknown"),code:2)
    }
    phase("VM_STARTED")
    let deadline = Date().addingTimeInterval(TimeInterval(request.timeoutSeconds))
    var guestSmoke: String? = nil
    var serialObserved = Data()
    while Date() < deadline && vm.state != .stopped && vm.state != .error {
        pumpEvents(0.1)
        if let nonce = request.smokeNonce {
            do {
                // A regular log file returns nil at its current EOF; the guest may append later.
                if let bytes = try serialReader.read(upToCount:65536) { serialObserved.append(bytes) }
            } catch { guestSmoke = "FAIL"; break }
            if serialObserved.count > 1024*1024 { guestSmoke = "FAIL"; break }
            let lines = String(decoding:serialObserved,as:UTF8.self).components(separatedBy:.newlines)
            if lines.contains("GSA_VM_SMOKE_V1 \(nonce) PASS") { guestSmoke = "PASS"; break }
            if lines.contains("GSA_VM_SMOKE_V1 \(nonce) FAIL") { guestSmoke = "FAIL"; break }
        }
    }
    // The guest is not authorized to run connector tasks. Stop the disposable VM.
    if vm.state != .stopped {
        Task { @MainActor in try? await vm.stop() }
        let shutdownLimit = Date().addingTimeInterval(10)
        while vm.state != .stopped && Date() < shutdownLimit {
            pumpEvents(0.1)
        }
    }
    window.orderOut(nil)
    let safelyStopped = vm.state == .stopped
    if !safelyStopped { discardScratch = false }
    phase(safelyStopped ? "VM_STOPPED" : "VM_STOP_UNCONFIRMED")
    try? serialFile.synchronize()
    let boundedLog = try FileHandle(forReadingFrom:serialURL)
    defer { try? boundedLog.close() }
    let logData = (try? boundedLog.read(upToCount:65536)) ?? Data()
    let snippet = String(decoding:logData.prefix(4096),as:UTF8.self)
    // Logs can contain guest-controlled content; limit printable control characters.
    let sanitized = snippet.unicodeScalars.map { CharacterSet.controlCharacters.contains($0) && $0 != "\n" ? " " : String($0) }.joined()
    let resultState = !safelyStopped ? "VM_STOP_UNCONFIRMED" : guestSmoke == "PASS" ? "GUEST_SMOKE_PASSED_UNVERIFIED" : "VM_STARTED_UNVERIFIED"
    report(resultState,true,true,detail:"serial_bytes=\(logData.count); serial_prefix="+String(sanitized.prefix(1500)),diskMode:diskMode,guestSmoke:guestSmoke)
    if !safelyStopped || (hasSeed && guestSmoke != "PASS") { finalExitCode = 2 }
} catch {
    report("BLOCKED",true,false,detail:String(describing:error).prefix(300).description)
    exit(2)
}

// Exit only after leaving the scratch-owning scope, so normal failures run cleanup.
if finalExitCode != 0 { exit(finalExitCode) }
