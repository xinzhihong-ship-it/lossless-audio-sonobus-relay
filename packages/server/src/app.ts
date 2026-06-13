import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { WebSocketServer } from "ws";
import { signToken, verifyPassword, verifyToken, type TokenClaims } from "./auth.js";
import { RoomHub } from "./roomHub.js";
import { MemoryStore, PostgresStore, type Store } from "./store.js";
import { UdpRelay } from "./udpRelay.js";

export type ServerConfig = {
  jwtSecret: string;
  adminUsername: string;
  adminPassword: string;
  databaseUrl?: string;
  maxBytesPerSecondPerClient: number;
  udpRelayPort?: number;
  store?: Store;
};

export type App = {
  server: http.Server;
  store: Store;
  close(): Promise<void>;
};

export async function createApp(config: ServerConfig): Promise<App> {
  const store = config.store ?? (config.databaseUrl ? new PostgresStore(config.databaseUrl) : new MemoryStore());
  await store.init();
  await ensureAdmin(store, config.adminUsername, config.adminPassword);

  const hub = new RoomHub({ maxBytesPerSecondPerClient: config.maxBytesPerSecondPerClient });
  const udpRelay = config.udpRelayPort === undefined ? undefined : new UdpRelay(config.udpRelayPort);
  await udpRelay?.start();
  const server = http.createServer((req, res) => {
    handleHttp(req, res, store, config, hub, udpRelay).catch((error) => {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Internal server error." });
    });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", async (req, socket, head) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const match = url.pathname.match(/^\/rooms\/([^/]+)\/stream$/);
      if (!match) {
        socket.destroy();
        return;
      }

      const token = url.searchParams.get("token") ?? "";
      const claims = verifyToken(token, config.jwtSecret);
      const room = await store.getRoom(match[1]);
      if (!room) {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        hub.join(room.id, claims.sub, claims.username, ws);
      });
    } catch {
      socket.destroy();
    }
  });

  return {
    server,
    store,
    async close() {
      wss.close();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await udpRelay?.stop();
      await store.close();
    }
  };
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  store: Store,
  config: ServerConfig,
  hub: RoomHub,
  udpRelay?: UdpRelay
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/auth/login") {
    const body = await readJson<{ username?: string; password?: string }>(req);
    if (!body.username || !body.password) {
      sendJson(res, 400, { error: "username and password are required." });
      return;
    }

    const user = await store.getUserByUsername(body.username);
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      sendJson(res, 401, { error: "Invalid credentials." });
      return;
    }

    sendJson(res, 200, {
      token: signToken({ sub: user.id, username: user.username, role: user.role }, config.jwtSecret),
      user: { id: user.id, username: user.username, role: user.role }
    });
    return;
  }

  const claims = authenticate(req, config);
  if (!claims) {
    sendJson(res, 401, { error: "Missing or invalid bearer token." });
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin/users") {
    if (claims.role !== "admin") {
      sendJson(res, 403, { error: "Admin role required." });
      return;
    }
    const body = await readJson<{ username?: string; password?: string; role?: "admin" | "user" }>(req);
    if (!body.username || !body.password) {
      sendJson(res, 400, { error: "username and password are required." });
      return;
    }
    const user = await store.createUser(body.username, body.password, body.role ?? "user");
    sendJson(res, 201, { id: user.id, username: user.username, role: user.role });
    return;
  }

  if (req.method === "GET" && url.pathname === "/rooms") {
    sendJson(res, 200, { rooms: await store.listRooms() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/rooms") {
    const body = await readJson<{ name?: string }>(req);
    if (!body.name) {
      sendJson(res, 400, { error: "room name is required." });
      return;
    }
    sendJson(res, 201, { room: await store.createRoom(body.name, claims.sub) });
    return;
  }

  const joinMatch = url.pathname.match(/^\/rooms\/([^/]+)\/join$/);
  if (req.method === "POST" && joinMatch) {
    const room = await store.getRoom(joinMatch[1]);
    if (!room) {
      sendJson(res, 404, { error: "Room not found." });
      return;
    }
    sendJson(res, 200, {
      room,
      members: hub.members(room.id),
      streamUrl: `/rooms/${room.id}/stream`
    });
    return;
  }

  const relayMatch = url.pathname.match(/^\/rooms\/([^/]+)\/relay-session$/);
  if (req.method === "POST" && relayMatch) {
    if (!udpRelay) {
      sendJson(res, 503, { error: "UDP relay is disabled." });
      return;
    }
    const room = await store.getRoom(relayMatch[1]);
    if (!room) {
      sendJson(res, 404, { error: "Room not found." });
      return;
    }
    const session = udpRelay.createSession(room.id, claims.sub, claims.username);
    sendJson(res, 201, {
      sessionId: session.sessionId,
      roomId: room.id,
      userId: claims.sub,
      udpPort: udpRelay.publicPort
    });
    return;
  }

  sendJson(res, 404, { error: "Not found." });
}

async function ensureAdmin(store: Store, username: string, password: string): Promise<void> {
  const existing = await store.getUserByUsername(username);
  if (!existing) {
    await store.createUser(username, password, "admin");
    return;
  }

  if (existing.role !== "admin" || !verifyPassword(password, existing.passwordHash)) {
    await store.updateUserCredentials(username, password, "admin");
  }
}

function authenticate(req: IncomingMessage, config: ServerConfig): TokenClaims | undefined {
  const auth = req.headers.authorization ?? "";
  const match = auth.match(/^Bearer (.+)$/);
  if (!match) {
    return undefined;
  }
  try {
    return verifyToken(match[1], config.jwtSecret);
  } catch {
    return undefined;
  }
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {} as T;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.byteLength,
    "access-control-allow-origin": "*"
  });
  res.end(payload);
}
