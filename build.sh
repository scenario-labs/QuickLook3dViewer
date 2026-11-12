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
mkdir -p ~/Applications && rm -rf ~/Applications/GLBQuickLook.app && cp -R $A ~/Applications/
pluginkit -a ~/Applications/GLBQuickLook.app/Contents/PlugIns/GLBPreview.appex
qlmanage -r >/dev/null 2>&1; qlmanage -r cache >/dev/null 2>&1
echo "Installé : ~/Applications/GLBQuickLook.app"
