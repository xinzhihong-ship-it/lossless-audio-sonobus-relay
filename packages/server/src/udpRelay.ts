import dgram, { type RemoteInfo } from "node:dgram";
import { randomUUID } from "node:crypto";
import { decodeRelayPacket, encodeRelayPacket, type RelayPacketHeader } from "@lossless-audio/protocol";

export type RelaySession = {
  sessionId: string;
  roomId: string;
  userId: string;
  username: string;
  createdAt: string;
  lastSeenAt?: string;
  endpoint?: RemoteInfo;
};

export type UdpRelayConnection =
  | {
      type: "udp-session";
      sessionId: string;
      roomId: string;
      userId: string;
      username: string;
      address?: string;
      port?: number;
      createdAt: string;
      lastSeenAt?: string;
    }
  | {
      type: "sonobus-udp";
      group: string;
      user: string;
      address: string;
      port: number;
      lastSeenAt: string;
    };

export type KickRequest = {
  type?: "udp-session" | "sonobus-udp";
  sessionId?: string;
  roomId?: string;
  userId?: string;
  group?: string;
  user?: string;
  address?: string;
};

export type BanRequest = {
  type?: "udp-session" | "sonobus-udp";
  roomId?: string;
  userId?: string;
  group?: string;
  user?: string;
  address?: string;
  ttlSeconds?: number;
};

export type KickResult = {
  kicked: number;
};

export type BanRecord = BanRequest & {
  id: string;
  type: "udp-session" | "sonobus-udp";
  expiresAt: string;
};

type RawPeer = {
  group: string;
  user: string;
  endpoint: RemoteInfo;
  lastSeenAt: string;
};

type Ban = Required<Pick<BanRequest, "type">> & Omit<BanRequest, "type" | "ttlSeconds"> & {
  id: string;
  sessionId?: string;
  expiresAt: number;
};

export class UdpRelay {
  private socket = dgram.createSocket("udp4");
  private sessions = new Map<string, RelaySession>();
  private rawPeers = new Map<string, RawPeer>();
  private bans: Ban[] = [];

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

  connections(): UdpRelayConnection[] {
    this.pruneExpiredBans();
    return [
      ...[...this.sessions.values()].map((session): UdpRelayConnection => ({
        type: "udp-session",
        sessionId: session.sessionId,
        roomId: session.roomId,
        userId: session.userId,
        username: session.username,
        address: session.endpoint?.address,
        port: session.endpoint?.port,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt
      })),
      ...[...this.rawPeers.values()].map((peer): UdpRelayConnection => ({
        type: "sonobus-udp",
        group: peer.group,
        user: peer.user,
        address: peer.endpoint.address,
        port: peer.endpoint.port,
        lastSeenAt: peer.lastSeenAt
      }))
    ];
  }

  kick(request: KickRequest): KickResult {
    let kicked = 0;
    if (!request.type || request.type === "udp-session") {
      for (const [sessionId, session] of this.sessions) {
        if (matchesUdpSession(request, session)) {
          this.sessions.delete(sessionId);
          kicked += 1;
        }
      }
    }

    if (!request.type || request.type === "sonobus-udp") {
      for (const [key, peer] of this.rawPeers) {
        if (matchesRawPeer(request, peer)) {
          this.rawPeers.delete(key);
          kicked += 1;
        }
      }
    }
    return { kicked };
  }

  ban(request: BanRequest): { banned: number; expiresAt: string } {
    const type = request.type ?? "sonobus-udp";
    const ttlSeconds = Math.max(1, Math.min(Number(request.ttlSeconds ?? 3600), 30 * 24 * 60 * 60));
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.bans.push({ ...request, id: randomUUID(), type, expiresAt });
    const result = this.kick({ ...request, type });
    return { banned: result.kicked, expiresAt: new Date(expiresAt).toISOString() };
  }

