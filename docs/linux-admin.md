# Linux 服务器管理

本文档说明怎么查看在线用户、踢出、封禁、解除封禁。

所有示例都用占位符，不写真实服务器 IP。

## 1. 推荐用 Web 管理后台

浏览器打开：

```text
http://<你的服务器IP或域名>/admin
```

如果有域名和 HTTPS：

```text
https://<你的域名>/admin
```

页面字段：

| 页面文字 | 中文意思 |
| --- | --- |
| `服务器地址` | 当前服务器地址，一般自动填写 |
| `管理员账号` | `.env` 里的 `ADMIN_USERNAME` |
| `管理员密码` | `.env` 里的 `ADMIN_PASSWORD` |
| `在线连接` | 当前在线的人 |
| `封禁时长` | 选择封禁多久 |
| `封禁列表` | 当前封禁记录 |
| `踢出` | 断开当前连接 |
| `封禁` | 踢出并阻止重新加入 |
| `解除` | 解除封禁 |

英文解释：

| 英文 | 中文意思 |
| --- | --- |
| `Connection Server` | 连接服务器，管理 SonoBus 用户进房 |
| `Relay Server` | 中继服务器，转发音频包 |
| `Use Relay` | 使用中继 |
| `Group` | 房间/群组 |
| `User` | 用户 |
| `Address` | 对方公网出口 IP |
| `Port` | 对方端口 |

## 2. 踢出和封禁有什么区别

`踢出`：

- 只断开当前连接。
- 对方客户端可能马上自动重连。
- 适合临时刷新连接。

`封禁`：

- 断开当前连接。
- 阻止对方重新加入。
- 可以选 10 分钟、1 小时、1 天、自定义、永久。
- 封禁写入 PostgreSQL 数据库。
- Docker 重启后会自动恢复。

`解除`：

- 从当前服务里解除封禁。
- 从数据库删除封禁记录。
- Docker 重启后不会再恢复这条封禁。

## 3. Web 管理必须满足的客户端设置

要让 Web 后台真正看到和管理 SonoBus 房间成员，客户端必须填写：

```text
Connection Server（连接服务器）: <你的服务器IP或域名>:10998
Use Relay（使用中继）: 勾选
Relay Server（中继服务器）: <你的服务器IP或域名>:9000
```

如果客户端继续使用默认：

```text
aoo.sonobus.net
```

那么你的 Web 后台不能真正踢出/封禁这些 SonoBus 房间成员。

## 4. 封禁方式建议

在 Web 后台看到的连接类型：

| 类型 | 中文说明 | 建议 |
| --- | --- | --- |
| `sonobus-connection` | Connection Server 里的 SonoBus 房间成员 | 优先封禁这个 |
| `sonobus-udp` | Relay Server 看到的 UDP 音频连接 | 可按 IP/用户名补充封禁 |
| `udp-session` | 早期 WebSocket/UDP relay 会话 | 一般不用管 |
| `websocket` | WebSocket 客户端连接 | 一般用于测试 |

推荐：

1. 优先对 `sonobus-connection` 点 `封禁`。
2. 如果用户不断换名字，也可以按 IP 封禁。
3. 误封后在 `封禁列表` 点 `解除`。

## 5. 测试封禁持久化

在服务器 SSH 执行：

```bash
cd /opt/lossless-audio/deploy
docker compose restart server
```

测试流程：

1. Web 后台封禁一个用户。
2. 执行上面的重启命令。
3. 刷新 Web 后台。
4. 封禁列表仍然存在，说明数据库恢复正常。
5. 点 `解除`。
6. 再重启 `server`。
7. 封禁列表不再出现，说明数据库删除正常。

## 6. 命令行管理方式

一般用 Web 后台就够了。下面是 SSH 命令行方式，适合排查。

### 登录获取 Token

英文解释：

| 英文 | 中文意思 |
| --- | --- |
| `Token` | 登录令牌 |
| `Bearer` | HTTP 认证格式 |
| `Authorization` | 认证请求头 |

如果服务器上没有 `node` 命令，可以用 Docker 容器里的 Node。

执行：

```bash
cd /opt/lossless-audio/deploy

TOKEN=$(curl -s http://127.0.0.1/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"<你的管理员密码>"}' \
  | docker compose exec -T server node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).token))')

echo "$TOKEN"
```

如果输出一长串字符，就成功了。

### 查看在线连接

```bash
curl -s http://127.0.0.1/admin/connections \
  -H "authorization: Bearer $TOKEN"
```

返回示例：

```json
{
  "connections": [
    {
      "type": "sonobus-connection",
      "group": "band",
      "user": "alice",
      "address": "198.51.100.20",
      "port": 53000
    }
  ]
}
```

