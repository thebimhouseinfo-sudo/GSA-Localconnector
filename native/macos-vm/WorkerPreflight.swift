// Fail-closed macOS Virtualization worker preflight, no VM launch.
// Input is a constrained JSON plan passed on stdin. Output is an observation,
// not proof of filesystem isolation or permission to execute.
import Foundation
import Virtualization
import Darwin

struct Request: Decodable {
    let protocolVersion: String
    let workspaceID: String
    let canonicalRoot: String
    let cpuCount: Int
    let memoryMiB: Int
    let maxRuntimeMs: Int
}
struct Report: Encodable {
    let protocolVersion: String
    let state: String
    let workspaceID: String?
    let cpuCount: Int?
    let memoryMiB: Int?
    let fileShareTag: String?
    let frameworkConfigurationValid: Bool
    let securityVerified: Bool
    let executionAuthorized: Bool
    let errorCode: String?
}
enum ValidationFailure: Error { case invalidRequest, unsafeRoot, invalidResources, missingRoot, notDirectory, symbolicLink }
func validate(_ request: Request) throws -> URL {
    guard request.protocolVersion == "gsa-vm-worker-preflight-v1",
          request.workspaceID.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$", options: .regularExpression) != nil,
          request.cpuCount >= 1, request.cpuCount <= 8,
          request.memoryMiB >= 512, request.memoryMiB <= 16384,
          request.maxRuntimeMs >= 1000, request.maxRuntimeMs <= 3600000
    else { throw ValidationFailure.invalidRequest }
    let root = request.canonicalRoot
    guard root.hasPrefix("/"), root != "/", !root.contains("\0"),
          !root.contains("\n"), !root.contains("\r"),
          !root.split(separator: "/", omittingEmptySubsequences: true).contains(where: { $0 == "." || $0 == ".." })
    else { throw ValidationFailure.unsafeRoot }
    let url = URL(fileURLWithPath: root, isDirectory: true)
    var statBuffer = stat()
    guard lstat(root, &statBuffer) == 0 else { throw ValidationFailure.missingRoot }
    guard (statBuffer.st_mode & mode_t(S_IFMT)) != mode_t(S_IFLNK) else { throw ValidationFailure.symbolicLink }
    guard (statBuffer.st_mode & mode_t(S_IFMT)) == mode_t(S_IFDIR) else { throw ValidationFailure.notDirectory }
    guard url.resolvingSymlinksInPath().standardizedFileURL.path == url.standardizedFileURL.path
    else { throw ValidationFailure.symbolicLink }
    return url
}
func report(_ value: Report) {
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(value) else { exit(2) }
    print(String(decoding: data, as: UTF8.self))
}
let input = FileHandle.standardInput.readDataToEndOfFile()
guard input.count > 0, input.count <= 4096,
      let request = try? JSONDecoder().decode(Request.self, from: input) else {
    report(Report(protocolVersion:"gsa-vm-worker-preflight-v1", state:"BLOCKED",
                  workspaceID:nil,cpuCount:nil,memoryMiB:nil,fileShareTag:nil,
                  frameworkConfigurationValid:false,securityVerified:false,
                  executionAuthorized:false,errorCode:"INVALID_INPUT"))
    exit(2)
}
do {
    let root = try validate(request)
    // Native API objects prove only that the framework accepts a configuration.
    // A kernel, disk, firmware, VM, guest agent, network, and execution are NOT configured.
    let share = VZSharedDirectory(url:root, readOnly:false)
    let fs = VZVirtioFileSystemDeviceConfiguration(tag:"workspace")
    fs.share = VZSingleDirectoryShare(directory:share)
    let config = VZVirtualMachineConfiguration()
    config.cpuCount = request.cpuCount
    config.memorySize = UInt64(request.memoryMiB) * 1024 * 1024
    config.directorySharingDevices = [fs]
    config.networkDevices = []
    report(Report(protocolVersion:"gsa-vm-worker-preflight-v1",state:"CANDIDATE_ONLY",
                  workspaceID:request.workspaceID,cpuCount:request.cpuCount,
                  memoryMiB:request.memoryMiB,fileShareTag:fs.tag,
                  frameworkConfigurationValid:false,securityVerified:false,
                  executionAuthorized:false,errorCode:"BOOT_IMAGE_AND_NATIVE_PROOF_MISSING"))
} catch {
    report(Report(protocolVersion:"gsa-vm-worker-preflight-v1",state:"BLOCKED",
                  workspaceID:nil,cpuCount:nil,memoryMiB:nil,fileShareTag:nil,
                  frameworkConfigurationValid:false,securityVerified:false,
                  executionAuthorized:false,errorCode:String(describing:error)))
    exit(2)
}
