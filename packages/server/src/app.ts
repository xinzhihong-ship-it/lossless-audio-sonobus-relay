import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { WebSocketServer } from "ws";
import { signToken, verifyPassword, verifyToken, type TokenClaims } from "./auth.js";
import { HttpConnectionServerAdmin, type ConnectionServerAdmin } from "./connectionServerAdmin.js";
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
  connectionServerAdminUrl?: string;
  connectionServer?: ConnectionServerAdmin;
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
  const connectionServer = config.connectionServer ?? (config.connectionServerAdminUrl ? new HttpConnectionServerAdmin(config.connectionServerAdminUrl) : undefined);
  await udpRelay?.start();
  const server = http.createServer((req, res) => {
    handleHttp(req, res, store, config, hub, udpRelay, connectionServer).catch((error) => {
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
  udpRelay?: UdpRelay,
  connectionServer?: ConnectionServerAdmin
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && (url.pathname === "/admin" || url.pathname === "/admin/")) {
    sendHtml(res, 200, adminPageHtml);
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

  if (req.method === "GET" && url.pathname === "/admin/connections") {
    if (claims.role !== "admin") {
      sendJson(res, 403, { error: "Admin role required." });
      return;
    }
    sendJson(res, 200, {
      connections: [
        ...hub.connections(),
        ...(udpRelay?.connections() ?? []),
        ...((await connectionServer?.connections()) ?? [])
      ]
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin/connections/kick") {
    if (claims.role !== "admin") {
      sendJson(res, 403, { error: "Admin role required." });
      return;
    }
    const body = await readJson<{
      type?: "websocket" | "udp-session" | "sonobus-udp" | "sonobus-connection";
      roomId?: string;
      userId?: string;
      username?: string;
      sessionId?: string;
      group?: string;
      user?: string;
      address?: string;
    }>(req);
    const udpKick =
      body.type === "websocket" || body.type === "sonobus-connection"
        ? undefined
        : {
            ...body,
            type: body.type
          };
    const websocketKicked = !body.type || body.type === "websocket" ? hub.kick(body) : 0;
    const udpResult = udpKick ? udpRelay?.kick(udpKick) : undefined;
    const connectionResult = body.type === "sonobus-connection" ? await connectionServer?.kick(toConnectionKick(body)) : undefined;
    sendJson(res, 200, {
      kicked: websocketKicked + (udpResult?.kicked ?? 0) + (connectionResult?.kicked ?? 0)
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin/bans") {
    if (claims.role !== "admin") {
      sendJson(res, 403, { error: "Admin role required." });
      return;
    }
    if (!udpRelay && !connectionServer) {
      sendJson(res, 503, { error: "UDP relay is disabled." });
      return;
    }
    const body = await readJson<{
      type?: "udp-session" | "sonobus-udp" | "sonobus-connection";
      roomId?: string;
      userId?: string;
      group?: string;
      user?: string;
      address?: string;
      ttlSeconds?: number;
    }>(req);
    if (body.type === "sonobus-connection") {
      if (!connectionServer) {
        sendJson(res, 503, { error: "SonoBus connection server admin is disabled." });
        return;
      }
      sendJson(res, 200, await connectionServer.ban(toConnectionBan(body)));
      return;
    }
    if (!udpRelay) {
      sendJson(res, 503, { error: "UDP relay is disabled." });
      return;
    }
    sendJson(res, 200, udpRelay.ban(toUdpBan(body)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/admin/bans") {
    if (claims.role !== "admin") {
      sendJson(res, 403, { error: "Admin role required." });
      return;
    }
    if (!udpRelay && !connectionServer) {
      sendJson(res, 503, { error: "UDP relay is disabled." });
      return;
    }
    sendJson(res, 200, { bans: [...(udpRelay?.listBans() ?? []), ...((await connectionServer?.listBans()) ?? [])] });
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin/bans/remove") {
    if (claims.role !== "admin") {
      sendJson(res, 403, { error: "Admin role required." });
      return;
    }
    if (!udpRelay && !connectionServer) {
      sendJson(res, 503, { error: "UDP relay is disabled." });
      return;
    }
    const body = await readJson<{
      id?: string;
      type?: "udp-session" | "sonobus-udp" | "sonobus-connection";
      roomId?: string;
      userId?: string;
      group?: string;
      user?: string;
      address?: string;
    }>(req);
    if (body.type === "sonobus-connection" || (body.id && !udpRelay?.listBans().some((ban) => ban.id === body.id))) {
      const result = await connectionServer?.unban(toConnectionUnban(body));
      if (result) {
        sendJson(res, 200, result);
        return;
      }
    }
    if (!udpRelay) {
      sendJson(res, 503, { error: "UDP relay is disabled." });
      return;
    }
    sendJson(res, 200, udpRelay.unban(toUdpUnban(body)));
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

function toConnectionKick(body: { group?: string; user?: string; address?: string }) {
  return compact({ type: "sonobus-connection" as const, group: body.group, user: body.user, address: body.address });
}

function toConnectionBan(body: { group?: string; user?: string; address?: string; ttlSeconds?: number }) {
  return compact({ ...toConnectionKick(body), ttlSeconds: body.ttlSeconds });
}

function toConnectionUnban(body: { id?: string; group?: string; user?: string; address?: string }) {
  if (body.id) {
    return { id: body.id };
  }
  return compact({ id: body.id, ...toConnectionKick(body) });
}

function toUdpBan(body: { type?: "udp-session" | "sonobus-udp" | "sonobus-connection"; roomId?: string; userId?: string; group?: string; user?: string; address?: string; ttlSeconds?: number }) {
  return {
    type: body.type === "udp-session" ? "udp-session" as const : "sonobus-udp" as const,
    roomId: body.roomId,
    userId: body.userId,
    group: body.group,
    user: body.user,
    address: body.address,
    ttlSeconds: body.ttlSeconds
  };
}

function toUdpUnban(body: { id?: string; type?: "udp-session" | "sonobus-udp" | "sonobus-connection"; roomId?: string; userId?: string; group?: string; user?: string; address?: string }) {
  return {
    id: body.id,
    type: body.type === "udp-session" ? "udp-session" as const : "sonobus-udp" as const,
    roomId: body.roomId,
    userId: body.userId,
    group: body.group,
    user: body.user,
    address: body.address
  };
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
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

function sendHtml(res: ServerResponse, status: number, html: string): void {
  const payload = Buffer.from(html, "utf8");
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": payload.byteLength,
    "cache-control": "no-store"
  });
  res.end(payload);
}

const adminPageHtml = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>服务器管理</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      background: #111418;
      color: #edf1f5;
    }
    body {
      margin: 0;
      background: #111418;
    }
    main {
      max-width: 1120px;
      margin: 0 auto;
      padding: 24px;
      box-sizing: border-box;
    }
    h1 {
      font-size: 24px;
      margin: 0 0 18px;
      letter-spacing: 0;
    }
    h2 {
      font-size: 17px;
      margin: 0 0 12px;
      letter-spacing: 0;
    }
    section {
      border-top: 1px solid #303842;
      padding: 18px 0;
    }
    .row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: end;
    }
    label {
      display: grid;
      gap: 6px;
      color: #b8c2cc;
      font-size: 13px;
    }
    input, select, button {
      font: inherit;
      min-height: 36px;
      max-width: 100%;
      border-radius: 6px;
      border: 1px solid #3a4550;
      background: #191f26;
      color: #edf1f5;
      padding: 0 10px;
      box-sizing: border-box;
    }
    input {
      min-width: 180px;
    }
    #baseUrl {
      width: 260px;
    }
    button {
      cursor: pointer;
      background: #225d8f;
      border-color: #2d77b4;
      font-weight: 600;
      white-space: nowrap;
    }
    button.secondary {
      background: #28313a;
      border-color: #3a4550;
    }
    button.danger {
      background: #8d2d2d;
      border-color: #b23a3a;
    }
    button:disabled {
      opacity: .55;
      cursor: not-allowed;
    }
    .table-wrap {
      width: 100%;
      overflow-x: auto;
      margin-top: 12px;
      border: 1px solid #2b333c;
      border-radius: 6px;
    }
    table {
      width: 100%;
      min-width: 860px;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      border-bottom: 1px solid #2b333c;
      padding: 9px 8px;
      text-align: left;
      vertical-align: middle;
    }
    td {
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    td:nth-child(7) {
      max-width: none;
      white-space: normal;
    }
    th {
      color: #b8c2cc;
      font-weight: 600;
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .status {
      min-height: 22px;
      margin-top: 10px;
      color: #a7d7ff;
      font-size: 13px;
      white-space: pre-wrap;
    }
    .subtle {
      color: #95a0aa;
      font-size: 12px;
      margin-top: 6px;
    }
    .error {
      color: #ffb2b2;
    }
    .muted {
      color: #95a0aa;
    }
    @media (max-width: 760px) {
      main {
        padding: 16px;
      }
      input {
        width: 100%;
        min-width: 0;
      }
      #baseUrl {
        width: 100%;
      }
      .row label {
        width: 100%;
      }
      .table-wrap {
        overflow-x: visible;
        border: 0;
      }
      table {
        min-width: 0;
      }
      table, thead, tbody, th, td, tr {
        display: block;
      }
      thead {
        display: none;
      }
      tr {
        border: 1px solid #2b333c;
        border-radius: 6px;
        margin: 10px 0;
        padding: 8px;
      }
      td {
        border: 0;
        padding: 6px 0;
        max-width: none;
        white-space: normal;
        overflow-wrap: anywhere;
      }
      td::before {
        content: attr(data-label);
        display: block;
        color: #95a0aa;
        font-size: 12px;
      }
    }
  </style>
</head>
<body>
  <main>
    <h1>服务器管理</h1>

    <section>
      <h2>管理员登录</h2>
      <div class="row">
        <label>服务器地址
          <input id="baseUrl" autocomplete="url">
        </label>
        <label>管理员账号
          <input id="username" autocomplete="username" value="admin">
        </label>
        <label>管理员密码
          <input id="password" type="password" autocomplete="current-password">
        </label>
        <button id="loginBtn">登录</button>
        <button class="secondary" id="logoutBtn">退出</button>
      </div>
      <div id="loginStatus" class="status"></div>
    </section>

    <section>
      <h2>在线连接</h2>
      <div class="row">
        <button id="refreshBtn">刷新</button>
        <label>封禁时长
          <select id="banSeconds">
            <option value="600">10 分钟</option>
            <option value="3600" selected>1 小时</option>
            <option value="86400">1 天</option>
          </select>
        </label>
      </div>
      <div id="connectionStatus" class="status"></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>类型</th>
              <th>房间/群组</th>
              <th>用户</th>
              <th>IP</th>
              <th>端口</th>
              <th>最后活跃</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="connectionsBody">
            <tr><td colspan="7" class="muted">登录后点击刷新。</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>封禁列表</h2>
      <div class="row">
        <button id="refreshBansBtn">刷新封禁</button>
      </div>
      <div class="subtle">误封后可在这里解除。封禁当前保存在服务进程内存里，重启 Docker 后会清空。</div>
      <div id="banStatus" class="status"></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>类型</th>
              <th>房间/群组</th>
              <th>用户</th>
              <th>IP</th>
              <th>到期时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="bansBody">
            <tr><td colspan="6" class="muted">登录后点击刷新封禁。</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>

  <script>
    const tokenKey = "lossless-admin-token";
    const baseUrlInput = document.getElementById("baseUrl");
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const loginStatus = document.getElementById("loginStatus");
    const connectionStatus = document.getElementById("connectionStatus");
    const banStatus = document.getElementById("banStatus");
    const body = document.getElementById("connectionsBody");
    const bansBody = document.getElementById("bansBody");
    const banSeconds = document.getElementById("banSeconds");

    baseUrlInput.value = location.origin;

    document.getElementById("loginBtn").addEventListener("click", login);
    document.getElementById("logoutBtn").addEventListener("click", logout);
    document.getElementById("refreshBtn").addEventListener("click", refreshConnections);
    document.getElementById("refreshBansBtn").addEventListener("click", refreshBans);

    if (localStorage.getItem(tokenKey)) {
      setStatus(loginStatus, "已保存登录状态。");
      refreshConnections();
      refreshBans();
    }

    async function login() {
      setStatus(loginStatus, "正在登录...");
      try {
        const response = await fetch(apiUrl("/auth/login"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: usernameInput.value.trim(), password: passwordInput.value })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "登录失败");
        localStorage.setItem(tokenKey, data.token);
        passwordInput.value = "";
        setStatus(loginStatus, "登录成功。");
        await refreshConnections();
        await refreshBans();
      } catch (error) {
        setStatus(loginStatus, error.message, true);
      }
    }

    function logout() {
      localStorage.removeItem(tokenKey);
      body.innerHTML = '<tr><td colspan="7" class="muted">已退出。</td></tr>';
      bansBody.innerHTML = '<tr><td colspan="6" class="muted">已退出。</td></tr>';
      setStatus(loginStatus, "已退出。");
    }

    async function refreshConnections() {
      const token = localStorage.getItem(tokenKey);
      if (!token) {
        setStatus(connectionStatus, "请先登录。", true);
        return;
      }
      setStatus(connectionStatus, "正在刷新...");
      try {
        const data = await apiGet("/admin/connections");
        renderConnections(data.connections || []);
        setStatus(connectionStatus, "已刷新：" + new Date().toLocaleString());
      } catch (error) {
        setStatus(connectionStatus, error.message, true);
      }
    }

    async function kick(connection) {
      if (!confirm("确定踢出 " + displayUser(connection) + " 吗？")) return;
      const result = await apiPost("/admin/connections/kick", kickPayload(connection));
      await refreshConnections();
      await refreshBans();
      setStatus(connectionStatus, "已踢出 " + (result.kicked || 0) + " 条当前记录。UDP 客户端如果还在连接，会在继续发包后重新出现；要阻止它回来请点封禁。");
    }

    async function ban(connection) {
      if (!confirm("确定踢出并封禁 " + displayUser(connection) + " 吗？")) return;
      const result = await apiPost("/admin/bans", { ...banPayload(connection), ttlSeconds: Number(banSeconds.value) });
      await refreshConnections();
      await refreshBans();
      setStatus(connectionStatus, "已封禁，踢出 " + (result.banned || 0) + " 条连接，到期时间：" + new Date(result.expiresAt).toLocaleString());
    }

    async function refreshBans() {
      const token = localStorage.getItem(tokenKey);
      if (!token) {
        setStatus(banStatus, "请先登录。", true);
        return;
      }
      setStatus(banStatus, "正在刷新封禁...");
      try {
        const data = await apiGet("/admin/bans");
        renderBans(data.bans || []);
        setStatus(banStatus, "已刷新封禁：" + new Date().toLocaleString());
      } catch (error) {
        setStatus(banStatus, error.message, true);
      }
    }

    function renderConnections(connections) {
      if (!connections.length) {
        body.innerHTML = '<tr><td colspan="7" class="muted">当前没有在线连接。</td></tr>';
        return;
      }
      body.innerHTML = "";
      for (const connection of connections) {
        const tr = document.createElement("tr");
        const room = connection.group || connection.roomId || "-";
        const user = connection.user || connection.username || connection.userId || "-";
        const address = connection.address || "-";
        const port = connection.port || "-";
        const lastSeen = connection.lastSeenAt || connection.joinedAt || connection.createdAt || "-";
        tr.innerHTML =
          cell("类型", connection.type, connection.type) +
          cell("房间/群组", room, room) +
          cell("用户", user, user) +
          cell("IP", address, address) +
          cell("端口", String(port), String(port)) +
          cell("最后活跃", lastSeen === "-" ? "-" : new Date(lastSeen).toLocaleString(), lastSeen) +
          '<td data-label="操作"><div class="actions"></div></td>';
        const actions = tr.querySelector(".actions");
        const kickButton = document.createElement("button");
        kickButton.className = "danger";
        kickButton.textContent = "踢出";
        kickButton.title = "只删除当前在线记录；UDP 客户端继续发包会重新出现";
        kickButton.addEventListener("click", () => runAction(() => kick(connection)));
        actions.appendChild(kickButton);

        if (connection.type !== "websocket") {
          const banButton = document.createElement("button");
          banButton.className = "danger";
          banButton.textContent = "封禁";
          banButton.title = "踢出并按上方时长封禁";
          banButton.addEventListener("click", () => runAction(() => ban(connection)));
          actions.appendChild(banButton);
        }
        body.appendChild(tr);
      }
    }

    function renderBans(bans) {
      if (!bans.length) {
        bansBody.innerHTML = '<tr><td colspan="6" class="muted">当前没有封禁。</td></tr>';
        return;
      }
      bansBody.innerHTML = "";
      for (const ban of bans) {
        const tr = document.createElement("tr");
        const room = ban.group || ban.roomId || "-";
        const user = ban.user || ban.userId || "-";
        const address = ban.address || "-";
        tr.innerHTML =
          cell("类型", ban.type, ban.type) +
          cell("房间/群组", room, room) +
          cell("用户", user, user) +
          cell("IP", address, address) +
          cell("到期时间", new Date(ban.expiresAt).toLocaleString(), ban.expiresAt) +
          '<td data-label="操作"><div class="actions"></div></td>';
        const actions = tr.querySelector(".actions");
        const unbanButton = document.createElement("button");
        unbanButton.className = "secondary";
        unbanButton.textContent = "解除";
        unbanButton.title = "解除这条封禁";
        unbanButton.addEventListener("click", () => runAction(() => unban(ban)));
        actions.appendChild(unbanButton);
        bansBody.appendChild(tr);
      }
    }

    async function unban(ban) {
      if (!confirm("确定解除 " + displayBan(ban) + " 的封禁吗？")) return;
      const result = await apiPost("/admin/bans/remove", { id: ban.id });
      await refreshBans();
      setStatus(banStatus, "已解除 " + (result.removed || 0) + " 条封禁。");
    }

    async function runAction(action) {
      try {
        setStatus(connectionStatus, "正在操作...");
        await action();
      } catch (error) {
        setStatus(connectionStatus, error.message, true);
      }
    }

    function kickPayload(connection) {
      if (connection.type === "sonobus-udp") {
        return { type: "sonobus-udp", group: connection.group, user: connection.user };
      }
      if (connection.type === "udp-session") {
        return { type: "udp-session", sessionId: connection.sessionId };
      }
      return { type: "websocket", roomId: connection.roomId, userId: connection.userId };
    }

    function banPayload(connection) {
      if (connection.type === "sonobus-udp") {
        return { type: "sonobus-udp", group: connection.group, user: connection.user };
      }
      return { type: "udp-session", roomId: connection.roomId, userId: connection.userId };
    }

    async function apiGet(path) {
      const response = await fetch(apiUrl(path), { headers: authHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "请求失败");
      return data;
    }

    async function apiPost(path, payload) {
      const response = await fetch(apiUrl(path), {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "请求失败");
      return data;
    }

    function authHeaders() {
      const token = localStorage.getItem(tokenKey);
      return token ? { authorization: "Bearer " + token } : {};
    }

    function apiUrl(path) {
      return baseUrlInput.value.replace(/\/+$/, "") + path;
    }

    function displayUser(connection) {
      return connection.user || connection.username || connection.userId || "该连接";
    }

    function displayBan(ban) {
      return ban.user || ban.userId || ban.address || ban.group || "该记录";
    }

    function cell(label, text, title = "") {
      return '<td data-label="' + escapeHtml(label) + '" title="' + escapeHtml(title || text || "-") + '">' + escapeHtml(text || "-") + '</td>';
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[char]);
    }

    function setStatus(element, text, isError = false) {
      element.textContent = text;
      element.classList.toggle("error", isError);
    }
  </script>
</body>
</html>`;
