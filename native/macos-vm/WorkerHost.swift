// Private VM supervisor. No host mounts, network, credentials, or direct host command execution.
// Caller owns stdin/stdout. This helper alone grants no MCP or Workspace authority.
import Foundation
import Virtualization
import CryptoKit
import Darwin

let wire = "gsa-vm-host-v1"
var outputFailed=false
signal(SIGPIPE,SIG_IGN)
_ = fcntl(STDOUT_FILENO,F_SETFL,O_NONBLOCK)
func emit(_ object:[String:Any]) {
    guard !outputFailed else{return}
    if var bytes=try? JSONSerialization.data(withJSONObject:object,options:[.sortedKeys]) {
        bytes.append(10)
        let deadline=Date().addingTimeInterval(5)
        bytes.withUnsafeBytes { (raw:UnsafeRawBufferPointer) in
            guard let base=raw.baseAddress else{return}
            var offset=0
            while offset<raw.count {
                let count=Darwin.write(STDOUT_FILENO,base.advanced(by:offset),raw.count-offset)
                if count>0{offset+=count;continue}
                if count<0 && (errno==EAGAIN || errno==EINTR) && Date()<deadline {
                    RunLoop.main.run(mode:.default,before:Date().addingTimeInterval(0.01));continue
                }
                outputFailed=true;break
            }
        }
    }
}
func line(_ handle:FileHandle,_ limit:Int) throws -> Data? {
    var data=Data()
    while let byte=try handle.read(upToCount:1),!byte.isEmpty {
        if byte[0]==10 { return data }
        data.append(byte)
        if data.count>limit { throw NSError(domain:"FRAME_TOO_LARGE",code:2) }
    }
    return data.isEmpty ? nil : data
}
func digest(_ fd:Int32,_ max:Int64) throws -> String {
    guard lseek(fd,0,SEEK_SET)>=0 else { throw NSError(domain:"IMAGE_SEEK",code:2) }
    let handle=FileHandle(fileDescriptor:fd,closeOnDealloc:false)
    var hash=SHA256();var total:Int64=0
    while true {
        let count:Int = try autoreleasepool {
            let data=try handle.read(upToCount:1024*1024) ?? Data()
            total+=Int64(data.count)
            guard total<=max else { throw NSError(domain:"IMAGE_SIZE",code:2) }
            hash.update(data:data)
            return data.count
        }
        if count==0 { break }
    }
    guard total==max else { throw NSError(domain:"IMAGE_SIZE",code:2) }
    return hash.finalize().map{String(format:"%02x",$0)}.joined()
}
func verifiedOpen(_ file:String,_ bytes:Int64,_ sha:String) throws -> Int32 {
    let url=URL(fileURLWithPath:file)
    guard file.hasPrefix("/"),!file.contains("\0"),!file.contains("\n"),
          url.standardizedFileURL.path==url.resolvingSymlinksInPath().standardizedFileURL.path,
          sha.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil else { throw NSError(domain:"IMAGE_PATH",code:2) }
    var before=stat();guard lstat(file,&before)==0,(before.st_mode & mode_t(S_IFMT))==mode_t(S_IFREG),before.st_size==bytes else { throw NSError(domain:"IMAGE_IDENTITY",code:2) }
    let fd=open(file,O_RDONLY|O_NOFOLLOW)
    guard fd>=0 else { throw NSError(domain:"IMAGE_OPEN",code:2) }
    do {
        var observed=stat();guard fstat(fd,&observed)==0,observed.st_dev==before.st_dev,observed.st_ino==before.st_ino,
              try digest(fd,bytes)==sha else { throw NSError(domain:"IMAGE_DIGEST",code:2) }
        var after=stat();guard fstat(fd,&after)==0,after.st_size==before.st_size,
              after.st_mtimespec.tv_sec==before.st_mtimespec.tv_sec,after.st_mtimespec.tv_nsec==before.st_mtimespec.tv_nsec,
              after.st_ctimespec.tv_sec==before.st_ctimespec.tv_sec,after.st_ctimespec.tv_nsec==before.st_ctimespec.tv_nsec else { throw NSError(domain:"IMAGE_CHANGED",code:2) }
        return fd
    } catch { close(fd);throw error }
}
struct Config:Decodable {
    let protocolVersion:String;let workspaceID:String;let nonce:String
    let imagePath:String;let expectedBytes:Int64;let expectedSHA256:String
    let seedImagePath:String;let seedBytes:Int64;let seedSHA256:String
    let timeoutSeconds:Int
}
final class StopState:@unchecked Sendable {
    private let lock=NSLock();private var reason:String?=nil
    func stop(_ why:String){lock.lock();if reason==nil{reason=why};lock.unlock()}
    func get()->String?{lock.lock();defer{lock.unlock()};return reason}
}
var exitCode:Int32=0
do {
    guard let first=try line(.standardInput,16384),let cfg=try? JSONDecoder().decode(Config.self,from:first),
          cfg.protocolVersion==wire,cfg.workspaceID.range(of:"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$",options:.regularExpression) != nil,
          cfg.nonce.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil,
          (4096...34359738368).contains(cfg.expectedBytes),(4096...16777216).contains(cfg.seedBytes),
          (10...600).contains(cfg.timeoutSeconds) else { throw NSError(domain:"INVALID_CONFIG",code:2) }
    let source=try verifiedOpen(cfg.imagePath,cfg.expectedBytes,cfg.expectedSHA256);defer{close(source)}
    let seedFD=try verifiedOpen(cfg.seedImagePath,cfg.seedBytes,cfg.seedSHA256);defer{close(seedFD)}
    let scratch=FileManager.default.temporaryDirectory.appendingPathComponent("gsa-worker-"+UUID().uuidString,isDirectory:true)
    try FileManager.default.createDirectory(at:scratch,withIntermediateDirectories:false,attributes:[.posixPermissions:0o700])
    var discard=true
    defer{if discard{try? FileManager.default.removeItem(at:scratch)}else{fputs("GSA_WORKER_SCRATCH_RETAINED="+scratch.path+"\n",stderr)}}
    let working=scratch.appendingPathComponent("working.raw")
    guard fclonefileat(source,AT_FDCWD,working.path,0)==0 else{throw NSError(domain:"CLONE_FAILED",code:Int(errno))}
    let workFD=try verifiedOpen(working.path,cfg.expectedBytes,cfg.expectedSHA256);close(workFD)
    // Re-open a verified private clone of the seed, avoiding a user-controlled attachment pathname.
    let privateSeed=scratch.appendingPathComponent("seed.iso")
    guard fclonefileat(seedFD,AT_FDCWD,privateSeed.path,0)==0 else{throw NSError(domain:"SEED_CLONE_FAILED",code:Int(errno))}
    let privateSeedFD=try verifiedOpen(privateSeed.path,cfg.seedBytes,cfg.seedSHA256);close(privateSeedFD)
    let output=Pipe()
    let console=output.fileHandleForWriting
    let reader=output.fileHandleForReading
    defer{try? console.close();try? reader.close()}
    guard fcntl(reader.fileDescriptor,F_SETFL,O_NONBLOCK)==0 else{throw NSError(domain:"OUTPUT_PIPE",code:2)}
    let input=Pipe();defer{try? input.fileHandleForWriting.close();try? input.fileHandleForReading.close()}
    let config=VZVirtualMachineConfiguration();config.platform=VZGenericPlatformConfiguration()
    let efi=VZEFIBootLoader();efi.variableStore=try VZEFIVariableStore(creatingVariableStoreAt:scratch.appendingPathComponent("nvram"),options:[]);config.bootLoader=efi
    config.cpuCount=2;config.memorySize=2*1024*1024*1024
    config.storageDevices=[VZVirtioBlockDeviceConfiguration(attachment:try VZDiskImageStorageDeviceAttachment(url:working,readOnly:false)),VZVirtioBlockDeviceConfiguration(attachment:try VZDiskImageStorageDeviceAttachment(url:privateSeed,readOnly:true))]
    let serial=VZVirtioConsoleDeviceSerialPortConfiguration();serial.attachment=VZFileHandleSerialPortAttachment(fileHandleForReading:input.fileHandleForReading,fileHandleForWriting:console);config.serialPorts=[serial]
    let graphics=VZVirtioGraphicsDeviceConfiguration();graphics.scanouts=[VZVirtioGraphicsScanoutConfiguration(widthInPixels:1024,heightInPixels:768)];config.graphicsDevices=[graphics]
    config.networkDevices=[];config.directorySharingDevices=[]
    try config.validate()
    let stop=StopState()
    signal(SIGTERM,SIG_IGN);signal(SIGINT,SIG_IGN)
    let term=DispatchSource.makeSignalSource(signal:SIGTERM,queue:.main);term.setEventHandler{stop.stop("cancelled")};term.resume();defer{term.cancel()}
    let interrupt=DispatchSource.makeSignalSource(signal:SIGINT,queue:.main);interrupt.setEventHandler{stop.stop("cancelled")};interrupt.resume();defer{interrupt.cancel()}
    let vm=VZVirtualMachine(configuration:config)
    var started=false,finished=false,failure:String?=nil
    vm.start{result in switch result{case .success:started=true;case .failure(let error):failure=String(describing:error)};finished=true}
    let launchDeadline=Date().addingTimeInterval(20)
    while !finished&&Date()<launchDeadline&&stop.get()==nil{RunLoop.main.run(mode:.default,before:Date().addingTimeInterval(0.05))}
    if !started{stop.stop("start_failed:"+(failure ?? "timeout"))}
    if started{
        emit(["protocol":wire,"type":"started","nonce":cfg.nonce,"workspace_id":cfg.workspaceID,"network_devices":0,"host_shares":0,"security_verified":false])
        DispatchQueue.global().async{
            do{
                while let frame=try line(.standardInput,65536){
                    guard let value=try JSONSerialization.jsonObject(with:frame) as? [String:Any],value["nonce"] as? String==cfg.nonce,value["workspace_id"] as? String==cfg.workspaceID else{stop.stop("invalid_host_frame");break}
                    if value["type"] as? String=="host-control",value["method"] as? String=="cancel"{stop.stop("cancelled");break}
                    guard value["protocol"] as? String=="gsa-vm-worker-v1",value["type"] as? String=="request" else{stop.stop("invalid_host_frame");break}
                    input.fileHandleForWriting.write(frame);input.fileHandleForWriting.write(Data([10]))
                }
                stop.stop("stdin_closed")
            }catch{stop.stop("host_input_error")}
        }
    }
    let deadline=Date().addingTimeInterval(TimeInterval(cfg.timeoutSeconds))
    var buffered=Data();var totalBytes=0;var ready=false;var diagnosticBytes=0
    while started && !outputFailed && stop.get()==nil&&Date()<deadline&&vm.state != .stopped&&vm.state != .error{
        RunLoop.main.run(mode:.default,before:Date().addingTimeInterval(0.02))
        do{
            var chunk=[UInt8](repeating:0,count:65536)
            let count=Darwin.read(reader.fileDescriptor,&chunk,chunk.count)
            if count>0{buffered.append(contentsOf:chunk.prefix(count));totalBytes+=count}
            else if count<0 && errno != EAGAIN && errno != EINTR{stop.stop("guest_output_error");break}
            if totalBytes>64*1024*1024||buffered.count>6*1024*1024+65536{stop.stop("guest_output_limit");break}
            while let newline=buffered.withUnsafeBytes({ (raw:UnsafeRawBufferPointer)->Data.Index? in
                guard let base=raw.baseAddress,let found=memchr(base,10,raw.count) else{return nil}
                return buffered.startIndex+base.distance(to:UnsafeRawPointer(found))
            }){
                let frame=buffered.prefix(upTo:newline);buffered.removeSubrange(...newline)
                guard let value=try? JSONSerialization.jsonObject(with:frame),let envelope=value as? [String:Any],envelope["protocol"] as? String=="gsa-vm-worker-v1" else{
                    if diagnosticBytes<32768{let text=String(decoding:frame.prefix(500),as:UTF8.self);diagnosticBytes+=text.utf8.count;emit(["protocol":wire,"type":"guest-log","nonce":cfg.nonce,"workspace_id":cfg.workspaceID,"text":text])}
                    continue
                }
                guard envelope["nonce"] as? String==cfg.nonce,envelope["workspace_id"] as? String==cfg.workspaceID,["ready","result","error"].contains(envelope["type"] as? String ?? "") else{stop.stop("guest_auth_failed");break}
                if envelope["type"] as? String=="ready"{if ready{stop.stop("duplicate_ready");break};ready=true}
                if !ready{stop.stop("result_before_ready");break}
                emit(envelope)
                if let receipt=envelope["result"] as? [String:Any],receipt["shutdown"] as? Bool==true{stop.stop("shutdown");break}
            }
        }
    }
    if stop.get()==nil{stop.stop(outputFailed ? "host_output_blocked":Date()>=deadline ? "timeout":"vm_stopped")}
    if vm.state != .stopped{
        Task{@MainActor in try? await vm.stop()}
        let end=Date().addingTimeInterval(10)
        while vm.state != .stopped&&Date()<end{RunLoop.main.run(mode:.default,before:Date().addingTimeInterval(0.05))}
    }
    let clean=vm.state == .stopped;discard=clean
    emit(["protocol":wire,"type":"stopped","nonce":cfg.nonce,"workspace_id":cfg.workspaceID,"clean":clean,"reason":stop.get() ?? "unknown","security_verified":false])
    if !clean || !ready || !["shutdown","cancelled","stdin_closed"].contains(stop.get() ?? ""){exitCode=2}
}catch{
    emit(["protocol":wire,"type":"error","code":String(describing:error).prefix(300).description,"security_verified":false]);exitCode=2
}
if exitCode != 0{exit(exitCode)}
