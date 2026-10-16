// Offline EFI boot configuration feasibility probe. Does NOT start a VM.
// RAW image path must have already passed independent SHA256 preflight.
// A separately reviewed, host-authorized boot worker is required for launch.
import Foundation
import Virtualization
import Darwin

struct Request: Decodable {
    let protocolVersion: String
    let rawImagePath: String
    let expectedBytes: Int64
}
struct Report: Encodable {
    let state: String
    let efiConfigurationValid: Bool
    let nativeDiskAttachedReadOnly: Bool
    let vmStarted: Bool
    let securityVerified: Bool
    let executionAuthorized: Bool
    let errorCode: String?
    let diagnostic: String?
}
func output(_ state: String, _ valid: Bool, _ attached: Bool, _ error: String?, _ diagnostic: String? = nil) {
    let item = Report(state: state, efiConfigurationValid: valid,
                      nativeDiskAttachedReadOnly: attached, vmStarted: false,
                      securityVerified: false, executionAuthorized: false, errorCode: error, diagnostic: diagnostic)
    if let bytes = try? JSONEncoder().encode(item) {
        print(String(decoding: bytes, as: UTF8.self))
    }
}
let input = FileHandle.standardInput.readDataToEndOfFile()
guard input.count > 0, input.count <= 4096,
      let request = try? JSONDecoder().decode(Request.self, from: input),
      request.protocolVersion == "gsa-vm-efi-config-v1",
      request.rawImagePath.hasPrefix("/"), request.rawImagePath != "/",
      !request.rawImagePath.contains("\0"), !request.rawImagePath.contains("\n"),
      !request.rawImagePath.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }),
      request.expectedBytes >= 4096, request.expectedBytes <= 32 * 1024 * 1024 * 1024
else { output("BLOCKED", false, false, "INVALID_INPUT"); exit(2) }
var fileInfo = stat()
let url = URL(fileURLWithPath: request.rawImagePath)
guard lstat(request.rawImagePath, &fileInfo) == 0,
      (fileInfo.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),
      fileInfo.st_size == request.expectedBytes,
      url.standardizedFileURL.path == url.resolvingSymlinksInPath().standardizedFileURL.path
else { output("BLOCKED", false, false, "DISK_IDENTITY_INVALID"); exit(2) }
do {
    // Offline only: pathname can be swapped before a future boot.
    let attachment = try VZDiskImageStorageDeviceAttachment(url: url, readOnly: true)
    let config = VZVirtualMachineConfiguration()
    config.platform = VZGenericPlatformConfiguration()
    // Disposable NVRAM, configuration validation only; no VM starts.
    let efiDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: efiDirectory, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: efiDirectory) }
    let variableStoreURL = efiDirectory.appendingPathComponent("efi-variables")
    let efi = VZEFIBootLoader()
    efi.variableStore = try VZEFIVariableStore(creatingVariableStoreAt: variableStoreURL, options: [])
    config.bootLoader = efi
    config.cpuCount = 2
    config.memorySize = 2 * 1024 * 1024 * 1024
    config.storageDevices = [VZVirtioBlockDeviceConfiguration(attachment: attachment)]
    config.networkDevices = []
    config.directorySharingDevices = []
    try config.validate()
    output("CANDIDATE_ONLY", true, true, "BOOT_AND_SEC01_NOT_VERIFIED")
} catch {
    let failure = error as NSError
    let detail = "\(failure.domain):\(failure.code):\(failure.localizedDescription)"
    output("BLOCKED", false, false, "EFI_CONFIGURATION_FAILED", String(detail.prefix(512)))
    exit(2)
}
