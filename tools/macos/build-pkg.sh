#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <version> <output-pkg>"
  exit 2
fi

VERSION="$1"
OUTPUT_PKG="$2"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${ROOT}/artifacts/macos-pkg-work"
PKGS="${WORK}/pkgs"
COMPONENTS=()

rm -rf "${WORK}"
mkdir -p "${PKGS}"

stage_component() {
  local name="$1"
  local identifier="$2"
  local root_dir="$3"
  local install_location="$4"
  pkgbuild \
    --root "${root_dir}" \
    --identifier "${identifier}" \
    --version "${VERSION}" \
    --install-location "${install_location}" \
    "${PKGS}/${name}.pkg"
  COMPONENTS+=("${PKGS}/${name}.pkg")
}

APP_SRC="${ROOT}/sonobus/build/SonoBus_artefacts/Release/Standalone/SonoBus.app"
VST3_SRC="${ROOT}/sonobus/build/SonoBus_artefacts/Release/VST3/SonoBus.vst3"
INST_VST3_SRC="${ROOT}/sonobus/build/SonoBusInst_artefacts/Release/VST3/SonoBusInstrument.vst3"
AU_SRC="${ROOT}/sonobus/build/SonoBus_artefacts/Release/AU/SonoBus.component"
LV2_SRC="${ROOT}/sonobus/build/SonoBus_artefacts/Release/LV2/SonoBus.lv2"

mkdir -p "${WORK}/app" "${WORK}/vst3" "${WORK}/components" "${WORK}/lv2" "${WORK}/docs/lossless-audio-sonobus-relay"

cp -pR "${APP_SRC}" "${WORK}/app/"
stage_component "app" "com.losslessaudio.sonobusrelay.app" "${WORK}/app" "/Applications"

cp -pR "${VST3_SRC}" "${WORK}/vst3/"
cp -pR "${INST_VST3_SRC}" "${WORK}/vst3/"
stage_component "vst3" "com.losslessaudio.sonobusrelay.vst3" "${WORK}/vst3" "/Library/Audio/Plug-Ins/VST3"

if [ -d "${AU_SRC}" ]; then
  cp -pR "${AU_SRC}" "${WORK}/components/"
  stage_component "au" "com.losslessaudio.sonobusrelay.au" "${WORK}/components" "/Library/Audio/Plug-Ins/Components"
fi

if [ -d "${LV2_SRC}" ]; then
  cp -pR "${LV2_SRC}" "${WORK}/lv2/"
  stage_component "lv2" "com.losslessaudio.sonobusrelay.lv2" "${WORK}/lv2" "/Library/Audio/Plug-Ins/LV2"
fi

cp -p "${ROOT}/README.md" "${WORK}/docs/lossless-audio-sonobus-relay/"
cp -p "${ROOT}/LICENSE" "${WORK}/docs/lossless-audio-sonobus-relay/"
cp -p "${ROOT}/LICENSE_EXCEPTION" "${WORK}/docs/lossless-audio-sonobus-relay/"
cp -p "${ROOT}/NOTICE.md" "${WORK}/docs/lossless-audio-sonobus-relay/"
cp -p "${ROOT}/sonobus/LICENSE" "${WORK}/docs/lossless-audio-sonobus-relay/sonobus-LICENSE"
cp -p "${ROOT}/sonobus/LICENSE_EXCEPTION" "${WORK}/docs/lossless-audio-sonobus-relay/sonobus-LICENSE_EXCEPTION"
stage_component "docs" "com.losslessaudio.sonobusrelay.docs" "${WORK}/docs" "/usr/local/share/doc"

SYNTHESIZE_ARGS=()
for component in "${COMPONENTS[@]}"; do
  SYNTHESIZE_ARGS+=(--package "${component}")
done

productbuild --synthesize "${SYNTHESIZE_ARGS[@]}" "${WORK}/Distribution"

productbuild \
  --distribution "${WORK}/Distribution" \
  --package-path "${PKGS}" \
  --version "${VERSION}" \
  --identifier "com.losslessaudio.sonobusrelay" \
  "${OUTPUT_PKG}"
