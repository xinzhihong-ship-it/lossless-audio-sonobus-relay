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
    assert.match(html, /sonobus-connection/);
    assert.match(html, /中继包/);
    assert.match(html, /房间连接 \+ 音频中继/);
    assert.match(html, /connection.type !== "sonobus-udp" && !connection.hasRelay/);
    assert.match(html, /relayCell\(relayStats\)/);
    assert.match(html, /末包 /);
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

test("udp relay routes targeted native SonoBus payloads only to the named peer", async () => {
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
  const carolSocket = dgram.createSocket("udp4");

  try {
    const adminToken = await login(baseUrl, "admin", "admin-pass");
    const roomResponse = await post<{ room: { id: string } }>(baseUrl, "/rooms", adminToken, { name: "sonobus-target-room" });
    const relayInfo = await post<{ udpPort: number }>(baseUrl, `/rooms/${roomResponse.room.id}/relay-session`, adminToken, {});

    await Promise.all([bindUdp(aliceSocket), bindUdp(bobSocket), bindUdp(carolSocket)]);
    aliceSocket.send(encodeSbr1({ group: "band", source: "alice" }, Buffer.alloc(0), 0), relayInfo.udpPort, "127.0.0.1");
    bobSocket.send(encodeSbr1({ group: "band", source: "bob" }, Buffer.alloc(0), 0), relayInfo.udpPort, "127.0.0.1");
    carolSocket.send(encodeSbr1({ group: "band", source: "carol" }, Buffer.alloc(0), 0), relayInfo.udpPort, "127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const payload = Buffer.from([5, 4, 3, 2, 1]);
    const packet = encodeSbr1({ group: "band", source: "alice", target: "bob" }, payload);
    const bobReceived = onceUdpMessage(bobSocket);
    const carolReceived = onceUdpMessage(carolSocket);
    aliceSocket.send(packet, relayInfo.udpPort, "127.0.0.1");

    assert.deepEqual(await bobReceived, packet);
    await assert.rejects(carolReceived, /timed out waiting for UDP message/);
  } finally {
    aliceSocket.close();
    bobSocket.close();
    carolSocket.close();
    await app.close();
  }
});

test("udp relay removes native SonoBus peers immediately when unregister packets arrive", async () => {
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
    const roomResponse = await post<{ room: { id: string } }>(baseUrl, "/rooms", adminToken, { name: "unregister-room" });
    const relayInfo = await post<{ udpPort: number }>(baseUrl, `/rooms/${roomResponse.room.id}/relay-session`, adminToken, {});

    await bindUdp(aliceSocket);
    aliceSocket.send(encodeSbr1({ group: "band", source: "alice" }, Buffer.alloc(0), 0), relayInfo.udpPort, "127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const listed = await get<{ connections: Array<{ type: string; group?: string; user?: string }> }>(
      baseUrl,
      "/admin/connections",
      adminToken
    );
    assert.equal(listed.connections.some((connection) => connection.type === "sonobus-udp" && connection.group === "band" && connection.user === "alice"), true);

    aliceSocket.send(encodeSbr1({ group: "band", source: "alice" }, Buffer.alloc(0), 2), relayInfo.udpPort, "127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const afterUnregister = await get<{ connections: Array<{ type: string; group?: string; user?: string }> }>(
      baseUrl,
      "/admin/connections",
      adminToken
    );
    assert.equal(
      afterUnregister.connections.some((connection) => connection.type === "sonobus-udp" && connection.group === "band" && connection.user === "alice"),
      false
    );
  } finally {
    aliceSocket.close();
    await app.close();
  }
});

