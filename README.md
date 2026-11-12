# GLB Quick Look

Quick Look extension to preview `.glb` / `.gltf` files in the Finder (Space bar) and Spotlight.
3D rendering via three.js r147 (bundled in `Extension/js`, no network access).

- `Extension/PreviewViewController.swift`: loads the file and injects it into a WKWebView
- `Extension/viewer.html`: three.js viewer (auto-rotate, orbit, zoom) with a "Rig" panel:
  - **Bones**: per-bone X/Y/Z rotation sliders, skeleton overlay
  - **Blendshapes**: morph target sliders (e.g. ARKit)
  - **Clips**: baked animation playback (play/pause, scrub, speed)
- `App/`: minimal host app (required to embed the extension)

## Rebuild / reinstall

    ./build.sh

Ad-hoc signing: works on this Mac only. Not supported: Draco/meshopt-compressed models.
`project.yml` (xcodegen) can also generate an Xcode project.
