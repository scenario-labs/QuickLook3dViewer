import SwiftUI

@main
struct GLBQuickLookApp: App {
    var body: some Scene {
        WindowGroup {
            VStack(spacing: 12) {
                Text("GLB Quick Look").font(.title)
                Text("The Quick Look extension for .glb, .gltf, .vox and .spz files is installed.\nSelect one in the Finder and press Space.")
                    .multilineTextAlignment(.center)
            }
            .padding(40)
        }
    }
}
