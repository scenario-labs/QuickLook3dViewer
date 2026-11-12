#!/bin/zsh
# Compile GLB Quick Look sans xcodebuild, l'installe dans ~/Applications et enregistre l'extension.
set -e
cd "$(dirname "$0")"
rm -rf out; A=out/GLBQuickLook.app; E=$A/Contents/PlugIns/GLBPreview.appex
mkdir -p $A/Contents/MacOS $E/Contents/MacOS $E/Contents/Resources
SDK=$(xcrun --sdk macosx --show-sdk-path)
swiftc -O -sdk $SDK -target arm64-apple-macos13.0 -application-extension -module-name GLBPreview -parse-as-library \
  Extension/PreviewViewController.swift -o $E/Contents/MacOS/GLBPreview \
  -framework Cocoa -framework Quartz -framework WebKit -Xlinker -e -Xlinker _NSExtensionMain
cp Extension/viewer.html Extension/js/*.js $E/Contents/Resources/
sed -e 's/$(DEVELOPMENT_LANGUAGE)/fr/; s/$(EXECUTABLE_NAME)/GLBPreview/; s/$(PRODUCT_BUNDLE_IDENTIFIER)/local.olivier.GLBQuickLook.GLBPreview/; s/$(PRODUCT_NAME)/GLBPreview/; s/$(PRODUCT_MODULE_NAME)/GLBPreview/' Extension/Info.plist > $E/Contents/Info.plist
swiftc -O -sdk $SDK -target arm64-apple-macos13.0 -module-name GLBQuickLook -parse-as-library App/App.swift -o $A/Contents/MacOS/GLBQuickLook
cp App/Info.plist $A/Contents/Info.plist
codesign -f -s - --entitlements Extension/Extension.entitlements $E
codesign -f -s - --entitlements App/App.entitlements $A
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
mkdir -p ~/Applications && rm -rf ~/Applications/GLBQuickLook.app && cp -R $A ~/Applications/
# Ne garder qu'une seule copie enregistrée : une copie dans out/ (même bundle id) fait perdre l'extension à pkd
$LSREG -u "$PWD/$A" 2>/dev/null || true; rm -rf out
$LSREG -f ~/Applications/GLBQuickLook.app
pluginkit -a ~/Applications/GLBQuickLook.app/Contents/PlugIns/GLBPreview.appex
pluginkit -e use -i local.olivier.GLBQuickLook.GLBPreview
qlmanage -r >/dev/null 2>&1; qlmanage -r cache >/dev/null 2>&1
for i in 1 2 3 4 5; do pluginkit -m -i local.olivier.GLBQuickLook.GLBPreview | grep -q GLB && break; sleep 1; done
pluginkit -m -i local.olivier.GLBQuickLook.GLBPreview | grep -q GLB || { echo "⚠️  Extension non enregistrée par pluginkit" >&2; exit 1; }
echo "Installé et enregistré : ~/Applications/GLBQuickLook.app"
