import SwiftUI

@main
struct GLBQuickLookApp: App {
    var body: some Scene {
        WindowGroup {
            VStack(spacing: 12) {
                Text("GLB Quick Look").font(.title)
                Text("L'extension Quick Look pour les fichiers .glb est installée.\nSélectionne un .glb dans le Finder et appuie sur Espace.")
                    .multilineTextAlignment(.center)
            }
            .padding(40)
        }
    }
}
