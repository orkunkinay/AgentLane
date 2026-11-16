// Read-only public API observer. Never posts events, activates apps or records titles.
import AppKit
import Foundation
let started = Date()
var previousPID: pid_t = -1
var previousWindow = -1
var previousPoint = NSPoint(x: -99999, y: -99999)
func emit(_ event: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: event), let line = String(data: data, encoding: .utf8) {
        print(line); fflush(stdout)
    }
}
let spaceObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { _ in
    emit(["event": "spaceChanged", "ms": Date().timeIntervalSince(started) * 1000])
}
let timer = Timer.scheduledTimer(withTimeInterval: 0.01, repeats: true) { _ in
    let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
    let point = NSEvent.mouseLocation
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    let frontWindow = windows.first { ($0[kCGWindowOwnerPID as String] as? Int) == Int(pid) && ($0[kCGWindowLayer as String] as? Int) == 0 }?[kCGWindowNumber as String] as? Int ?? -1
    if pid != previousPID || point != previousPoint || frontWindow != previousWindow {
        emit(["event": "sample", "ms": Date().timeIntervalSince(started) * 1000, "pid": pid, "window": frontWindow, "x": point.x, "y": point.y])
        previousPID = pid; previousPoint = point; previousWindow = frontWindow
    }
}
RunLoop.main.run()
