export const AUDIO_FRAME_MAGIC = "LPCM";
export const AUDIO_FRAME_VERSION = 1;
export const AUDIO_FRAME_TYPE = 1;
export const AUDIO_FRAME_FIXED_HEADER_BYTES = 12;
export const RELAY_PACKET_MAGIC = "LARU";
export const RELAY_PACKET_VERSION = 1;
export const RELAY_PACKET_FIXED_HEADER_BYTES = 10;

export type AudioFormat = {
  sampleRate: number;
  bitDepth: 16 | 24 | 32;
  channels: 1 | 2;
};

export type AudioFrameHeader = AudioFormat & {
  streamId: string;
  userId: string;
  sequence: number;
  timestamp: number;
};

export type DecodedAudioFrame = {
  header: AudioFrameHeader;
  payload: Buffer;
  raw: Buffer;
};

export type RoomMember = {
  userId: string;
  username: string;
  streamId?: string;
  format?: AudioFormat;
};

export type ServerJsonMessage =
  | { type: "room_state"; roomId: string; members: RoomMember[] }
  | { type: "member_joined"; member: RoomMember }
  | { type: "member_left"; userId: string }
  | { type: "stream_format"; member: RoomMember }
  | { type: "error"; code: string; message: string };

export type ClientJsonMessage =
  | { type: "stream_format"; streamId: string; format: AudioFormat }
  | { type: "ping"; timestamp: number };

export type RelayPacketHeader = {
  sessionId: string;
  roomId: string;
  sourceUserId: string;
  targetUserId?: string;
  sequence: number;
  timestamp: number;
};

export type DecodedRelayPacket = {
  header: RelayPacketHeader;
  payload: Buffer;
  raw: Buffer;
};

export function encodeAudioFrame(header: AudioFrameHeader, payload: Buffer): Buffer {
  validateAudioHeader(header);
  const headerBuffer = Buffer.from(JSON.stringify(header), "utf8");
  const output = Buffer.alloc(AUDIO_FRAME_FIXED_HEADER_BYTES + headerBuffer.length + payload.length);
  output.write(AUDIO_FRAME_MAGIC, 0, 4, "ascii");
  output.writeUInt8(AUDIO_FRAME_VERSION, 4);
  output.writeUInt8(AUDIO_FRAME_TYPE, 5);
  output.writeUInt16BE(headerBuffer.length, 6);
  output.writeUInt32BE(payload.length, 8);
  headerBuffer.copy(output, AUDIO_FRAME_FIXED_HEADER_BYTES);
  payload.copy(output, AUDIO_FRAME_FIXED_HEADER_BYTES + headerBuffer.length);
  return output;
}

export function decodeAudioFrame(rawInput: Buffer | ArrayBuffer | Uint8Array): DecodedAudioFrame {
  const raw = toBuffer(rawInput);
  if (raw.length < AUDIO_FRAME_FIXED_HEADER_BYTES) {
    throw new Error("Audio frame is too short.");
  }

  const magic = raw.subarray(0, 4).toString("ascii");
  const version = raw.readUInt8(4);
  const type = raw.readUInt8(5);
  const headerLength = raw.readUInt16BE(6);
  const payloadLength = raw.readUInt32BE(8);
  const expectedLength = AUDIO_FRAME_FIXED_HEADER_BYTES + headerLength + payloadLength;

  if (magic !== AUDIO_FRAME_MAGIC) {
    throw new Error("Invalid audio frame magic.");
  }
  if (version !== AUDIO_FRAME_VERSION || type !== AUDIO_FRAME_TYPE) {
    throw new Error("Unsupported audio frame version or type.");
  }
  if (raw.length !== expectedLength) {
    throw new Error("Audio frame length mismatch.");
  }

  const headerJson = raw.subarray(AUDIO_FRAME_FIXED_HEADER_BYTES, AUDIO_FRAME_FIXED_HEADER_BYTES + headerLength).toString("utf8");
  const header = JSON.parse(headerJson) as AudioFrameHeader;
  validateAudioHeader(header);
  const payload = raw.subarray(AUDIO_FRAME_FIXED_HEADER_BYTES + headerLength);
  return { header, payload, raw };
}

