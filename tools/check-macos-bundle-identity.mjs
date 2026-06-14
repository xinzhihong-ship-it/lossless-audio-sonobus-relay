import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

const bundlePath = process.argv[2] ?? "sonobus/build/SonoBus_artefacts/Release/Standalone/SonoBus.app";
const infoPath = `${bundlePath}/Contents/Info.plist`;

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function plistValue(key) {
  try {
    return execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, infoPath], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

if (!fs.existsSync(infoPath)) {
  fail(`Missing Info.plist: ${infoPath}`);
} else {
  const bundleId = plistValue("CFBundleIdentifier");
  const microphoneText = plistValue("NSMicrophoneUsageDescription");
  const executable = plistValue("CFBundleExecutable");
  if (bundleId !== "com.Sonosaurus.SonoBus") {
    fail(`Unexpected CFBundleIdentifier: ${bundleId || "(empty)"}`);
  }
  if (!microphoneText) {
    fail("Missing NSMicrophoneUsageDescription.");
  }
  if (executable !== "SonoBus") {
    fail(`Unexpected CFBundleExecutable: ${executable || "(empty)"}`);
  }
}

{
  const result = spawnSync("codesign", ["-dv", "--verbose=4", bundlePath], { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0 || !output.includes("Identifier=com.Sonosaurus.SonoBus")) {
    fail("Code signature is missing or not bound to com.Sonosaurus.SonoBus.");
  }
}

if (!process.exitCode) {
  console.log("macOS bundle identity checks passed.");
}
