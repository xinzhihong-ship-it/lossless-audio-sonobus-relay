import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import dgram from "node:dgram";
import WebSocket from "ws";
import { decodeRelayPacket, encodeAudioFrame, encodeRelayPacket } from "@lossless-audio/protocol";
import { createApp } from "./app.js";
import type { ConnectionServerAdmin } from "./connectionServerAdmin.js";
import { MemoryStore } from "./store.js";

test("ensureAdmin updates an existing admin password from config", async () => {
  const store = new MemoryStore();
  await store.init();
  await store.createUser("admin", "old-pass", "user");

  const app = await createApp({
    jwtSecret: "test-secret",
    adminUsername: "admin",
    adminPassword: "new-pass",
    maxBytesPerSecondPerClient: 1024 * 1024,
    store
  });

  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await login(baseUrl, "admin", "new-pass");
    await assert.rejects(() => login(baseUrl, "admin", "old-pass"));
    assert.equal((await store.getUserByUsername("admin"))?.role, "admin");
  } finally {
    await app.close();
  }
});

test("server relays an audio frame byte-for-byte between NAT-style outbound clients", async () => {
  const app = await createApp({
    jwtSecret: "test-secret",
    adminUsername: "admin",
    adminPassword: "admin-pass",
    maxBytesPerSecondPerClient: 1024 * 1024
  });

  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const adminToken = await login(baseUrl, "admin", "admin-pass");
    await post(baseUrl, "/admin/users", adminToken, { username: "alice", password: "alice-pass" });
    await post(baseUrl, "/admin/users", adminToken, { username: "bob", password: "bob-pass" });
    const roomResponse = await post<{ room: { id: string } }>(baseUrl, "/rooms", adminToken, { name: "studio" });
    const aliceToken = await login(baseUrl, "alice", "alice-pass");
    const bobToken = await login(baseUrl, "bob", "bob-pass");

    const alice = new WebSocket(`${baseUrl.replace("http", "ws")}/rooms/${roomResponse.room.id}/stream?token=${aliceToken}`);
    const bob = new WebSocket(`${baseUrl.replace("http", "ws")}/rooms/${roomResponse.room.id}/stream?token=${bobToken}`);
    await Promise.all([once(alice, "open"), once(bob, "open")]);

    const expected = encodeAudioFrame(
      {
        streamId: "alice-stream",
        userId: decodeJwtSub(aliceToken),
        sampleRate: 96000,
        bitDepth: 24,
        channels: 2,
        sequence: 1,
        timestamp: Date.now()
      },
      Buffer.from([9, 8, 7, 6, 5, 4, 3, 2, 1])
    );

    const received = onceBinaryMessage(bob);
    alice.send(expected, { binary: true });
    assert.deepEqual(await received, expected);

    alice.close();
    bob.close();
  } finally {
    await app.close();
  }
});

