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

final class PreviewViewController: NSViewController, QLPreviewingController {
    private var webView: WKWebView!
    private let schemeHandler = PreviewSchemeHandler()

    override var nibName: NSNib.Name? { nil }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(schemeHandler, forURLScheme: PreviewSchemeHandler.scheme)
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
            handler(error)
        }
    }
}
