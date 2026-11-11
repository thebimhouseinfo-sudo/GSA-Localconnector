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
    private var pauseItem: NSMenuItem?
    private var resumeItem: NSMenuItem?
    private var pruneItem: NSMenuItem?
    private var supervisor: Process?
    private var configPath: String?
    private var config: [String: Any] = [:]
    private var statusPath: String?
    private var timer: Timer?
    private var launchFailed = false
    private var quitRequested = false
    private var quitAttemptBaseline = 0
    private var quitRequestedAt: Date?
    private var pruneRequested = false
    private var pruneAttemptBaseline = 0
    private var pruneRequestedAt: Date?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
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
        let pause = menu.addItem(withTitle: "Tạm dừng tác vụ mới", action: #selector(requestPause(_:)), keyEquivalent: "")
        pause.target = self
        pause.isEnabled = false
        pauseItem = pause
        let resume = menu.addItem(withTitle: "Tiếp tục", action: #selector(requestResume(_:)), keyEquivalent: "")
        resume.target = self
        resume.isEnabled = false
        resumeItem = resume
        menu.addItem(.separator())
        let prune = menu.addItem(withTitle: "Dọn đăng ký cũ…", action: #selector(requestPrune(_:)), keyEquivalent: "")
        prune.target = self
        prune.isEnabled = false
        pruneItem = prune
        menu.addItem(.separator())
        let quit = menu.addItem(withTitle: "Thoát", action: #selector(requestQuit(_:)), keyEquivalent: "")
        quit.target = self
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
        if pruneRequested {
            if let statusPath, let status = try? privateJSON(statusPath),
               let attempt = status["registrationPruneAttempt"] as? Int,
               attempt > pruneAttemptBaseline {
                pruneRequested = false
                pruneRequestedAt = nil
                if status["registrationPruneStatus"] as? String == "DONE",
                   let summary = status["registrationPruneSummary"] as? [String: Any] {
                    let stale = summary["removed_stale"] as? Int ?? 0
                    let revoked = summary["removed_revoked"] as? Int ?? 0
                    setStatus("Đã dọn " + String(stale + revoked) + " đăng ký cũ; workspace đang dùng được giữ nguyên.")
                } else {
                    setStatus("Không thể dọn đăng ký cũ; kiểm tra trạng thái connector.")
                }
                return
            }
            if let started = pruneRequestedAt, Date().timeIntervalSince(started) > 10 {
                pruneRequested = false
                pruneRequestedAt = nil
                setStatus("Chưa xác nhận kết quả dọn đăng ký; kiểm tra lại trạng thái.")
                return
            }
            setStatus("Đang dọn các đăng ký không còn hiệu lực…")
            return
        }
        if quitRequested {
            if supervisor?.isRunning != true {
                quitRequested = false
                quitRequestedAt = nil
                NSApp.terminate(nil)
                return
            }
            if let statusPath, let status = try? privateJSON(statusPath),
               let attempt = status["stopAttempt"] as? Int, attempt > quitAttemptBaseline {
                let reason = status["stopBlockedReason"] as? String ?? "STOP_UNCONFIRMED"
                quitRequested = false
                quitRequestedAt = nil
                switch reason {
                case "ACTIVE_WORK_PRESENT": setStatus("Không thể thoát: còn tác vụ đang chạy.")
                case "ACTIVE_WORK_UNKNOWN": setStatus("Không thể thoát: chưa xác minh tác vụ đã dừng.")
                default: setStatus("Không thể xác nhận dừng connector: " + reason)
                }
                return
            }
            if let started = quitRequestedAt, Date().timeIntervalSince(started) > 10 {
                quitRequested = false
                quitRequestedAt = nil
                setStatus("Yêu cầu thoát không được phản hồi; connector vẫn hoạt động.")
                return
            }
            setStatus("Đang yêu cầu dừng connector an toàn…")
            return
        }
        guard !launchFailed else { return }
        guard let statusPath, let status = try? privateJSON(statusPath), let state = status["state"] as? String else {
            setStatus("Chưa đọc được trạng thái connector.")
            return
        }
        let paused = status["desktopPaused"] as? Bool ?? false
        pauseItem?.isEnabled = state == "RUNNING" && supervisor?.isRunning == true && !paused
        resumeItem?.isEnabled = state == "RUNNING" && supervisor?.isRunning == true && paused
        pruneItem?.isEnabled = state == "RUNNING" && supervisor?.isRunning == true
        if state == "RUNNING" && paused {
            setStatus("Đã tạm dừng nhận tác vụ mới.")
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

    // Signals target only the retained adapter Process object, never arbitrary PIDs.
    // The adapter updates the private admission flag; existing work continues.
    @objc private func requestPause(_ sender: Any?) {
        guard let process = supervisor, process.isRunning else { return }
        if kill(pid_t(process.processIdentifier), SIGUSR2) == 0 {
            setStatus("Đang tạm dừng nhận tác vụ mới…")
        } else { setStatus("Không gửi được yêu cầu tạm dừng.") }
    }

    @objc private func requestResume(_ sender: Any?) {
        guard let process = supervisor, process.isRunning else { return }
        if kill(pid_t(process.processIdentifier), SIGHUP) == 0 {
            setStatus("Đang tiếp tục nhận tác vụ…")
        } else { setStatus("Không gửi được yêu cầu tiếp tục.") }
    }

    // SIGWINCH is handled by the retained adapter only; it never kills a
    // process or revokes an ACTIVE workspace. The protected grant lock ensures
    // a bind cannot race with compaction.
    @objc private func requestPrune(_ sender: Any?) {
        guard !quitRequested && !pruneRequested, let process = supervisor, process.isRunning else { return }
        pruneAttemptBaseline = (statusPath.flatMap { try? privateJSON($0) }?["registrationPruneAttempt"] as? Int) ?? 0
        if kill(pid_t(process.processIdentifier), SIGWINCH) == 0 {
            pruneRequestedAt = Date()
            pruneRequested = true
            setStatus("Đang dọn các đăng ký không còn hiệu lực…")
        } else { setStatus("Không gửi được yêu cầu dọn đăng ký.") }
    }

    @objc private func requestQuit(_ sender: Any?) {
        guard !quitRequested else { return }
        guard let process = supervisor, process.isRunning else { NSApp.terminate(nil); return }
        // Only signal our retained supervisor. It decides whether its owned tunnel
        // can stop; ACTIVE/UNKNOWN work must never be force-killed by the GUI.
        quitAttemptBaseline = (statusPath.flatMap { try? privateJSON($0) }?["stopAttempt"] as? Int) ?? 0
        quitRequestedAt = Date()
        quitRequested = true
        setStatus("Đang yêu cầu dừng connector an toàn…")
        process.terminate()
    }

    // Provide the same bounded cleanup from the actual macOS Dock context menu,
    // in addition to the status-bar icon menu.
    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let menu = NSMenu()
        let prune = menu.addItem(withTitle: "Dọn đăng ký cũ…", action: #selector(requestPrune(_:)), keyEquivalent: "")
        prune.target = self
        prune.isEnabled = pruneItem?.isEnabled ?? false
        return menu
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
