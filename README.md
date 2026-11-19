# GLB Quick Look

Quick Look extension to preview `.glb` / `.gltf` 3D models and MagicaVoxel `.vox` files in the Finder (Space bar) and Spotlight.
3D rendering via three.js r147 (bundled in `Extension/js`, no network access).

| Without GLB Quick Look | With GLB Quick Look |
|---|---|
| ![macOS can't preview .glb files](docs/before.png) | ![Interactive 3D preview playing three animation clips in parallel](docs/after.png) |
| macOS can't open `.glb` files in Quick Look. | Interactive 3D preview, plus a **Rig** panel to pose bones, drive blendshapes and play baked animation clips. |

- `Extension/PreviewViewController.swift`: loads the file and injects it into a WKWebView
- `Extension/viewer.html`: three.js viewer (auto-rotate, orbit, zoom) with a "Rig" panel:
  - **Bones**: per-bone X/Y/Z rotation sliders, skeleton overlay
  - **Blendshapes**: morph target sliders (e.g. ARKit)
  - **Clips**: baked animation playback (play/pause, scrub, speed)
- `Extension/vox.html`: `.vox` viewer in **sprite stacking**: the model is cut into one pixel-art slice per Z layer, then the slices are stacked and rotated (2D canvas, no WebGL).
  Drag to rotate (horizontal) and tilt (vertical), scroll to zoom, double-click to refit. The **Stack** panel sets rotation, tilt, zoom, layer spacing (explode the stack), highlights a layer and toggles the drop shadow.
  Only the first model of a multi-model `.vox` is shown.
- `App/`: minimal host app (required to embed the extension; it also declares the `.vox` type, `com.ephtracy.magicavoxel.vox`)

## Install

    curl -fsSL https://raw.githubusercontent.com/VieVie31/GLBPreview/main/install.sh | sh

Downloads the latest release into `~/Applications` and registers the extension. Then select a `.glb` in the Finder and press Space.
Universal binary (Apple Silicon + Intel), macOS 13+.

The app is ad-hoc signed, not notarized. If you download the zip from the Releases page with a browser instead, macOS will block it:
unzip it, move it to `~/Applications`, then run `xattr -dr com.apple.quarantine ~/Applications/GLBQuickLook.app` and open it once.

## Build from source

Requires the Xcode Command Line Tools (`xcode-select --install`).

    ./build.sh             # build (universal), package to dist/, install via install.sh
    ./build.sh --package   # only produce dist/GLBQuickLook.zip

## Release

Push a tag: `git tag v1.1 && git push origin v1.1`. The GitHub Action builds the zip and attaches it to the release.

Not supported: Draco/meshopt-compressed models.
`project.yml` (xcodegen) can also generate an Xcode project.
