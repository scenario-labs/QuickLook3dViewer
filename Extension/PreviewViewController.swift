import Cocoa
import Quartz
import WebKit

final class PreviewViewController: NSViewController, QLPreviewingController {
    private var webView: WKWebView!

    override var nibName: NSNib.Name? { nil }

    override func loadView() {
        let config = WKWebViewConfiguration()
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 800, height: 600), configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.setValue(false, forKey: "drawsBackground")
        view = webView
        preferredContentSize = NSSize(width: 800, height: 600)
    }

    func preparePreviewOfFile(at url: URL, completionHandler handler: @escaping (Error?) -> Void) {
        do {
            let data = try Data(contentsOf: url)
            let bundle = Bundle(for: PreviewViewController.self)
            func resource(_ name: String, _ ext: String) throws -> String {
                guard let u = bundle.url(forResource: name, withExtension: ext) else {
                    throw CocoaError(.fileNoSuchFile)
                }
                return try String(contentsOf: u, encoding: .utf8)
            }
            let scripts = try ["three.min", "GLTFLoader", "OrbitControls", "RoomEnvironment"]
                .map { "<script>\(try resource($0, "js"))</script>" }
                .joined(separator: "\n")
            var html = try resource("viewer", "html")
            html = html.replacingOccurrences(of: "__MODEL_B64__", with: data.base64EncodedString())
            html = html.replacingOccurrences(of: "<!--SCRIPTS-->", with: scripts)
            webView.loadHTMLString(html, baseURL: nil)
            handler(nil)
        } catch {
            handler(error)
        }
    }
}
