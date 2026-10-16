// GSA-Localconnector Virtualization.framework preflight.
// Read-only: does not initialize, download, install or launch a VM.
// Compile on Apple Silicon with: swiftc -framework Virtualization CapabilityProbe.swift -o /tmp/gsa-vm-probe
import Foundation
import Virtualization

struct Probe: Encodable {
    let host: String
    let osVersion: String
    let architecture: String
    let virtualizationFramework: Bool
    let guest: String
    let entitlementPresent: Bool?
    let securityVerified: Bool
    let workerImplemented: Bool
    let codeSignatureTeamIdentifierPresent: Bool?
}

let arch: String = {
    #if arch(arm64)
    return "arm64"
    #elseif arch(x86_64)
    return "x86_64"
    #else
    return "unknown"
    #endif
}()
let report = Probe(
    host: "macos",
    osVersion: ProcessInfo.processInfo.operatingSystemVersionString,
    architecture: arch,
    virtualizationFramework: true,
    guest: "linux-arm64-candidate",
    entitlementPresent: nil,
    securityVerified: false,
    workerImplemented: false,
    codeSignatureTeamIdentifierPresent: nil
)
let encoded = try JSONEncoder().encode(report)
print(String(decoding: encoded, as: UTF8.self))