  listBans(): BanRecord[] {
    this.pruneExpiredBans();
    return this.bans.map((ban) => ({
      id: ban.id,
      type: ban.type,
      sessionId: ban.sessionId,
      roomId: ban.roomId,
      userId: ban.userId,
      group: ban.group,
      user: ban.user,
      address: ban.address,
      expiresAt: new Date(ban.expiresAt).toISOString()
    }));
  }

  unban(request: { id?: string; type?: "udp-session" | "sonobus-udp"; roomId?: string; userId?: string; group?: string; user?: string; address?: string }): {
    removed: number;
  } {
    this.pruneExpiredBans();
    const before = this.bans.length;
    this.bans = this.bans.filter((ban) => !matchesBanRemoval(request, ban));
    return { removed: before - this.bans.length };
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
    if (this.isBanned("udp-session", {
      roomId: session.roomId,
      userId: session.userId,
      address: remote.address
    })) {
      this.sessions.delete(session.sessionId);
      return;
    }
    session.endpoint = remote;
    session.lastSeenAt = new Date().toISOString();

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
    if (this.isBanned("sonobus-udp", {
      group: packet.header.group,
      user: packet.header.source,
      address: remote.address
    })) {
      this.rawPeers.delete(sourceKey);
      return true;
    }

    this.rawPeers.set(sourceKey, { group: packet.header.group, user: packet.header.source, endpoint: remote, lastSeenAt: new Date().toISOString() });

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

  private isBanned(type: Ban["type"], values: { roomId?: string; userId?: string; group?: string; user?: string; address?: string }): boolean {
    this.pruneExpiredBans();
    return this.bans.some((ban) => {
      if (ban.type !== type) {
        return false;
      }
      if (ban.roomId && ban.roomId !== values.roomId) {
        return false;
      }
      if (ban.userId && ban.userId !== values.userId) {
        return false;
      }
      if (ban.group && ban.group !== values.group) {
        return false;
      }
      if (ban.user && ban.user !== values.user) {
        return false;
      }
      if (ban.address && ban.address !== values.address) {
        return false;
      }
      return Boolean(ban.roomId || ban.userId || ban.group || ban.user || ban.address);
    });
  }

  private pruneExpiredBans(): void {
    const now = Date.now();
    this.bans = this.bans.filter((ban) => ban.expiresAt > now);
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

function matchesUdpSession(request: KickRequest, session: RelaySession): boolean {
  if (request.sessionId && request.sessionId !== session.sessionId) {
    return false;
  }
  if (request.roomId && request.roomId !== session.roomId) {
    return false;
  }
  if (request.userId && request.userId !== session.userId) {
    return false;
  }
  if (request.user && request.user !== session.username) {
    return false;
  }
  if (request.address && request.address !== session.endpoint?.address) {
    return false;
  }
  return Boolean(request.sessionId || request.roomId || request.userId || request.user || request.address);
}

function matchesRawPeer(request: KickRequest, peer: RawPeer): boolean {
  if (request.group && request.group !== peer.group) {
    return false;
  }
  if (request.user && request.user !== peer.user) {
    return false;
  }
  if (request.address && request.address !== peer.endpoint.address) {
    return false;
  }
  return Boolean(request.group || request.user || request.address);
}

function matchesBanRemoval(
  request: { id?: string; type?: "udp-session" | "sonobus-udp"; roomId?: string; userId?: string; group?: string; user?: string; address?: string },
  ban: Ban
): boolean {
  if (request.id) {
    return request.id === ban.id;
  }
  if (request.type && request.type !== ban.type) {
    return false;
  }
  if (request.roomId && request.roomId !== ban.roomId) {
    return false;
  }
  if (request.userId && request.userId !== ban.userId) {
    return false;
  }
  if (request.group && request.group !== ban.group) {
    return false;
  }
  if (request.user && request.user !== ban.user) {
    return false;
  }
  if (request.address && request.address !== ban.address) {
    return false;
  }
  return Boolean(request.type || request.roomId || request.userId || request.group || request.user || request.address);
}
