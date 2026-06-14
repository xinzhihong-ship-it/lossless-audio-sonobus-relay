import fs from "node:fs";

const sourcePath = new URL("../sonobus/Source/SonobusPluginProcessor.cpp", import.meta.url);
const source = fs.readFileSync(sourcePath, "utf8");

function assertContains(name, pattern) {
  if (!pattern.test(source)) {
    console.error(`Missing expected SonoBus relay state guard: ${name}`);
    process.exitCode = 1;
  }
}

function assertBlockContains(name, startPattern, endPattern, expectations) {
  const start = source.search(startPattern);
  if (start < 0) {
    console.error(`Missing expected SonoBus relay state guard: ${name}`);
    process.exitCode = 1;
    return;
  }

  const rest = source.slice(start);
  const end = rest.search(endPattern);
  const block = end < 0 ? rest : rest.slice(0, end);
  for (const expectation of expectations) {
    if (!expectation.test(block)) {
      console.error(`Missing expected SonoBus relay state guard: ${name}`);
      process.exitCode = 1;
      return;
    }
  }
}

assertContains(
  "unblocked peers resume sending instead of staying muted",
  /if\s*\(\s*blocked\s*\)\s*\{[\s\S]*?setRemotePeerSendActive\s*\(\s*retind\s*,\s*false\s*\)[\s\S]*?\}\s*else\s*\{[\s\S]*?setRemotePeerSendActive\s*\(\s*retind\s*,\s*peer->sendAllow\s*\)/m,
);

assertContains(
  "reused relay peers clear stale ban and activity state",
  /resetTransientRemotePeerState\s*\(\s*remote\s*,\s*true\s*\)/m,
);

assertBlockContains(
  "relay reconnect performs a fresh wildcard invite",
  /int SonobusAudioProcessor::connectRemotePeerEndpoint/,
  /int SonobusAudioProcessor::connectRemotePeer\(/,
  [
    /resetTransientRemotePeerState\s*\(\s*remote\s*,\s*true\s*\)/,
    /remote->oursink->invite_source\s*\(\s*endpoint\s*,\s*0\s*,\s*endpoint_send\s*\)/,
  ],
);

if (!process.exitCode) {
  console.log("SonoBus relay state checks passed.");
}
