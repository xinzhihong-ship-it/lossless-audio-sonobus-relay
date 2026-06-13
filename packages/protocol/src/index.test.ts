import assert from "node:assert/strict";
import test from "node:test";
import { decodeAudioFrame, encodeAudioFrame } from "./index.js";

test("audio frame round-trips the PCM payload byte-for-byte", () => {
  const payload = Buffer.from([0, 1, 2, 3, 254, 255]);
  const frame = encodeAudioFrame(
    {
      streamId: "stream-a",
      userId: "user-a",
      sampleRate: 48000,
      bitDepth: 24,
      channels: 2,
      sequence: 42,
      timestamp: 1710000000000
    },
    payload
  );

  const decoded = decodeAudioFrame(frame);
  assert.deepEqual(decoded.payload, payload);
  assert.equal(decoded.header.sampleRate, 48000);
  assert.equal(decoded.raw, frame);
});