字段中文意思：

| 字段 | 中文意思 |
| --- | --- |
| `type` | 连接类型 |
| `group` | 房间/群组 |
| `user` | 用户名 |
| `address` | 对方公网出口 IP |
| `port` | 对方端口 |
| `lastSeenAt` | 最后活跃时间 |

### 踢出用户

```bash
curl -s http://127.0.0.1/admin/connections/kick \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"type":"sonobus-connection","group":"<房间名>","user":"<用户名>"}'
```

返回：

```json
{"kicked":1}
```

### 封禁 1 小时

```bash
curl -s http://127.0.0.1/admin/bans \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"type":"sonobus-connection","group":"<房间名>","user":"<用户名>","ttlSeconds":3600}'
```

`ttlSeconds` 中文意思是封禁秒数：

| 值 | 中文意思 |
| --- | --- |
| `600` | 10 分钟 |
| `3600` | 1 小时 |
| `86400` | 1 天 |
| `0` | 永久封禁 |

### 永久封禁

```bash
curl -s http://127.0.0.1/admin/bans \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"type":"sonobus-connection","group":"<房间名>","user":"<用户名>","ttlSeconds":0}'
```

返回里的：

```json
"expiresAt": null
```

意思是永久封禁，没有到期时间。

### 按 IP 封禁

如果对方频繁换用户名，可以按 IP 封禁：

```bash
curl -s http://127.0.0.1/admin/bans \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"type":"sonobus-connection","address":"<对方IP>","ttlSeconds":3600}'
```

注意：很多家庭宽带 IP 会变化，也可能多人共用一个出口 IP。按 IP 封禁要谨慎。

### 查看封禁列表

```bash
curl -s http://127.0.0.1/admin/bans \
  -H "authorization: Bearer $TOKEN"
```

返回示例：

```json
{
  "bans": [
    {
      "id": "封禁ID",
      "type": "sonobus-connection",
      "group": "band",
      "user": "alice",
      "expiresAt": null
    }
  ]
}
```

字段中文意思：

| 字段 | 中文意思 |
| --- | --- |
| `id` | 封禁 ID，解除时用 |
| `type` | 封禁类型 |
| `group` | 房间/群组 |
| `user` | 用户名 |
| `address` | IP 地址 |
| `expiresAt` | 到期时间；`null` 表示永久 |

### 解除封禁

```bash
curl -s http://127.0.0.1/admin/bans/remove \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"id":"<封禁ID>"}'
```

返回：

```json
{"removed":1}
```

解除后会从数据库删除。

## 7. 直接查看 connection-server

如果要排查 SonoBus Connection Server，可以执行：

```bash
docker compose exec -T server node -e 'fetch("http://connection-server:18098/connections").then(r=>r.text()).then(console.log)'
```

查看底层封禁：

```bash
docker compose exec -T server node -e 'fetch("http://connection-server:18098/bans").then(r=>r.text()).then(console.log)'
```

通常不需要直接操作它，优先用 Web 后台。

## 8. 常用排查命令

查看服务状态：

```bash
cd /opt/lossless-audio/deploy
docker compose ps
```

查看健康检查：

```bash
curl -i http://127.0.0.1/health
```

查看 Web 是否最新版：

```bash
curl -s http://127.0.0.1/admin | grep -E "数据库|Docker 重启|永久|自定义"
```

查看服务端日志：

```bash
docker compose logs -f server
```

查看连接服务器日志：

```bash
docker compose logs -f connection-server
```

重启服务端：

```bash
docker compose restart server
```

## 9. 常见问题

### Web 里没人，但 SonoBus 明明在线

检查客户端 `Connection Server` 是否填了：

```text
<你的服务器IP或域名>:10998
```

如果还在用默认官方服务器，Web 后台看不到。

### 踢出没反应

踢出后客户端可能自动重连。

要阻止回来，用：

```text
封禁
```

### 封禁后还是能进来

检查：

- 封禁的是不是 `sonobus-connection`。
- 客户端是不是使用你的 `Connection Server`。
- 是否浏览器页面没刷新。
- 服务端是不是新版。

确认新版：

```bash
curl -s http://127.0.0.1/admin | grep "封禁保存在数据库"
```

### 误封后怎么恢复

Web 后台：

```text
封禁列表 -> 解除
```

命令行：

```bash
curl -s http://127.0.0.1/admin/bans/remove \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"id":"<封禁ID>"}'
```

### Docker 重启后封禁还在

这是新版正常行为。封禁保存在数据库里。

如果要删除，必须点：

```text
解除
```
