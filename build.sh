#!/bin/zsh
# Builds GLB Quick Look (universal arm64 + x86_64) without xcodebuild.
#   ./build.sh            build, package, then install via install.sh (same path as end users)
#   ./build.sh --package  build and zip to dist/GLBQuickLook.zip (no install). VERSION=1.2.3 sets the bundle version.
set -e
cd "$(dirname "$0")"
PACKAGE=0; [[ "$1" == "--package" ]] && PACKAGE=1
rm -rf out; A=out/GLBQuickLook.app; E=$A/Contents/PlugIns/GLBPreview.appex
mkdir -p $A/Contents/MacOS $E/Contents/MacOS $E/Contents/Resources out/obj
SDK=$(xcrun --sdk macosx --show-sdk-path)
ARCHS=(arm64 x86_64)

# swiftc for each arch, then lipo into a universal binary
universal() { # <output> <swiftc args...>
  local out=$1; shift; local parts=()
  for arch in $ARCHS; do
    swiftc -O -sdk $SDK -target $arch-apple-macos13.0 "$@" -o out/obj/$(basename $out)-$arch
    parts+=(out/obj/$(basename $out)-$arch)
  done
  lipo -create $parts -output $out
}

universal $E/Contents/MacOS/GLBPreview -application-extension -module-name GLBPreview -parse-as-library \
  Extension/PreviewViewController.swift -framework Cocoa -framework Quartz -framework WebKit -Xlinker -e -Xlinker _NSExtensionMain
universal $A/Contents/MacOS/GLBQuickLook -module-name GLBQuickLook -parse-as-library App/App.swift
rm -rf out/obj

cp Extension/viewer.html Extension/js/*.js $E/Contents/Resources/
sed -e 's/$(DEVELOPMENT_LANGUAGE)/en/; s/$(EXECUTABLE_NAME)/GLBPreview/; s/$(PRODUCT_BUNDLE_IDENTIFIER)/local.olivier.GLBQuickLook.GLBPreview/; s/$(PRODUCT_NAME)/GLBPreview/; s/$(PRODUCT_MODULE_NAME)/GLBPreview/' Extension/Info.plist > $E/Contents/Info.plist
cp App/Info.plist $A/Contents/Info.plist
if [[ -n "$VERSION" ]]; then
  for p in $A/Contents/Info.plist $E/Contents/Info.plist; do
    /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" -c "Set :CFBundleVersion $VERSION" $p
  done
fi
codesign -f -s - --entitlements Extension/Extension.entitlements $E
codesign -f -s - --entitlements App/App.entitlements $A

ARCH_INFO=$(lipo -archs $E/Contents/MacOS/GLBPreview)
mkdir -p dist && rm -f dist/GLBQuickLook.zip
ditto -c -k --keepParent $A dist/GLBQuickLook.zip
# Remove the build copy before registering anything: a second copy with the same bundle id makes pkd drop the extension
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
$LSREG -u "$PWD/$A" 2>/dev/null || true; rm -rf out
echo "Packaged: dist/GLBQuickLook.zip ($ARCH_INFO)"
(( PACKAGE )) && exit 0

# Install through the same path as end users
sh ./install.sh --local dist/GLBQuickLook.zip
