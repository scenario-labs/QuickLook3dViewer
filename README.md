# GLB Quick Look

Extension Quick Look pour prévisualiser les fichiers `.glb` / `.gltf` dans le Finder (barre d'espace).
Rendu 3D via three.js r147 (inclus dans `Extension/js`, aucun accès réseau).

- `Extension/PreviewViewController.swift` : charge le fichier et l'injecte dans une WKWebView
- `Extension/viewer.html` : visionneuse three.js (rotation auto, orbite, zoom, panneau « Rig » : sliders de rotation X/Y/Z par os + sliders de blendshapes / morph targets, ex. ARKit + lecture des clips d’animation baked)
- `App/` : app hôte minimale (nécessaire pour embarquer l'extension)

## Recompiler / réinstaller

    ./build.sh

Signature ad-hoc : fonctionne sur ce Mac uniquement. Non supporté : modèles compressés Draco/meshopt.
`project.yml` (xcodegen) permet aussi de générer un projet Xcode.
