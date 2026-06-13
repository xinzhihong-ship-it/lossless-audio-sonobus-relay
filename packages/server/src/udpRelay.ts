import dgram, { type RemoteInfo } from "node:dgram";
import { randomUUID } from "node:crypto";
import { decodeRelayPacket, encodeRelayPacket, type RelayPacketHeader } from "@lossless-audio/protocol";

export type RelaySession = {
  sessionId: string;
  roomId: string;
  userId: string;
  username: string;
  createdAt: string;
  endpoint?: RemoteInfo;
};

export class UdpRelay {
  private socket = dgram.createSocket("udp4");
  private sessions = new Map<string, RelaySession>();
  private rawPeers = new Map<string, { group: string; user: string; endpoint: RemoteInfo }>();

  constructor(private port: number) {}

  async start(): Promise<void> {
    this.socket.on("message", (message, remote) => this.handleMessage(message, remote));
    await new Promise<void>((resolve) => this.socket.bind(this.port, "0.0.0.0", resolve));
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.socket.close(() => resolve()));
  }

  createSession(roomId: string, userId: string, username: string): RelaySession {
    const existing = [...this.sessions.values()].find((session) => session.roomId === roomId && session.userId === userId);
    if (existing) {
      return existing;
    }
    const session: RelaySession = {
      sessionId: randomUUID(),
      roomId,
      userId,
      username,
      createdAt: new Date().toISOString()
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  get publicPort(): number {
    const address = this.socket.address();
    return typeof address === "object" ? address.port : this.port;
  }

  private handleMessage(message: Buffer, remote: RemoteInfo): void {
    if (this.handleSonoBusRelayMessage(message, remote)) {
      return;
    }

    let decoded;
    try {
      decoded = decodeRelayPacket(message);
    } catch {
      return;
    }

    const session = this.sessions.get(decoded.header.sessionId);
    if (!session || session.roomId !== decoded.header.roomId || session.userId !== decoded.header.sourceUserId) {
      return;
    }
    session.endpoint = remote;

    for (const target of this.sessions.values()) {
      if (target.roomId !== session.roomId || target.userId === session.userId || !target.endpoint) {
        continue;
      }
      if (decoded.header.targetUserId && decoded.header.targetUserId !== target.userId) {
        continue;
      }

      const forwardedHeader: RelayPacketHeader = {
        ...decoded.header,
        targetUserId: target.userId
      };
      const forwarded = encodeRelayPacket(forwardedHeader, decoded.payload);
      this.socket.send(forwarded, target.endpoint.port, target.endpoint.address);
    }
  }

  private handleSonoBusRelayMessage(message: Buffer, remote: RemoteInfo): boolean {
    const packet = decodeSonoBusRelayPacket(message);
    if (!packet) {
      return false;
    }

    const sourceKey = rawPeerKey(packet.header.group, packet.header.source);
    this.rawPeers.set(sourceKey, { group: packet.header.group, user: packet.header.source, endpoint: remote });

    if (packet.type === 0) {
      return true;
    }

    const targets = packet.header.target
      ? [this.rawPeers.get(rawPeerKey(packet.header.group, packet.header.target))]
      : [...this.rawPeers.values()].filter((peer) => peer.group === packet.header.group && peer.user !== packet.header.source);

    for (const target of targets) {
      if (target?.endpoint) {
        this.socket.send(message, target.endpoint.port, target.endpoint.address);
      }
    }

    return true;
  }
}

type SonoBusRelayPacket = {
  type: number;
  header: {
    group: string;
    source: string;
    target?: string;
    directHost?: string;
    directPort?: number;
  };
  payload: Buffer;
};

function decodeSonoBusRelayPacket(message: Buffer): SonoBusRelayPacket | undefined {
  if (message.length < 10 || message.subarray(0, 4).toString("ascii") !== "SBR1") {
    return undefined;
  }
  const version = message.readUInt8(4);
  const type = message.readUInt8(5);
  const headerLength = message.readUInt16BE(6);
  const payloadLength = message.readUInt16BE(8);
  const expected = 10 + headerLength + payloadLength;
  if (version !== 1 || ![0, 1].includes(type) || expected !== message.length) {
    return undefined;
  }

  const header = JSON.parse(message.subarray(10, 10 + headerLength).toString("utf8")) as SonoBusRelayPacket["header"];
  if (!header.group || !header.source) {
    return undefined;
  }

  return {
    type,
    header,
    payload: message.subarray(10 + headerLength)
  };
}

function rawPeerKey(group: string, user: string): string {
  return `${group}\u0000${user}`;
}
