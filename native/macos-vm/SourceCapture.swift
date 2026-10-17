// Trusted-supervisor-only read-only capture. This does not certify VM isolation.
// stdin: gsa-source-capture-v1, canonicalRoot, optional maxFiles/maxBytes,
// optional excludeNames (portable single names; defaults .git,node_modules).
// Exclusions apply at every depth and are explicitly returned as excludedNames.
import Foundation
import Darwin
import CryptoKit

let captureProtocol = "gsa-source-capture-v1"
struct CaptureFailure: Error { let code: String }
func fail(_ code: String = "SOURCE_UNVERIFIED") throws -> Never { throw CaptureFailure(code: code) }
func info(_ fd: Int32) throws -> stat {
    var value = stat()
    guard fstat(fd, &value) == 0 else { try fail() }
    return value
}
func same(_ a: stat, _ b: stat) -> Bool {
    a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_mode == b.st_mode &&
    a.st_nlink == b.st_nlink && a.st_size == b.st_size &&
    a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec &&
    a.st_ctimespec.tv_sec == b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec == b.st_ctimespec.tv_nsec
}
func validSegment(_ name: String) -> Bool {
    guard !name.isEmpty, name != ".", name != "..", !name.hasSuffix("."), !name.hasSuffix(" "),
          !name.contains("/"), !name.contains("\\"), !name.contains(":"),
          !name.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else { return false }
    return name.range(of: "^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])([.]|$)", options: [.regularExpression, .caseInsensitive]) == nil
}
func childStat(_ fd: Int32, _ name: String) throws -> stat {
    var value = stat()
    guard fstatat(fd, name, &value, AT_SYMLINK_NOFOLLOW) == 0 else { try fail() }
    return value
}
func names(_ fd: Int32) throws -> [String] {
    let copy = dup(fd)
    guard copy >= 0 else { try fail() }
    guard let stream = fdopendir(copy) else { close(copy); try fail() }
    defer { closedir(stream) }
    rewinddir(stream)
    var result: [String] = []
    while true {
        errno = 0
        guard let entry = readdir(stream) else {
            guard errno == 0 else { try fail() }
            break
        }
        let name: String? = withUnsafePointer(to: &entry.pointee.d_name) {
            $0.withMemoryRebound(to: CChar.self, capacity: Int(entry.pointee.d_namlen) + 1) { String(validatingCString: $0) }
        }
        guard let name else { try fail() }
        if name == "." || name == ".." { continue }
        guard result.count < 8192 else { try fail("SOURCE_LIMIT_EXCEEDED") }
        result.append(name)
    }
    return result.sorted()
}

final class Snapshot {
    let maxFiles: Int
    let maxBytes: Int
    let excludes: Set<String>
    var files: [[String: Any]] = []
    var totalBytes = 0
    var observed: [String: stat] = [:]
    var listings: [String: [String]] = [:]
    init(maxFiles: Int, maxBytes: Int, excludes: [String]) {
        self.maxFiles = maxFiles; self.maxBytes = maxBytes; self.excludes = Set(excludes)
    }
    func walk(_ fd: Int32, _ prefix: String = "", _ depth: Int = 0, verify: Bool = false) throws {
        guard depth <= 128 else { try fail("SOURCE_LIMIT_EXCEEDED") }
        let before = try info(fd)
        let children = try names(fd)
        if verify {
            guard listings[prefix] == children, let saved = observed[prefix], same(saved, before) else { try fail() }
        } else {
            guard observed.count < 8192 else { try fail("SOURCE_LIMIT_EXCEEDED") }
            observed[prefix] = before; listings[prefix] = children
        }
        for name in children {
            guard validSegment(name) else { try fail("SOURCE_UNSAFE_PATH") }
            let relative = prefix.isEmpty ? name : prefix + "/" + name
            guard relative.utf16.count <= 4096 else { try fail("SOURCE_UNSAFE_PATH") }
            let initial = try childStat(fd, name)
            let kind = initial.st_mode & S_IFMT
            // Reject unsupported entries even if their names were excluded.
            guard kind == S_IFDIR || kind == S_IFREG, kind != S_IFREG || initial.st_nlink == 1 else { try fail() }
            if excludes.contains(name) { continue }
            if verify {
                guard let saved = observed[relative], same(saved, initial) else { try fail() }
            }
            let flags = O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC | (kind == S_IFDIR ? O_DIRECTORY : 0)
            let child = openat(fd, name, flags)
            guard child >= 0 else { try fail() }
            defer { close(child) }
            let opened = try info(child)
            guard same(initial, opened) else { try fail() }
            if kind == S_IFDIR {
                try walk(child, relative, depth + 1, verify: verify)
            } else if !verify {
                guard files.count < maxFiles, opened.st_size >= 0, opened.st_size <= maxBytes - totalBytes else { try fail("SOURCE_LIMIT_EXCEEDED") }
                let expected = Int(opened.st_size)
                var data = Data()
                var buffer = [UInt8](repeating: 0, count: 65536)
                while data.count < expected {
                    let amount = min(buffer.count, expected - data.count)
                    let count = read(child, &buffer, amount)
                    if count < 0 && errno == EINTR { continue }
                    guard count > 0 else { try fail() }
                    data.append(contentsOf: buffer.prefix(count))
                }
                var extra: UInt8 = 0
                guard read(child, &extra, 1) == 0, same(opened, try info(child)) else { try fail() }
                observed[relative] = opened
                totalBytes += data.count
                files.append(["path": relative, "base64": data.base64EncodedString(),
                              "sha256": SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(), "size": data.count,
                              "executable": opened.st_mode & 0o111 != 0])
            }
            guard same(initial, try info(child)), same(initial, try childStat(fd, name)) else { try fail() }
        }
        guard same(before, try info(fd)) else { try fail() }
    }
}

