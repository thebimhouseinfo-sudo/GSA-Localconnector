import AppKit
import Foundation
import Darwin

// Metadata and status are nonsecret. Credentials enter only the concealed field
// and the configure child's private stdin pipe; the app never opens the env file.
func privateJSON(_ filename: String) throws -> [String: Any] {
    let components = filename.split(separator: "/", omittingEmptySubsequences: false)
    guard filename.hasPrefix("/"), components.count > 1,
          !components.dropFirst().contains(where: { $0.isEmpty || $0 == "." || $0 == ".." }) else { throw CocoaError(.fileReadNoPermission) }
    var directory = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    guard directory >= 0 else { throw CocoaError(.fileReadNoPermission) }
    defer { close(directory) }
    for component in components.dropFirst().dropLast() {
        let next = openat(directory, String(component), O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard next >= 0 else { throw CocoaError(.fileReadNoPermission) }
        close(directory); directory = next
    }
    var parent = stat()
    guard fstat(directory, &parent) == 0, parent.st_uid == getuid(), parent.st_mode & 0o777 == 0o700 else { throw CocoaError(.fileReadNoPermission) }
    let file = openat(directory, String(components.last!), O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
    guard file >= 0 else { throw CocoaError(.fileReadNoPermission) }
    defer { close(file) }
    var info = stat()
    guard fstat(file, &info) == 0, info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFREG,
          info.st_mode & 0o777 == 0o600, info.st_nlink == 1, info.st_size <= 16384 else { throw CocoaError(.fileReadNoPermission) }
    var bytes = [UInt8](repeating: 0, count: 16385)
    let count = read(file, &bytes, bytes.count)
    guard count >= 0, count <= 16384,
          let value = try JSONSerialization.jsonObject(with: Data(bytes.prefix(count))) as? [String: Any] else { throw CocoaError(.fileReadCorruptFile) }
    return value
}

@MainActor
final class DesktopApp: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private let statusLine = NSMenuItem(title: "Đang khởi động connector…", action: nil, keyEquivalent: "")
    private var supervisor: Process?
    private var configPath: String?
    private var config: [String: Any] = [:]
    private var statusPath: String?
    private var timer: Timer?
    private var launchFailed = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        if let identifier = Bundle.main.bundleIdentifier,
           NSRunningApplication.runningApplications(withBundleIdentifier: identifier).contains(where: { $0.processIdentifier != getpid() }) {
            NSApp.terminate(nil)
            return
        }
        buildMenuBarItem()
        let arguments = CommandLine.arguments
        var selectedPath: String?
        if arguments.count == 3, arguments[1] == "--desktop-config" { selectedPath = arguments[2] }
        else if arguments.count == 1,
                let location = Bundle.main.url(forResource: "desktop-config-path", withExtension: "txt"),
                let persisted = try? String(contentsOf: location, encoding: .utf8) {
            selectedPath = persisted.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        guard let selectedPath else { setStatus("Thiếu cấu hình connector."); return }
        configPath = selectedPath
        do {
            config = try privateJSON(selectedPath)
            guard let runtime = config["runtimeRoot"] as? String, runtime.hasPrefix("/"),
                  let envPath = config["envPath"] as? String, envPath.hasPrefix("/") else { throw CocoaError(.fileReadCorruptFile) }
            statusPath = config["statusPath"] as? String ?? URL(fileURLWithPath: selectedPath).deletingLastPathComponent().appendingPathComponent("status.json").path
            startSupervisor()
        } catch { launchFailed = true; setStatus("Cấu hình không khả dụng; cần sửa bộ cài.") }
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refreshStatus() }
        }
    }

    private func buildMenuBarItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { _ in
            NSColor.black.setStroke()
            let plug = NSBezierPath(roundedRect: NSRect(x: 2, y: 5, width: 9, height: 7), xRadius: 2, yRadius: 2)
            plug.lineWidth = 1.5
            plug.stroke()
            let wire = NSBezierPath()
            wire.lineWidth = 1.5
            wire.lineCapStyle = .round
            for x in [4.5, 8.5] {
                wire.move(to: NSPoint(x: x, y: 12))
                wire.line(to: NSPoint(x: x, y: 16))
            }
            wire.move(to: NSPoint(x: 6.5, y: 5))
            wire.line(to: NSPoint(x: 6.5, y: 2))
            wire.line(to: NSPoint(x: 10, y: 2))
            wire.stroke()
            let bolt = NSBezierPath()
            bolt.move(to: NSPoint(x: 15, y: 16))
            for point in [NSPoint(x: 11.5, y: 9), NSPoint(x: 14, y: 9), NSPoint(x: 12, y: 3), NSPoint(x: 17, y: 11), NSPoint(x: 14.5, y: 11)] { bolt.line(to: point) }
            bolt.close()
            NSColor.black.setFill()
            bolt.fill()
            return true
        }
        image.isTemplate = true
        item.button?.image = image
        item.button?.setAccessibilityLabel("GSA Local Connector")
        let menu = NSMenu()
        menu.addItem(statusLine)
        menu.addItem(.separator())
        let quit = menu.addItem(withTitle: "Thoát", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
        quit.target = NSApp
        item.menu = menu
        statusItem = item
        setStatus(statusLine.title)
    }

    private func setStatus(_ text: String) {
        statusLine.title = text
        statusItem?.button?.toolTip = "GSA Local Connector: " + text
    }

    private func startSupervisor() {
        guard supervisor?.isRunning != true, let root = config["runtimeRoot"] as? String, let configPath else { return }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: root).appendingPathComponent("bin/node")
        process.arguments = [URL(fileURLWithPath: root).appendingPathComponent("scripts/mac-desktop-adapter.mjs").path, "run", "--desktop-config", configPath]
        process.environment = ProcessInfo.processInfo.environment.filter { ["HOME", "PATH", "TMPDIR"].contains($0.key) }
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] _ in DispatchQueue.main.async { self?.refreshStatus() } }
        supervisor = process
        do { try process.run(); launchFailed = false }
        catch { supervisor = nil; launchFailed = true; setStatus("Không thể khởi động connector.") }
    }

    private func refreshStatus() {
        guard !launchFailed else { return }
        guard let statusPath, let status = try? privateJSON(statusPath), let state = status["state"] as? String else {
            setStatus("Chưa đọc được trạng thái connector.")
            return
        }
        switch state {
        case "SETUP_REQUIRED": setStatus("Cần thiết lập tunnel và API key qua Terminal.")
        case "RUNNING":
            guard supervisor?.isRunning == true else { setStatus("Tiến trình connector đã thoát."); return }
            switch status["connection"] as? String {
            case "CONNECTED": setStatus("Tunnel sẵn sàng.")
            case "CONNECTING": setStatus("Đang chờ máy chủ…")
            default: setStatus("Connector đang chạy; chưa xác minh kết nối.")
            }
        case "STARTING": setStatus("Đang khởi động connector…")
        case "STOPPED": setStatus("Connector đã dừng.")
        default:
            if status["reason"] as? String == "CHILD_EXITED", let code = status["childExitCode"] as? Int {
                setStatus("Tunnel tự kết thúc (mã " + String(code) + ").")
            } else { setStatus("Connector gặp lỗi khởi động.") }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if supervisor?.isRunning == true { setStatus("Connector còn hoạt động; chưa thể thoát an toàn."); return .terminateCancel }
        return .terminateNow
    }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = DesktopApp()
    app.delegate = delegate
    app.run()
}
