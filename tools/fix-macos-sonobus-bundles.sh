#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-sonobus}"
APP_BUNDLE="$ROOT_DIR/build/SonoBus_artefacts/Release/Standalone/SonoBus.app"
APP_INFO_SOURCE="$ROOT_DIR/build/SonoBus_artefacts/JuceLibraryCode/SonoBus_Standalone/Info.plist"
APP_ENTITLEMENTS="$ROOT_DIR/build/SonoBus_artefacts/JuceLibraryCode/SonoBus_Standalone.entitlements"

copy_info_plist() {
  local source="$1"
  local bundle="$2"
  if [[ -d "$bundle" && -f "$source" ]]; then
    mkdir -p "$bundle/Contents"
    cp "$source" "$bundle/Contents/Info.plist"
  fi
}

sign_bundle() {
  local bundle="$1"
  local entitlements="$2"
  if [[ ! -d "$bundle" ]]; then
    return
  fi

  if [[ -f "$entitlements" ]]; then
    codesign --force --deep --sign - --entitlements "$entitlements" "$bundle"
  else
    codesign --force --deep --sign - "$bundle"
  fi
}

copy_info_plist "$APP_INFO_SOURCE" "$APP_BUNDLE"

sign_bundle "$ROOT_DIR/build/SonoBus_artefacts/Release/VST3/SonoBus.vst3" "$ROOT_DIR/build/SonoBus_artefacts/JuceLibraryCode/SonoBus_VST3.entitlements"
sign_bundle "$ROOT_DIR/build/SonoBusInst_artefacts/Release/VST3/SonoBusInstrument.vst3" "$ROOT_DIR/build/SonoBusInst_artefacts/JuceLibraryCode/SonoBusInst_VST3.entitlements"
sign_bundle "$ROOT_DIR/build/SonoBus_artefacts/Release/AU/SonoBus.component" "$ROOT_DIR/build/SonoBus_artefacts/JuceLibraryCode/SonoBus_AU.entitlements"
sign_bundle "$APP_BUNDLE" "$APP_ENTITLEMENTS"

node tools/check-macos-bundle-identity.mjs "$APP_BUNDLE"