func integer(_ request: [String: Any], _ key: String, _ fallback: Int, _ maximum: Int) throws -> Int {
    guard let raw = request[key] else { return fallback }
    guard let number = raw as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
          number.doubleValue.rounded() == number.doubleValue,
          number.doubleValue >= 1, number.doubleValue <= Double(maximum) else { try fail("INVALID_REQUEST") }
    return number.intValue
}
import CoreFoundation
func capture() throws -> [String: Any] {
    var input = Data()
    var buffer = [UInt8](repeating: 0, count: 1024)
    while true {
        let count = read(STDIN_FILENO, &buffer, min(buffer.count, 8193 - input.count))
        if count < 0 && errno == EINTR { continue }
        guard count >= 0 else { try fail("INVALID_REQUEST") }
        if count == 0 { break }
        input.append(contentsOf: buffer.prefix(count))
        guard input.count <= 8192 else { try fail("INVALID_REQUEST") }
    }
    guard let request = (try? JSONSerialization.jsonObject(with: input)) as? [String: Any],
          request["protocolVersion"] as? String == captureProtocol,
          let root = request["canonicalRoot"] as? String, root.hasPrefix("/"), root.utf8.count <= 4096,
          !root.utf8.contains(0) else { try fail("INVALID_REQUEST") }
    let maxFiles = try integer(request, "maxFiles", 1000, 2000)
    let maxBytes = try integer(request, "maxBytes", 16777216, 33554432)
    var excluded = [".git", "node_modules"]
    if let raw = request["excludeNames"] {
        guard let values = raw as? [String], values.count <= 100, values.allSatisfy(validSegment) else { try fail("INVALID_REQUEST") }
        excluded = Array(Set(values)).sorted()
    }
    guard let resolved = realpath(root, nil) else { try fail() }
    let canonical = String(cString: resolved)
    free(resolved)
    guard canonical == root else { try fail("SOURCE_UNSAFE_PATH") }
    var initial = stat()
    guard lstat(root, &initial) == 0, initial.st_mode & S_IFMT == S_IFDIR else { try fail() }
    // Resolve every ancestor through a held directory descriptor. A path-based
    // open of root could follow an ancestor swapped after realpath/lstat.
    var fd = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    guard fd >= 0 else { try fail() }
    defer { close(fd) }
    for component in root.split(separator: "/", omittingEmptySubsequences: true) {
        let next = openat(fd, String(component), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard next >= 0 else { try fail() }
        close(fd); fd = next
    }
    guard same(initial, try info(fd)) else { try fail() }
    let snapshot = Snapshot(maxFiles: maxFiles, maxBytes: maxBytes, excludes: excluded)
    try snapshot.walk(fd)
    try snapshot.walk(fd, verify: true)
    var final = stat()
    guard lstat(root, &final) == 0, same(initial, final), same(initial, try info(fd)) else { try fail() }
    return ["protocolVersion": captureProtocol, "state": "CAPTURED", "canonicalRoot": root,
            "files": snapshot.files.sorted { ($0["path"] as! String) < ($1["path"] as! String) }, "totalBytes": snapshot.totalBytes,
            "rootIdentity": ["device": UInt64(initial.st_dev), "inode": UInt64(initial.st_ino)],
            "excludedNames": excluded, "securityVerified": false]
}
var exitStatus: Int32 = 0
let output: [String: Any]
do { output = try capture() }
catch {
    exitStatus = 2
    output = ["protocolVersion": captureProtocol, "state": "BLOCKED", "code": (error as? CaptureFailure)?.code ?? "SOURCE_UNVERIFIED", "securityVerified": false]
}
if let data = try? JSONSerialization.data(withJSONObject: output, options: [.sortedKeys]) {
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}
exit(exitStatus)
