# Native Installer Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native installer artifacts for Windows, macOS, and Linux so end users do not need to manually place standalone apps and plugins.

**Architecture:** Keep existing manual zip/tar artifacts and add installer artifacts beside them. Use platform-native packaging tools available in GitHub hosted runners: Inno Setup on Windows, pkgbuild/productbuild on macOS, and dpkg-deb on Linux. Shared GPL/NOTICE files are copied into every installer staging directory.

**Tech Stack:** GitHub Actions, PowerShell, Bash, Inno Setup, macOS pkgbuild/productbuild, dpkg-deb.

---

### Task 1: Windows Inno Setup Installer

**Files:**
- Create: `tools/windows-installer/sonobus-installer.iss`
- Modify: `.github/workflows/build-windows.yml`
- Modify: `.github/workflows/build-windows-asio.yml`

- [ ] Create an Inno Setup script that installs `SonoBus.exe` to `{autopf}\Lossless Audio SonoBus Relay`, VST3 folders to `{commoncf}\VST3`, and compliance docs to `{app}`.
- [ ] Install Inno Setup in Windows workflows with Chocolatey.
- [ ] Stage installer input under `installer-input/SonoBus`.
- [ ] Run `iscc` with `SBVERSION=0.1.1`, `SBASIO=false/true`, and output installer artifacts.

### Task 2: macOS PKG Installer

**Files:**
- Create: `tools/macos/build-pkg.sh`
- Modify: `.github/workflows/build-macos.yml`

- [ ] Stage app, VST3, AU, LV2, and compliance docs under package roots.
- [ ] Build component pkgs with `pkgbuild`.
- [ ] Combine component pkgs with `productbuild` into `sonobus-macos-universal.pkg`.
- [ ] Upload the pkg beside the existing zip.

### Task 3: Linux DEB Installer

**Files:**
- Create: `tools/linux/build-deb.sh`
- Modify: `.github/workflows/build-linux-sonobus.yml`

- [ ] Stage executable under `/usr/local/bin/sonobus`.
- [ ] Stage desktop file and icon.
- [ ] Stage VST3 and LV2 plugins under `/usr/local/lib/vst3` and `/usr/local/lib/lv2`.
- [ ] Stage compliance docs under `/usr/share/doc/lossless-audio-sonobus-relay`.
- [ ] Build `sonobus-linux-x64.deb` with `dpkg-deb`.

### Task 4: Documentation and Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/download-and-use.md`

- [ ] Document installer artifacts and when to use zip/tar alternatives.
- [ ] Verify workflow YAML parses.
- [ ] Verify packaging scripts pass shell syntax checks.
- [ ] Run `npm test`.
