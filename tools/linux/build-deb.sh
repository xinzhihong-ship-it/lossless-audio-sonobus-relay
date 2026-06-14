#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <version> <output-deb>"
  exit 2
fi

VERSION="$1"
OUTPUT_DEB="$2"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${ROOT}/artifacts/linux-deb-work"
PKG="${WORK}/pkg"
ARCH="amd64"

rm -rf "${WORK}"
mkdir -p \
  "${PKG}/DEBIAN" \
  "${PKG}/usr/local/bin" \
  "${PKG}/usr/local/lib/vst3" \
  "${PKG}/usr/local/lib/lv2" \
  "${PKG}/usr/share/applications" \
  "${PKG}/usr/share/pixmaps" \
  "${PKG}/usr/share/doc/lossless-audio-sonobus-relay"

BIN_SRC="${ROOT}/sonobus/build/SonoBus_artefacts/Release/Standalone/SonoBus"
if [ ! -f "${BIN_SRC}" ]; then
  BIN_SRC="${ROOT}/sonobus/build/SonoBus_artefacts/Release/Standalone/sonobus"
fi
install -m 0755 "${BIN_SRC}" "${PKG}/usr/local/bin/sonobus"

cp -p "${ROOT}/sonobus/linux/sonobus.desktop" "${PKG}/usr/share/applications/sonobus.desktop"
cp -p "${ROOT}/sonobus/images/sonobus_logo@2x.png" "${PKG}/usr/share/pixmaps/sonobus.png"

cp -pR "${ROOT}/sonobus/build/SonoBus_artefacts/Release/VST3/SonoBus.vst3" "${PKG}/usr/local/lib/vst3/"
cp -pR "${ROOT}/sonobus/build/SonoBusInst_artefacts/Release/VST3/SonoBusInstrument.vst3" "${PKG}/usr/local/lib/vst3/"
if [ -d "${ROOT}/sonobus/build/SonoBus_artefacts/Release/LV2/SonoBus.lv2" ]; then
  cp -pR "${ROOT}/sonobus/build/SonoBus_artefacts/Release/LV2/SonoBus.lv2" "${PKG}/usr/local/lib/lv2/"
fi

cp -p "${ROOT}/README.md" "${PKG}/usr/share/doc/lossless-audio-sonobus-relay/"
cp -p "${ROOT}/LICENSE" "${PKG}/usr/share/doc/lossless-audio-sonobus-relay/"
cp -p "${ROOT}/LICENSE_EXCEPTION" "${PKG}/usr/share/doc/lossless-audio-sonobus-relay/"
cp -p "${ROOT}/NOTICE.md" "${PKG}/usr/share/doc/lossless-audio-sonobus-relay/"
cp -p "${ROOT}/sonobus/LICENSE" "${PKG}/usr/share/doc/lossless-audio-sonobus-relay/sonobus-LICENSE"
cp -p "${ROOT}/sonobus/LICENSE_EXCEPTION" "${PKG}/usr/share/doc/lossless-audio-sonobus-relay/sonobus-LICENSE_EXCEPTION"

cat > "${PKG}/DEBIAN/control" <<CONTROL
Package: lossless-audio-sonobus-relay
Version: ${VERSION}
Section: sound
Priority: optional
Architecture: ${ARCH}
Maintainer: xinzhihong-ship-it <noreply@github.com>
Depends: libc6, libasound2, libx11-6, libxext6, libxinerama1, libxrandr2, libxcursor1, libfreetype6, libcurl4
Homepage: https://github.com/xinzhihong-ship-it/lossless-audio-sonobus-relay
Description: Lossless Audio SonoBus Relay client and plugins
 Modified SonoBus build with self-hosted relay support, standalone app,
 VST3 plugins, and LV2 plugin.
CONTROL

cat > "${PKG}/DEBIAN/postinst" <<'POSTINST'
#!/bin/sh
set -e
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications || true
fi
exit 0
POSTINST
chmod 0755 "${PKG}/DEBIAN/postinst"

cat > "${PKG}/DEBIAN/postrm" <<'POSTRM'
#!/bin/sh
set -e
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications || true
fi
exit 0
POSTRM
chmod 0755 "${PKG}/DEBIAN/postrm"

dpkg-deb --build "${PKG}" "${OUTPUT_DEB}"