function toBuffer(input: Buffer | ArrayBuffer | Uint8Array): Buffer {
  if (Buffer.isBuffer(input)) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return Buffer.from(input);
  }
  return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
}

export function validateAudioHeader(header: AudioFrameHeader): void {
  if (!header.streamId || !header.userId) {
    throw new Error("Audio frame header must include streamId and userId.");
  }
  if (!Number.isInteger(header.sampleRate) || header.sampleRate < 8000 || header.sampleRate > 384000) {
    throw new Error("Audio frame sampleRate is outside the supported range.");
  }
  if (![16, 24, 32].includes(header.bitDepth)) {
    throw new Error("Audio frame bitDepth must be 16, 24, or 32.");
  }
  if (![1, 2].includes(header.channels)) {
    throw new Error("Audio frame channels must be 1 or 2.");
  }
  if (!Number.isSafeInteger(header.sequence) || header.sequence < 0) {
    throw new Error("Audio frame sequence must be a non-negative integer.");
  }
  if (!Number.isFinite(header.timestamp) || header.timestamp <= 0) {
    throw new Error("Audio frame timestamp must be a positive number.");
  }
}

export function bytesPerSecond(format: AudioFormat): number {
  return format.sampleRate * format.channels * Math.ceil(format.bitDepth / 8);
}

export function encodeRelayPacket(header: RelayPacketHeader, payload: Buffer): Buffer {
  validateRelayHeader(header);
  const headerBuffer = Buffer.from(JSON.stringify(header), "utf8");
  const output = Buffer.alloc(RELAY_PACKET_FIXED_HEADER_BYTES + headerBuffer.length + payload.length);
  output.write(RELAY_PACKET_MAGIC, 0, 4, "ascii");
  output.writeUInt8(RELAY_PACKET_VERSION, 4);
  output.writeUInt8(1, 5);
  output.writeUInt16BE(headerBuffer.length, 6);
  output.writeUInt16BE(payload.length, 8);
  headerBuffer.copy(output, RELAY_PACKET_FIXED_HEADER_BYTES);
  payload.copy(output, RELAY_PACKET_FIXED_HEADER_BYTES + headerBuffer.length);
  return output;
}

export function decodeRelayPacket(rawInput: Buffer | ArrayBuffer | Uint8Array): DecodedRelayPacket {
  const raw = toBuffer(rawInput);
  if (raw.length < RELAY_PACKET_FIXED_HEADER_BYTES) {
    throw new Error("Relay packet is too short.");
  }

  const magic = raw.subarray(0, 4).toString("ascii");
  const version = raw.readUInt8(4);
  const type = raw.readUInt8(5);
  const headerLength = raw.readUInt16BE(6);
  const payloadLength = raw.readUInt16BE(8);
  const expectedLength = RELAY_PACKET_FIXED_HEADER_BYTES + headerLength + payloadLength;
  if (magic !== RELAY_PACKET_MAGIC || version !== RELAY_PACKET_VERSION || type !== 1) {
    throw new Error("Unsupported relay packet.");
  }
  if (raw.length !== expectedLength) {
    throw new Error("Relay packet length mismatch.");
  }

  const header = JSON.parse(raw.subarray(RELAY_PACKET_FIXED_HEADER_BYTES, RELAY_PACKET_FIXED_HEADER_BYTES + headerLength).toString("utf8")) as RelayPacketHeader;
  validateRelayHeader(header);
  const payload = raw.subarray(RELAY_PACKET_FIXED_HEADER_BYTES + headerLength);
  return { header, payload, raw };
}

function validateRelayHeader(header: RelayPacketHeader): void {
  if (!header.sessionId || !header.roomId || !header.sourceUserId) {
    throw new Error("Relay packet header must include sessionId, roomId, and sourceUserId.");
  }
  if (!Number.isSafeInteger(header.sequence) || header.sequence < 0) {
    throw new Error("Relay packet sequence must be a non-negative integer.");
  }
  if (!Number.isFinite(header.timestamp) || header.timestamp <= 0) {
    throw new Error("Relay packet timestamp must be a positive number.");
  }
}