test("admin web page is served for browser-based remote administration", async () => {
  const app = await createApp({
    jwtSecret: "test-secret",
    adminUsername: "admin",
    adminPassword: "admin-pass",
    maxBytesPerSecondPerClient: 1024 * 1024
  });

  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/admin`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    const html = await response.text();
    assert.match(html, /服务器管理/);
    assert.match(html, /\/admin\/connections/);
    assert.match(html, /\/admin\/bans/);
  } finally {
    await app.close();
  }
});

test("udp relay forwards wrapped SonoBus-style payloads without changing payload bytes", async () => {
  const app = await createApp({
    jwtSecret: "test-secret",
    adminUsername: "admin",
    adminPassword: "admin-pass",
    maxBytesPerSecondPerClient: 1024 * 1024,
    udpRelayPort: 0
  });

  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const aliceSocket = dgram.createSocket("udp4");
  const bobSocket = dgram.createSocket("udp4");

  try {
    const adminToken = await login(baseUrl, "admin", "admin-pass");
    await post(baseUrl, "/admin/users", adminToken, { username: "alice-udp", password: "alice-pass" });
    await post(baseUrl, "/admin/users", adminToken, { username: "bob-udp", password: "bob-pass" });
    const roomResponse = await post<{ room: { id: string } }>(baseUrl, "/rooms", adminToken, { name: "udp-studio" });
    const aliceToken = await login(baseUrl, "alice-udp", "alice-pass");
    const bobToken = await login(baseUrl, "bob-udp", "bob-pass");
    const aliceSession = await post<{ sessionId: string; userId: string; roomId: string; udpPort: number }>(
      baseUrl,
      `/rooms/${roomResponse.room.id}/relay-session`,
      aliceToken,
      {}
    );
    const bobSession = await post<{ sessionId: string; userId: string; roomId: string; udpPort: number }>(
      baseUrl,
      `/rooms/${roomResponse.room.id}/relay-session`,
      bobToken,
      {}
    );

    await bindUdp(aliceSocket);
    await bindUdp(bobSocket);

    const bobHello = encodeRelayPacket(
      {
        sessionId: bobSession.sessionId,
        roomId: bobSession.roomId,
        sourceUserId: bobSession.userId,
        sequence: 0,
        timestamp: Date.now()
      },
      Buffer.from("hello")
    );
    bobSocket.send(bobHello, bobSession.udpPort, "127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const payload = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const alicePacket = encodeRelayPacket(
      {
        sessionId: aliceSession.sessionId,
        roomId: aliceSession.roomId,
        sourceUserId: aliceSession.userId,
        targetUserId: bobSession.userId,
        sequence: 1,
        timestamp: Date.now()
      },
      payload
    );
    const received = onceUdpMessage(bobSocket);
    aliceSocket.send(alicePacket, aliceSession.udpPort, "127.0.0.1");

    const decoded = decodeRelayPacket(await received);
    assert.deepEqual(decoded.payload, payload);
    assert.equal(decoded.header.sourceUserId, aliceSession.userId);
    assert.equal(decoded.header.targetUserId, bobSession.userId);
  } finally {
    aliceSocket.close();
    bobSocket.close();
    await app.close();
  }
});

test("udp relay forwards native SonoBus SBR1 packets to learned group peers", async () => {
  const app = await createApp({
    jwtSecret: "test-secret",
    adminUsername: "admin",
    adminPassword: "admin-pass",
    maxBytesPerSecondPerClient: 1024 * 1024,
    udpRelayPort: 0
  });

  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const aliceSocket = dgram.createSocket("udp4");
  const bobSocket = dgram.createSocket("udp4");

  try {
    const adminToken = await login(baseUrl, "admin", "admin-pass");
    const roomResponse = await post<{ room: { id: string } }>(baseUrl, "/rooms", adminToken, { name: "sonobus-room" });
    const relayInfo = await post<{ udpPort: number }>(baseUrl, `/rooms/${roomResponse.room.id}/relay-session`, adminToken, {});

    await bindUdp(aliceSocket);
    await bindUdp(bobSocket);

    bobSocket.send(encodeSbr1({ group: "band", source: "bob" }, Buffer.alloc(0), 0), relayInfo.udpPort, "127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const payload = Buffer.from([1, 3, 3, 7]);
    const packet = encodeSbr1({ group: "band", source: "alice", target: "bob" }, payload);
    const received = onceUdpMessage(bobSocket);
    aliceSocket.send(packet, relayInfo.udpPort, "127.0.0.1");
    assert.deepEqual(await received, packet);
  } finally {
    aliceSocket.close();
    bobSocket.close();
    await app.close();
  }
});

test("admin can list, kick, and ban native SonoBus UDP peers", async () => {
  const app = await createApp({
    jwtSecret: "test-secret",
    adminUsername: "admin",
    adminPassword: "admin-pass",
    maxBytesPerSecondPerClient: 1024 * 1024,
    udpRelayPort: 0
  });

  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const aliceSocket = dgram.createSocket("udp4");

  try {
    const adminToken = await login(baseUrl, "admin", "admin-pass");
    const roomResponse = await post<{ room: { id: string } }>(baseUrl, "/rooms", adminToken, { name: "kick-room" });
    const relayInfo = await post<{ udpPort: number }>(baseUrl, `/rooms/${roomResponse.room.id}/relay-session`, adminToken, {});

    await bindUdp(aliceSocket);
    aliceSocket.send(encodeSbr1({ group: "band", source: "alice" }, Buffer.alloc(0), 0), relayInfo.udpPort, "127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const listed = await get<{ connections: Array<{ type: string; group?: string; user?: string }> }>(
      baseUrl,
      "/admin/connections",
      adminToken
    );
    assert.ok(listed.connections.some((connection) => connection.type === "sonobus-udp" && connection.group === "band" && connection.user === "alice"));

    const kickResult = await post<{ kicked: number }>(baseUrl, "/admin/connections/kick", adminToken, {
      type: "sonobus-udp",
      group: "band",
      user: "alice"
    });
    assert.equal(kickResult.kicked, 1);

    const afterKick = await get<{ connections: Array<{ type: string; group?: string; user?: string }> }>(
      baseUrl,
      "/admin/connections",
      adminToken
    );
    assert.equal(afterKick.connections.some((connection) => connection.type === "sonobus-udp" && connection.group === "band" && connection.user === "alice"), false);

    aliceSocket.send(encodeSbr1({ group: "band", source: "alice" }, Buffer.alloc(0), 0), relayInfo.udpPort, "127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const afterKickRetry = await get<{ connections: Array<{ type: string; group?: string; user?: string }> }>(
      baseUrl,
      "/admin/connections",
      adminToken
    );
    assert.equal(
      afterKickRetry.connections.some((connection) => connection.type === "sonobus-udp" && connection.group === "band" && connection.user === "alice"),
      true
    );

    await post(baseUrl, "/admin/bans", adminToken, {
      type: "sonobus-udp",
      group: "band",
      user: "alice",
      ttlSeconds: 60
    });
    aliceSocket.send(encodeSbr1({ group: "band", source: "alice" }, Buffer.alloc(0), 0), relayInfo.udpPort, "127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const afterBan = await get<{ connections: Array<{ type: string; group?: string; user?: string }> }>(
      baseUrl,
      "/admin/connections",
      adminToken
    );
    assert.equal(afterBan.connections.some((connection) => connection.type === "sonobus-udp" && connection.group === "band" && connection.user === "alice"), false);

    const bans = await get<{ bans: Array<{ id: string; type: string; group?: string; user?: string }> }>(
      baseUrl,
      "/admin/bans",
      adminToken
    );
    const aliceBan = bans.bans.find((ban) => ban.type === "sonobus-udp" && ban.group === "band" && ban.user === "alice");
    assert.ok(aliceBan);

    const unbanResult = await post<{ removed: number }>(baseUrl, "/admin/bans/remove", adminToken, { id: aliceBan.id });
    assert.equal(unbanResult.removed, 1);

    aliceSocket.send(encodeSbr1({ group: "band", source: "alice" }, Buffer.alloc(0), 0), relayInfo.udpPort, "127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const afterUnban = await get<{ connections: Array<{ type: string; group?: string; user?: string }> }>(
      baseUrl,
      "/admin/connections",
      adminToken
    );
    assert.equal(afterUnban.connections.some((connection) => connection.type === "sonobus-udp" && connection.group === "band" && connection.user === "alice"), true);
  } finally {
    aliceSocket.close();
    await app.close();
  }
});

test("admin controls include SonoBus connection server users", async () => {
  const connectionServer = new FakeConnectionServerAdmin();
  connectionServer.connectionsList = [
    {
      type: "sonobus-connection",
      group: "band",
      user: "alice",
      address: "203.0.113.9",
      port: 32000,
      connectedAt: "2026-06-13T10:00:00.000Z",
      lastSeenAt: "2026-06-13T10:01:00.000Z"
    }
  ];

  const app = await createApp({
    jwtSecret: "test-secret",
    adminUsername: "admin",
    adminPassword: "admin-pass",
    maxBytesPerSecondPerClient: 1024 * 1024,
    connectionServer
  });

  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const adminToken = await login(baseUrl, "admin", "admin-pass");

    const listed = await get<{ connections: Array<{ type: string; group?: string; user?: string }> }>(
      baseUrl,
      "/admin/connections",
      adminToken
    );
    assert.deepEqual(listed.connections.find((connection) => connection.type === "sonobus-connection"), connectionServer.connectionsList[0]);

    const kickResult = await post<{ kicked: number }>(baseUrl, "/admin/connections/kick", adminToken, {
      type: "sonobus-connection",
      group: "band",
      user: "alice"
    });
    assert.equal(kickResult.kicked, 1);
    assert.deepEqual(connectionServer.lastKick, { type: "sonobus-connection", group: "band", user: "alice" });

    const banResult = await post<{ banned: number; expiresAt: string }>(baseUrl, "/admin/bans", adminToken, {
      type: "sonobus-connection",
      group: "band",
      user: "alice",
      ttlSeconds: 60
    });
    assert.equal(banResult.banned, 1);
    assert.equal(connectionServer.lastBan?.type, "sonobus-connection");

    const bans = await get<{ bans: Array<{ id: string; type: string; group?: string; user?: string }> }>(baseUrl, "/admin/bans", adminToken);
    assert.deepEqual(bans.bans, connectionServer.bansList);

    const unbanResult = await post<{ removed: number }>(baseUrl, "/admin/bans/remove", adminToken, { id: "ban-1" });
    assert.equal(unbanResult.removed, 1);
    assert.deepEqual(connectionServer.lastUnban, { id: "ban-1" });
  } finally {
    await app.close();
  }
});

class FakeConnectionServerAdmin implements ConnectionServerAdmin {
  connectionsList: Awaited<ReturnType<ConnectionServerAdmin["connections"]>> = [];
  bansList = [{ id: "ban-1", type: "sonobus-connection" as const, group: "band", user: "alice", expiresAt: "2026-06-13T10:02:00.000Z" }];
  lastKick?: unknown;
  lastBan?: { type?: string };
  lastUnban?: unknown;

  async connections() {
    return this.connectionsList;
  }

  async kick(request: unknown) {
    this.lastKick = request;
    return { kicked: 1 };
  }

  async ban(request: { type?: string }) {
    this.lastBan = request;
    return { banned: 1, expiresAt: "2026-06-13T10:02:00.000Z" };
  }

  async listBans() {
    return this.bansList;
  }

  async unban(request: unknown) {
    this.lastUnban = request;
    return { removed: 1 };
  }
}

async function login(baseUrl: string, username: string, password: string): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { token: string };
  return body.token;
}

async function get<T = unknown>(baseUrl: string, path: string, token: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  assert.ok(response.status >= 200 && response.status < 300, `${path} failed with ${response.status}`);
  return (await response.json()) as T;
}

async function post<T = unknown>(baseUrl: string, path: string, token: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  assert.ok(response.status >= 200 && response.status < 300, `${path} failed with ${response.status}`);
  return (await response.json()) as T;
}

async function onceBinaryMessage(ws: WebSocket): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        resolve(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
      }
    });
    ws.on("error", reject);
  });
}

function decodeJwtSub(token: string): string {
  const [, body] = token.split(".");
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8")).sub as string;
}

async function bindUdp(socket: dgram.Socket): Promise<void> {
  await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve));
}

async function onceUdpMessage(socket: dgram.Socket): Promise<Buffer> {
  return await new Promise((resolve) => socket.once("message", (message) => resolve(message)));
}

function encodeSbr1(header: Record<string, unknown>, payload: Buffer, type = 1): Buffer {
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const packet = Buffer.alloc(10 + headerBytes.length + payload.length);
  packet.write("SBR1", 0, 4, "ascii");
  packet.writeUInt8(1, 4);
  packet.writeUInt8(type, 5);
  packet.writeUInt16BE(headerBytes.length, 6);
  packet.writeUInt16BE(payload.length, 8);
  headerBytes.copy(packet, 10);
  payload.copy(packet, 10 + headerBytes.length);
  return packet;
}
