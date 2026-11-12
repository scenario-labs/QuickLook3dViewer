#!/bin/zsh
# Builds GLB Quick Look without xcodebuild, installs it to ~/Applications and registers the extension.
set -e
cd "$(dirname "$0")"
rm -rf out; A=out/GLBQuickLook.app; E=$A/Contents/PlugIns/GLBPreview.appex
mkdir -p $A/Contents/MacOS $E/Contents/MacOS $E/Contents/Resources
SDK=$(xcrun --sdk macosx --show-sdk-path)
swiftc -O -sdk $SDK -target arm64-apple-macos13.0 -application-extension -module-name GLBPreview -parse-as-library \
  Extension/PreviewViewController.swift -o $E/Contents/MacOS/GLBPreview \
  -framework Cocoa -framework Quartz -framework WebKit -Xlinker -e -Xlinker _NSExtensionMain
cp Extension/viewer.html Extension/js/*.js $E/Contents/Resources/
sed -e 's/$(DEVELOPMENT_LANGUAGE)/en/; s/$(EXECUTABLE_NAME)/GLBPreview/; s/$(PRODUCT_BUNDLE_IDENTIFIER)/local.olivier.GLBQuickLook.GLBPreview/; s/$(PRODUCT_NAME)/GLBPreview/; s/$(PRODUCT_MODULE_NAME)/GLBPreview/' Extension/Info.plist > $E/Contents/Info.plist
swiftc -O -sdk $SDK -target arm64-apple-macos13.0 -module-name GLBQuickLook -parse-as-library App/App.swift -o $A/Contents/MacOS/GLBQuickLook
cp App/Info.plist $A/Contents/Info.plist
codesign -f -s - --entitlements Extension/Extension.entitlements $E
codesign -f -s - --entitlements App/App.entitlements $A
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
# Update in place (rsync) instead of rm + cp: a delete event processed late by pkd unregisters the extension
mkdir -p ~/Applications/GLBQuickLook.app && rsync -a --delete $A/ ~/Applications/GLBQuickLook.app/
# Keep a single registered copy: a copy in out/ (same bundle id) makes pkd drop the extension
$LSREG -u "$PWD/$A" 2>/dev/null || true; rm -rf out
$LSREG -f ~/Applications/GLBQuickLook.app
pluginkit -a ~/Applications/GLBQuickLook.app/Contents/PlugIns/GLBPreview.appex
pluginkit -e use -i local.olivier.GLBQuickLook.GLBPreview
qlmanage -r >/dev/null 2>&1; qlmanage -r cache >/dev/null 2>&1
# Check after a delay: pkd can drop the extension a few seconds after registration
sleep 5; pluginkit -m -i local.olivier.GLBQuickLook.GLBPreview | grep -q GLB || pluginkit -a ~/Applications/GLBQuickLook.app/Contents/PlugIns/GLBPreview.appex
for i in 1 2 3 4 5; do pluginkit -m -i local.olivier.GLBQuickLook.GLBPreview | grep -q GLB && break; sleep 1; done
pluginkit -m -i local.olivier.GLBQuickLook.GLBPreview | grep -q GLB || { echo "⚠️  Extension not registered by pluginkit" >&2; exit 1; }
echo "Installed and registered: ~/Applications/GLBQuickLook.app"
