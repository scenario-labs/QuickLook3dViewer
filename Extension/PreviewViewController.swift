import Cocoa
import Quartz
import WebKit

/// Serves in-memory files at glbql://preview/<name>. Used for large files (.spz splats) so the
/// model is fetched as binary instead of being inlined as base64 in the HTML.
final class PreviewSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "glbql"
    var files: [String: (data: Data, mime: String)] = [:]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let file = files[url.lastPathComponent] else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let headers = ["Content-Type": file.mime, "Content-Length": String(file.data.count)]
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(file.data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// Diagnostics: appended to Library/Caches/preview.log in the extension's sandbox container
/// (~/Library/Containers/local.olivier.GLBQuickLook.GLBPreview/Data/Library/Caches/preview.log).
func previewLog(_ message: String) {
    guard let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
    let url = dir.appendingPathComponent("preview.log")
    let line = "\(ISO8601DateFormatter().string(from: Date())) \(message)\n"
    if let h = try? FileHandle(forWritingTo: url) { h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close() }
    else { try? line.data(using: .utf8)!.write(to: url) }
}

final class PreviewViewController: NSViewController, QLPreviewingController, WKNavigationDelegate, WKScriptMessageHandler {
    private var webView: WKWebView!
    private let schemeHandler = PreviewSchemeHandler()

    override var nibName: NSNib.Name? { nil }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(schemeHandler, forURLScheme: PreviewSchemeHandler.scheme)
        // Forward page errors to the log
        config.userContentController.add(self, name: "log")
        config.userContentController.addUserScript(WKUserScript(source: """
            addEventListener('error', e => webkit.messageHandlers.log.postMessage('js error: ' + e.message + ' @' + (e.filename||'') + ':' + e.lineno));
            addEventListener('unhandledrejection', e => webkit.messageHandlers.log.postMessage('js rejection: ' + (e.reason && e.reason.message || e.reason)));
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 800, height: 600), configuration: config)
        webView.navigationDelegate = self
        if #available(macOS 13.3, *) { webView.isInspectable = true }
        webView.autoresizingMask = [.width, .height]
        webView.setValue(false, forKey: "drawsBackground")
        view = webView
        preferredContentSize = NSSize(width: 800, height: 600)
    }

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) { previewLog("\(message.body)") }
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) { previewLog("page loaded: \(w.url?.absoluteString ?? "html string")") }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { previewLog("navigation failed: \(e)") }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { previewLog("provisional navigation failed: \(e)") }
    func webViewWebContentProcessDidTerminate(_ w: WKWebView) { previewLog("web content process terminated") }

    func preparePreviewOfFile(at url: URL, completionHandler handler: @escaping (Error?) -> Void) {
        previewLog("prepare \(url.lastPathComponent)")
        do {
            let data = try Data(contentsOf: url)
            let bundle = Bundle(for: PreviewViewController.self)
            func resource(_ name: String, _ ext: String) throws -> String {
                guard let u = bundle.url(forResource: name, withExtension: ext) else {
                    throw CocoaError(.fileNoSuchFile)
                }
                return try String(contentsOf: u, encoding: .utf8)
            }
            switch url.pathExtension.lowercased() {
            case "spz":
                // Gaussian splats: page and model served by the scheme handler (binary fetch, gunzip in the page)
                schemeHandler.files = [
                    "index.html": (Data(try resource("splat", "html").utf8), "text/html"),
                    "model.spz": (data, "application/octet-stream"),
                ]
                webView.load(URLRequest(url: URL(string: "\(PreviewSchemeHandler.scheme)://preview/index.html")!))
            case "ipynb":
                // Jupyter notebook: page, markdown lib and notebook served by the scheme handler (CSP blocks notebook scripts)
                guard let marked = bundle.url(forResource: "marked.min", withExtension: "js") else { throw CocoaError(.fileNoSuchFile) }
                schemeHandler.files = [
                    "index.html": (Data(try resource("notebook", "html").utf8), "text/html"),
                    "marked.min.js": (try Data(contentsOf: marked), "application/javascript"),
                    "notebook.ipynb": (data, "application/json"),
                ]
                webView.load(URLRequest(url: URL(string: "\(PreviewSchemeHandler.scheme)://preview/index.html")!))
            case "vox":
                // MagicaVoxel -> sprite stacking viewer (2D canvas)
                let html = try resource("vox", "html").replacingOccurrences(of: "__MODEL_B64__", with: data.base64EncodedString())
                webView.loadHTMLString(html, baseURL: nil)
            default:
                // .glb / .gltf -> three.js viewer
                let scripts = try ["three.min", "GLTFLoader", "OrbitControls", "RoomEnvironment"]
                    .map { "<script>\(try resource($0, "js"))</script>" }
                    .joined(separator: "\n")
                var html = try resource("viewer", "html")
                html = html.replacingOccurrences(of: "__MODEL_B64__", with: data.base64EncodedString())
                html = html.replacingOccurrences(of: "<!--SCRIPTS-->", with: scripts)
                webView.loadHTMLString(html, baseURL: nil)
            }
            handler(nil)
        } catch {
            previewLog("prepare failed: \(error)")
            handler(error)
        }
    }
}
