#!/bin/sh
# Installs GLB Quick Look to ~/Applications and registers the Quick Look extension.
#   curl -fsSL https://raw.githubusercontent.com/scenario-labs/QuickLook3dViewer/main/install.sh | sh
#   sh install.sh --local dist/GLBQuickLook.zip     (install a locally built zip)
#
# Files downloaded with curl don't get the quarantine flag, so Gatekeeper doesn't block this
# ad-hoc signed (non-notarized) build. The quarantine flag is also stripped explicitly below.
set -e

REPO="scenario-labs/QuickLook3dViewer"
URL="https://github.com/$REPO/releases/latest/download/GLBQuickLook.zip"
DEST="$HOME/Applications/GLBQuickLook.app"
EXT_ID="local.olivier.GLBQuickLook.GLBPreview"
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

[ "$(uname)" = "Darwin" ] || { echo "macOS only." >&2; exit 1; }

TMP=$(mktemp -d)
cleanup() {
  if [ -d "$TMP/GLBQuickLook.app" ]; then "$LSREG" -u "$TMP/GLBQuickLook.app" 2>/dev/null || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

if [ "$1" = "--local" ]; then
  ZIP="$2"; [ -f "$ZIP" ] || { echo "Zip not found: $ZIP" >&2; exit 1; }
else
  echo "Downloading $URL"
  ZIP="$TMP/GLBQuickLook.zip"
  curl -fL --progress-bar -o "$ZIP" "$URL"
fi
ditto -x -k "$ZIP" "$TMP"
[ -d "$TMP/GLBQuickLook.app" ] || { echo "Invalid archive (GLBQuickLook.app missing)." >&2; exit 1; }

# Update in place (rsync) instead of rm + cp: a delete event processed late by pkd unregisters the extension
mkdir -p "$DEST"
rsync -a --delete "$TMP/GLBQuickLook.app/" "$DEST/"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

# Only the installed copy may stay registered (same bundle id elsewhere makes pkd drop the extension)
cleanup; trap - EXIT
"$LSREG" -f "$DEST"
pluginkit -a "$DEST/Contents/PlugIns/GLBPreview.appex"
pluginkit -e use -i "$EXT_ID"
# .vox / .spz / .ipynb files indexed before install keep a dynamic type (dyn.*) in Spotlight, so the Finder doesn't route
# them to the extension: re-import them so they pick up the types declared by the app
mdfind "kMDItemFSName == '*.vox'c || kMDItemFSName == '*.spz'c || kMDItemFSName == '*.ipynb'c || kMDItemFSName == '*.blend'c" 2>/dev/null | while IFS= read -r f; do mdimport "$f" 2>/dev/null || true; done
qlmanage -r >/dev/null 2>&1 || true; qlmanage -r cache >/dev/null 2>&1 || true

# pkd can drop the extension a few seconds after registration: check again after a delay
registered() { pluginkit -m -i "$EXT_ID" | grep -q GLB; }
sleep 5
registered || pluginkit -a "$DEST/Contents/PlugIns/GLBPreview.appex"
i=0; while [ $i -lt 5 ] && ! registered; do sleep 1; i=$((i+1)); done
registered || { echo "⚠️  Extension not registered. Open $DEST once, then check System Settings > General > Login Items & Extensions > Quick Look." >&2; exit 1; }

echo "✅ Installed: $DEST"
echo "   Select a .glb, .gltf, .fbx, .blend, .vox, .spz or .ipynb file in the Finder and press Space."