test("admin connection list expires inactive native SonoBus UDP peers", async () => {
  const app = await createApp({
    jwtSecret: "test-secret",
    adminUsername: "admin",
    adminPassword: "admin-pass",
    maxBytesPerSecondPerClient: 1024 * 1024,
    udpRelayPort: 0,
    udpRawPeerTtlMs: 30
  });

  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const aliceSocket = dgram.createSocket("udp4");

  try {
    const adminToken = await login(baseUrl, "admin", "admin-pass");
    const roomResponse = await post<{ room: { id: string } }>(baseUrl, "/rooms", adminToken, { name: "expiry-room" });
    const relayInfo = await post<{ udpPort: number }>(baseUrl, `/rooms/${roomResponse.room.id}/relay-session`, adminToken, {});

    await bindUdp(aliceSocket);
    aliceSocket.send(encodeSbr1({ group: "band", source: "alice" }, Buffer.alloc(0), 0), relayInfo.udpPort, "127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 5));

    const listed = await get<{ connections: Array<{ type: string; group?: string; user?: string }> }>(
      baseUrl,
      "/admin/connections",
      adminToken
    );
    assert.equal(listed.connections.some((connection) => connection.type === "sonobus-udp" && connection.group === "band" && connection.user === "alice"), true);

    await new Promise((resolve) => setTimeout(resolve, 40));
    const expired = await get<{ connections: Array<{ type: string; group?: string; user?: string }> }>(
      baseUrl,
      "/admin/connections",
      adminToken
    );
    assert.equal(expired.connections.some((connection) => connection.type === "sonobus-udp" && connection.group === "band" && connection.user === "alice"), false);
  } finally {
    aliceSocket.close();
    await app.close();
  }
});

test("admin connection list includes native SonoBus relay packet counters", async () => {
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
    const roomResponse = await post<{ room: { id: string } }>(baseUrl, "/rooms", adminToken, { name: "stats-room" });
    const relayInfo = await post<{ udpPort: number }>(baseUrl, `/rooms/${roomResponse.room.id}/relay-session`, adminToken, {});

    await Promise.all([bindUdp(aliceSocket), bindUdp(bobSocket)]);
    bobSocket.send(encodeSbr1({ group: "band", source: "bob" }, Buffer.alloc(0), 0), relayInfo.udpPort, "127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 20));

    aliceSocket.send(encodeSbr1({ group: "band", source: "alice" }, Buffer.from([1, 2, 3, 4])), relayInfo.udpPort, "127.0.0.1");
    await onceUdpMessage(bobSocket);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const listed = await get<{
      connections: Array<{
        type: string;
        group?: string;
        user?: string;
        packetsReceived?: number;
        packetsForwarded?: number;
        bytesReceived?: number;
        bytesForwarded?: number;
        lastPacketBytes?: number;
        lastForwardCount?: number;
      }>;
    }>(baseUrl, "/admin/connections", adminToken);
    const alice = listed.connections.find((connection) => connection.type === "sonobus-udp" && connection.group === "band" && connection.user === "alice");
    assert.ok(alice);
    assert.equal(alice.packetsReceived, 1);
    assert.equal(alice.packetsForwarded, 1);
    assert.ok((alice.bytesReceived ?? 0) > 0);
    assert.ok((alice.bytesForwarded ?? 0) > 0);
    assert.equal(alice.lastForwardCount, 1);
    assert.ok((alice.lastPacketBytes ?? 0) > 0);
  } finally {
    aliceSocket.close();
    bobSocket.close();
    await app.close();
  }
});

test("admin connection diagnostics include rejected UDP relay packets", async () => {
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
  const socket = dgram.createSocket("udp4");

  try {
    const adminToken = await login(baseUrl, "admin", "admin-pass");
    const roomResponse = await post<{ room: { id: string } }>(baseUrl, "/rooms", adminToken, { name: "diagnostics-room" });
    const relayInfo = await post<{ udpPort: number }>(baseUrl, `/rooms/${roomResponse.room.id}/relay-session`, adminToken, {});

    await bindUdp(socket);

    const invalidSbr1 = Buffer.alloc(10);
    invalidSbr1.write("SBR1", 0, 4, "ascii");
    invalidSbr1.writeUInt8(1, 4);
    invalidSbr1.writeUInt8(1, 5);
    invalidSbr1.writeUInt16BE(20, 6);
    invalidSbr1.writeUInt16BE(0, 8);
    socket.send(invalidSbr1, relayInfo.udpPort, "127.0.0.1");
    socket.send(Buffer.from("not-a-relay-packet"), relayInfo.udpPort, "127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const listed = await get<{
      diagnostics?: {
        udpRelay?: {
          invalidSonoBusPackets?: number;
          lastInvalidSonoBusPacketReason?: string;
          unknownUdpPackets?: number;
          lastUnknownUdpPacketFrom?: string;
        };
      };
    }>(baseUrl, "/admin/connections", adminToken);

    assert.equal(listed.diagnostics?.udpRelay?.invalidSonoBusPackets, 1);
    assert.match(listed.diagnostics?.udpRelay?.lastInvalidSonoBusPacketReason ?? "", /length mismatch/);
    assert.equal(listed.diagnostics?.udpRelay?.unknownUdpPackets, 1);
    assert.match(listed.diagnostics?.udpRelay?.lastUnknownUdpPacketFrom ?? "", /127\.0\.0\.1:/);
  } finally {
    socket.close();
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

test("admin can create permanent UDP relay bans", async () => {
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

  try {
    const adminToken = await login(baseUrl, "admin", "admin-pass");
    const result = await post<{ banned: number; expiresAt: string | null }>(baseUrl, "/admin/bans", adminToken, {
      type: "sonobus-udp",
      group: "band",
      user: "alice",
      ttlSeconds: 0
    });
    assert.equal(result.expiresAt, null);

    const bans = await get<{ bans: Array<{ id: string; expiresAt: string | null }> }>(baseUrl, "/admin/bans", adminToken);
    assert.equal(bans.bans.length, 1);
    assert.equal(bans.bans[0].expiresAt, null);
  } finally {
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

    const bans = await get<{ bans: Array<{ id: string; type: string; group?: string; user?: string; expiresAt?: string | null }> }>(
      baseUrl,
      "/admin/bans",
      adminToken
    );
    assert.equal(bans.bans.length, 1);
    assert.equal(bans.bans[0].type, "sonobus-connection");
    assert.equal(bans.bans[0].group, "band");
    assert.equal(bans.bans[0].user, "alice");
    assert.match(bans.bans[0].id, /^[0-9a-f-]{36}$/);

    const unbanResult = await post<{ removed: number }>(baseUrl, "/admin/bans/remove", adminToken, { id: bans.bans[0].id });
    assert.equal(unbanResult.removed, 1);
    assert.deepEqual(connectionServer.lastUnban, { type: "sonobus-connection", group: "band", user: "alice" });
  } finally {
    await app.close();
  }
});

test("admin connection list merges SonoBus connection and relay rows for the same user", async () => {
  const connectionServer = new FakeConnectionServerAdmin();
  connectionServer.connectionsList = [
    {
      type: "sonobus-connection",
      group: "band",
      user: "alice",
      address: "127.0.0.1",
      port: 32000,
      connectedAt: "2026-06-13T10:00:00.000Z"
    }
  ];

  const app = await createApp({
    jwtSecret: "test-secret",
    adminUsername: "admin",
    adminPassword: "admin-pass",
    maxBytesPerSecondPerClient: 1024 * 1024,
    udpRelayPort: 0,
    connectionServer
  });

  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const aliceSocket = dgram.createSocket("udp4");

  try {
    const adminToken = await login(baseUrl, "admin", "admin-pass");
    const roomResponse = await post<{ room: { id: string } }>(baseUrl, "/rooms", adminToken, { name: "merge-room" });
    const relayInfo = await post<{ udpPort: number }>(baseUrl, `/rooms/${roomResponse.room.id}/relay-session`, adminToken, {});

    await bindUdp(aliceSocket);
    aliceSocket.send(encodeSbr1({ group: "band", source: "alice" }, Buffer.alloc(0), 0), relayInfo.udpPort, "127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const listed = await get<{
      connections: Array<{
        type: string;
        group?: string;
        user?: string;
        lastSeenAt?: string;
        hasRelay?: boolean;
        packetsReceived?: number;
        lastPacketBytes?: number;
      }>;
    }>(
      baseUrl,
      "/admin/connections",
      adminToken
    );
    const aliceRows = listed.connections.filter((connection) => connection.group === "band" && connection.user === "alice");
    assert.equal(aliceRows.length, 1);
    assert.equal(aliceRows[0].type, "sonobus-connection");
    assert.equal(aliceRows[0].hasRelay, true);
    assert.equal(aliceRows[0].packetsReceived, 1);
    assert.ok((aliceRows[0].lastPacketBytes ?? 0) > 0);
    assert.ok(aliceRows[0].lastSeenAt);
  } finally {
    aliceSocket.close();
    await app.close();
  }
});

test("admin connection list merges SonoBus connection and relay rows even when observed addresses differ", async () => {
  const connectionServer = new FakeConnectionServerAdmin();
  connectionServer.connectionsList = [
    {
      type: "sonobus-connection",
      group: "band",
      user: "alice",
      address: "203.0.113.10",
      port: 32000,
      connectedAt: "2026-06-13T10:00:00.000Z"
    }
  ];

  const app = await createApp({
    jwtSecret: "test-secret",
    adminUsername: "admin",
    adminPassword: "admin-pass",
    maxBytesPerSecondPerClient: 1024 * 1024,
    udpRelayPort: 0,
    connectionServer
  });

  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const aliceSocket = dgram.createSocket("udp4");

  try {
    const adminToken = await login(baseUrl, "admin", "admin-pass");
    const roomResponse = await post<{ room: { id: string } }>(baseUrl, "/rooms", adminToken, { name: "merge-address-room" });
    const relayInfo = await post<{ udpPort: number }>(baseUrl, `/rooms/${roomResponse.room.id}/relay-session`, adminToken, {});

    await bindUdp(aliceSocket);
    aliceSocket.send(encodeSbr1({ group: "band", source: "alice" }, Buffer.alloc(0), 0), relayInfo.udpPort, "127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const listed = await get<{ connections: Array<{ type: string; group?: string; user?: string; address?: string; lastSeenAt?: string }> }>(
      baseUrl,
      "/admin/connections",
      adminToken
    );
    const aliceRows = listed.connections.filter((connection) => connection.group === "band" && connection.user === "alice");
    assert.equal(aliceRows.length, 1);
    assert.equal(aliceRows[0].type, "sonobus-connection");
    assert.equal(aliceRows[0].address, "203.0.113.10");
    assert.ok(aliceRows[0].lastSeenAt);
  } finally {
    aliceSocket.close();
    await app.close();
  }
});

test("admin merged SonoBus rows kick and ban the UDP relay peer", async () => {
  const connectionServer = new FakeConnectionServerAdmin();
  connectionServer.connectionsList = [
    {
      type: "sonobus-connection",
      group: "band",
      user: "alice",
      address: "203.0.113.10",
      port: 32000,
      connectedAt: "2026-06-13T10:00:00.000Z"
    }
  ];

  const app = await createApp({
    jwtSecret: "test-secret",
    adminUsername: "admin",
    adminPassword: "admin-pass",
    maxBytesPerSecondPerClient: 1024 * 1024,
    udpRelayPort: 0,
    connectionServer
  });

  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const aliceSocket = dgram.createSocket("udp4");

  try {
    const adminToken = await login(baseUrl, "admin", "admin-pass");
    const roomResponse = await post<{ room: { id: string } }>(baseUrl, "/rooms", adminToken, { name: "merged-control-room" });
    const relayInfo = await post<{ udpPort: number }>(baseUrl, `/rooms/${roomResponse.room.id}/relay-session`, adminToken, {});

    await bindUdp(aliceSocket);
    aliceSocket.send(encodeSbr1({ group: "band", source: "alice" }, Buffer.alloc(0), 0), relayInfo.udpPort, "127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const kickResult = await post<{ kicked: number }>(baseUrl, "/admin/connections/kick", adminToken, {
      type: "sonobus-connection",
      group: "band",
      user: "alice",
      address: "203.0.113.10",
      hasRelay: true
    });
    assert.equal(kickResult.kicked, 2);

    const afterKick = await get<{ connections: Array<{ type: string; group?: string; user?: string; hasRelay?: boolean }> }>(
      baseUrl,
      "/admin/connections",
      adminToken
    );
    const aliceAfterKick = afterKick.connections.find((connection) => connection.group === "band" && connection.user === "alice");
    assert.equal(aliceAfterKick?.type, "sonobus-connection");
    assert.equal(aliceAfterKick?.hasRelay, undefined);

    aliceSocket.send(encodeSbr1({ group: "band", source: "alice" }, Buffer.alloc(0), 0), relayInfo.udpPort, "127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const banResult = await post<{ banned: number }>(baseUrl, "/admin/bans", adminToken, {
      type: "sonobus-connection",
      group: "band",
      user: "alice",
      address: "203.0.113.10",
      hasRelay: true,
      ttlSeconds: 60
    });
    assert.equal(banResult.banned, 2);

    aliceSocket.send(encodeSbr1({ group: "band", source: "alice" }, Buffer.alloc(0), 0), relayInfo.udpPort, "127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const afterBan = await get<{ connections: Array<{ type: string; group?: string; user?: string; hasRelay?: boolean }> }>(
      baseUrl,
      "/admin/connections",
      adminToken
    );
    const aliceAfterBan = afterBan.connections.find((connection) => connection.group === "band" && connection.user === "alice");
    assert.equal(aliceAfterBan?.type, "sonobus-connection");
    assert.equal(aliceAfterBan?.hasRelay, undefined);

    const bans = await get<{ bans: Array<{ id: string; type: string; group?: string; user?: string; address?: string }> }>(
      baseUrl,
      "/admin/bans",
      adminToken
    );
    const aliceBan = bans.bans.find((ban) => ban.type === "sonobus-connection" && ban.group === "band" && ban.user === "alice");
    assert.ok(aliceBan);

    const unbanResult = await post<{ removed: number }>(baseUrl, "/admin/bans/remove", adminToken, { id: aliceBan.id });
    assert.equal(unbanResult.removed, 1);
    assert.equal((connectionServer.lastUnban as { group?: string }).group, "band");
    assert.equal((connectionServer.lastUnban as { user?: string }).user, "alice");
    assert.equal((connectionServer.lastUnban as { address?: string }).address, "203.0.113.10");

    aliceSocket.send(encodeSbr1({ group: "band", source: "alice" }, Buffer.alloc(0), 0), relayInfo.udpPort, "127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const afterUnban = await get<{ connections: Array<{ type: string; group?: string; user?: string; hasRelay?: boolean }> }>(
      baseUrl,
      "/admin/connections",
      adminToken
    );
    const aliceAfterUnban = afterUnban.connections.find((connection) => connection.group === "band" && connection.user === "alice");
    assert.equal(aliceAfterUnban?.type, "sonobus-connection");
    assert.equal(aliceAfterUnban?.hasRelay, true);
  } finally {
    aliceSocket.close();
    await app.close();
  }
});

test("admin can create permanent SonoBus connection server bans", async () => {
  const connectionServer = new FakeConnectionServerAdmin();
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
    connectionServer.nextBanResult = { banned: 1, expiresAt: null };

    const result = await post<{ banned: number; expiresAt: string | null }>(baseUrl, "/admin/bans", adminToken, {
      type: "sonobus-connection",
      group: "band",
      user: "alice",
      address: "203.0.113.9",
      ttlSeconds: 0
    });

    assert.equal(result.expiresAt, null);
    assert.deepEqual(connectionServer.lastBan, {
      type: "sonobus-connection",
      group: "band",
      user: "alice",
      address: "203.0.113.9",
      ttlSeconds: 0
    });
  } finally {
    await app.close();
  }
});

test("persistent SonoBus connection server bans survive app restarts", async () => {
  const store = new MemoryStore();
  const firstConnectionServer = new FakeConnectionServerAdmin();
  const firstApp = await createApp({
    jwtSecret: "test-secret",
    adminUsername: "admin",
    adminPassword: "admin-pass",
    maxBytesPerSecondPerClient: 1024 * 1024,
    store,
    connectionServer: firstConnectionServer
  });

  await new Promise<void>((resolve) => firstApp.server.listen(0, "127.0.0.1", resolve));
  const firstAddress = firstApp.server.address();
  assert(firstAddress && typeof firstAddress === "object");
  const firstBaseUrl = `http://127.0.0.1:${firstAddress.port}`;

  const adminToken = await login(firstBaseUrl, "admin", "admin-pass");
  await post(firstBaseUrl, "/admin/bans", adminToken, {
    type: "sonobus-connection",
    group: "band",
    user: "alice",
    address: "203.0.113.9",
    ttlSeconds: 0
  });
  await firstApp.close();

  const secondConnectionServer = new FakeConnectionServerAdmin();
  const secondApp = await createApp({
    jwtSecret: "test-secret",
    adminUsername: "admin",
    adminPassword: "admin-pass",
    maxBytesPerSecondPerClient: 1024 * 1024,
    store,
    connectionServer: secondConnectionServer
  });

  await new Promise<void>((resolve) => secondApp.server.listen(0, "127.0.0.1", resolve));
  const secondAddress = secondApp.server.address();
  assert(secondAddress && typeof secondAddress === "object");
  const secondBaseUrl = `http://127.0.0.1:${secondAddress.port}`;

  try {
    assert.deepEqual(secondConnectionServer.lastBan, {
      type: "sonobus-connection",
      group: "band",
      user: "alice",
      address: "203.0.113.9",
      ttlSeconds: 0
    });

    const secondToken = await login(secondBaseUrl, "admin", "admin-pass");
    const bans = await get<{ bans: Array<{ type: string; group?: string; user?: string; address?: string; expiresAt: string | null }> }>(
      secondBaseUrl,
      "/admin/bans",
      secondToken
    );
    assert.deepEqual(bans.bans.map(({ type, group, user, address, expiresAt }) => ({ type, group, user, address, expiresAt })), [
      {
        type: "sonobus-connection",
        group: "band",
        user: "alice",
        address: "203.0.113.9",
        expiresAt: null
      }
    ]);
  } finally {
    await secondApp.close();
  }
});

test("persistent UDP relay bans survive app restarts and keep blocking peers", async () => {
  const store = new MemoryStore();
  const firstApp = await createApp({
    jwtSecret: "test-secret",
    adminUsername: "admin",
    adminPassword: "admin-pass",
    maxBytesPerSecondPerClient: 1024 * 1024,
    udpRelayPort: 0,
    store
  });

  await new Promise<void>((resolve) => firstApp.server.listen(0, "127.0.0.1", resolve));
  const firstAddress = firstApp.server.address();
  assert(firstAddress && typeof firstAddress === "object");
  const firstBaseUrl = `http://127.0.0.1:${firstAddress.port}`;

  const adminToken = await login(firstBaseUrl, "admin", "admin-pass");
  await post(firstBaseUrl, "/admin/bans", adminToken, {
    type: "sonobus-udp",
    group: "band",
    user: "alice",
    ttlSeconds: 0
  });
  await firstApp.close();

  const secondApp = await createApp({
    jwtSecret: "test-secret",
    adminUsername: "admin",
    adminPassword: "admin-pass",
    maxBytesPerSecondPerClient: 1024 * 1024,
    udpRelayPort: 0,
    store
  });

  await new Promise<void>((resolve) => secondApp.server.listen(0, "127.0.0.1", resolve));
  const secondAddress = secondApp.server.address();
  assert(secondAddress && typeof secondAddress === "object");
  const secondBaseUrl = `http://127.0.0.1:${secondAddress.port}`;

  const aliceSocket = dgram.createSocket("udp4");

  try {
    const secondToken = await login(secondBaseUrl, "admin", "admin-pass");
    const roomResponse = await post<{ room: { id: string } }>(secondBaseUrl, "/rooms", secondToken, { name: "persisted-ban-room" });
    const relayInfo = await post<{ udpPort: number }>(secondBaseUrl, `/rooms/${roomResponse.room.id}/relay-session`, secondToken, {});

    await bindUdp(aliceSocket);
    aliceSocket.send(encodeSbr1({ group: "band", source: "alice" }, Buffer.alloc(0), 0), relayInfo.udpPort, "127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const connections = await get<{ connections: Array<{ type: string; group?: string; user?: string }> }>(
      secondBaseUrl,
      "/admin/connections",
      secondToken
    );
    assert.equal(connections.connections.some((connection) => connection.type === "sonobus-udp" && connection.group === "band" && connection.user === "alice"), false);

    const bans = await get<{ bans: Array<{ type: string; group?: string; user?: string; expiresAt: string | null }> }>(
      secondBaseUrl,
      "/admin/bans",
      secondToken
    );
    assert.deepEqual(bans.bans.map(({ type, group, user, expiresAt }) => ({ type, group, user, expiresAt })), [
      { type: "sonobus-udp", group: "band", user: "alice", expiresAt: null }
    ]);
  } finally {
    aliceSocket.close();
    await secondApp.close();
  }
});

test("removing a persistent ban deletes it from restart restore state", async () => {
  const store = new MemoryStore();
  const firstConnectionServer = new FakeConnectionServerAdmin();
  const firstApp = await createApp({
    jwtSecret: "test-secret",
    adminUsername: "admin",
    adminPassword: "admin-pass",
    maxBytesPerSecondPerClient: 1024 * 1024,
    store,
    connectionServer: firstConnectionServer
  });

  await new Promise<void>((resolve) => firstApp.server.listen(0, "127.0.0.1", resolve));
  const firstAddress = firstApp.server.address();
  assert(firstAddress && typeof firstAddress === "object");
  const firstBaseUrl = `http://127.0.0.1:${firstAddress.port}`;

  const adminToken = await login(firstBaseUrl, "admin", "admin-pass");
  await post(firstBaseUrl, "/admin/bans", adminToken, {
    type: "sonobus-connection",
    group: "band",
    user: "alice",
    address: "203.0.113.9",
    ttlSeconds: 0
  });
  const firstBans = await get<{ bans: Array<{ id: string }> }>(firstBaseUrl, "/admin/bans", adminToken);
  assert.equal(firstBans.bans.length, 1);
  await post(firstBaseUrl, "/admin/bans/remove", adminToken, { id: firstBans.bans[0].id });
  await firstApp.close();

  const secondConnectionServer = new FakeConnectionServerAdmin();
  const secondApp = await createApp({
    jwtSecret: "test-secret",
    adminUsername: "admin",
    adminPassword: "admin-pass",
    maxBytesPerSecondPerClient: 1024 * 1024,
    store,
    connectionServer: secondConnectionServer
  });

  await new Promise<void>((resolve) => secondApp.server.listen(0, "127.0.0.1", resolve));
  const secondAddress = secondApp.server.address();
  assert(secondAddress && typeof secondAddress === "object");
  const secondBaseUrl = `http://127.0.0.1:${secondAddress.port}`;

  try {
    assert.equal(secondConnectionServer.lastBan, undefined);
    const secondToken = await login(secondBaseUrl, "admin", "admin-pass");
    const secondBans = await get<{ bans: Array<{ id: string }> }>(secondBaseUrl, "/admin/bans", secondToken);
    assert.equal(secondBans.bans.length, 0);
  } finally {
    await secondApp.close();
  }
});

class FakeConnectionServerAdmin implements ConnectionServerAdmin {
  connectionsList: Awaited<ReturnType<ConnectionServerAdmin["connections"]>> = [];
  bansList = [{ id: "ban-1", type: "sonobus-connection" as const, group: "band", user: "alice", expiresAt: "2026-06-13T10:02:00.000Z" }];
  lastKick?: unknown;
  lastBan?: { type?: string; group?: string; user?: string; address?: string; ttlSeconds?: number };
  lastUnban?: unknown;
  nextBanResult: Awaited<ReturnType<ConnectionServerAdmin["ban"]>> = { banned: 1, expiresAt: "2026-06-13T10:02:00.000Z" };

  async connections() {
    return this.connectionsList;
  }

  async kick(request: unknown) {
    this.lastKick = request;
    return { kicked: 1 };
  }

  async ban(request: { type?: string; group?: string; user?: string; address?: string; ttlSeconds?: number }) {
    this.lastBan = request;
    return this.nextBanResult;
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
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("timed out waiting for UDP message"));
    }, 500);
    const onMessage = (message: Buffer) => {
      clearTimeout(timeout);
      resolve(message);
    };
    socket.once("message", onMessage);
  });
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
