# Linux 服务器管理：查看在线用户、踢出、封禁

这些命令在 Linux 服务器上执行，用来管理本项目的 relay 服务。示例里不写真实服务器 IP，请把 `<你的服务器IP或域名>`、`<管理员密码>` 等替换成你自己的值。

## 1. 登录拿管理员 Token

## 浏览器管理页面

服务端内置了一个简单的 Web 管理页面。部署更新后，在任意电脑浏览器打开：

```text
http://<你的服务器IP或域名>/admin
```

如果你使用域名和 HTTPS：

```text
https://<你的域名>/admin
```

页面里填写：

- `服务器地址`：默认会自动填当前打开的地址。
- `管理员账号`：`deploy/.env` 里的 `ADMIN_USERNAME`，默认是 `admin`。
- `管理员密码`：`deploy/.env` 里的 `ADMIN_PASSWORD`。

登录后可以直接查看在线连接，并点击 `踢出` 或 `踢出并封禁`。

下面是命令行管理方式，适合在 SSH 里操作。

如果你之前已经把服务端 `8080` 映射到主机，并且下面命令能返回 `{"ok":true}`：

```bash
curl http://127.0.0.1:8080/health
```

就优先用本机地址：

```bash
TOKEN=$(curl -s http://127.0.0.1:8080/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"<管理员密码>"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).token))')
```

如果 `127.0.0.1:8080` 不通，就用 Caddy 暴露出来的 HTTP/HTTPS 地址：

```bash
TOKEN=$(curl -s http://<你的服务器IP或域名>/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"<管理员密码>"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).token))')
```

这里的管理员密码就是 `deploy/.env` 里的 `ADMIN_PASSWORD`，不是 SonoBus 房间密码。

## 2. 查看当前连接的人

```bash
curl -s http://127.0.0.1:8080/admin/connections \
  -H "authorization: Bearer $TOKEN"
```

如果你使用的是域名或公网 HTTP 地址，把上面的 `http://127.0.0.1:8080` 换成 `http://<你的服务器IP或域名>` 或 `https://<你的域名>`。

返回里常见连接：

```json
{
  "connections": [
    {
      "type": "sonobus-connection",
      "group": "band",
      "user": "alice",
      "address": "198.51.100.20",
      "port": 53000
    },
    {
      "type": "sonobus-udp",
      "group": "band",
      "user": "alice",
      "address": "198.51.100.20",
      "port": 53000,
      "lastSeenAt": "2026-06-13T12:00:00.000Z"
    }
  ]
}
```

字段意思：

- `type`：连接类型。`sonobus-connection` 是自己的 SonoBus Connection Server 里的房间成员；`sonobus-udp` 是 relay 音频中继看到的 UDP 心跳。
- `group`：SonoBus 群组名。
- `user`：SonoBus 用户名。
- `address`：对方公网出口 IP。
- `port`：对方公网出口 UDP 端口。
- `lastSeenAt`：服务器最后一次收到对方包的时间。

## 3. 踢出某个 SonoBus 用户

只踢出，不封禁：

```bash
curl -s http://127.0.0.1:8080/admin/connections/kick \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"type":"sonobus-connection","group":"<群组名>","user":"<用户名>"}'
```

示例：

```bash
curl -s http://127.0.0.1:8080/admin/connections/kick \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"type":"sonobus-connection","group":"band","user":"alice"}'
```

返回：

```json
{"kicked":1}
```

注意：如果对方 SonoBus 客户端仍然使用默认 `aoo.sonobus.net`，这里踢不到它。必须让客户端的 `Connection Server` 填 `<你的服务器IP或域名>:10998`。

## 4. 踢出并封禁 1 小时

按 SonoBus 群组名和用户名封禁：

```bash
curl -s http://127.0.0.1:8080/admin/bans \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"type":"sonobus-connection","group":"<群组名>","user":"<用户名>","ttlSeconds":3600}'
```

按 IP 封禁：

```bash
curl -s http://127.0.0.1:8080/admin/bans \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"type":"sonobus-udp","address":"<对方IP>","ttlSeconds":3600}'
```

返回：

```json
{"banned":1,"expiresAt":"2026-06-13T13:00:00.000Z"}
```

`ttlSeconds` 是封禁秒数。比如：

- `600`：10 分钟
- `3600`：1 小时
- `86400`：1 天

## 5. 查看和解除封禁

查看当前封禁：

```bash
curl -s http://127.0.0.1:8080/admin/bans \
  -H "authorization: Bearer $TOKEN"
```

返回示例：

```json
{
  "bans": [
    {
      "id": "封禁ID",
      "type": "sonobus-udp",
      "group": "band",
      "user": "alice",
      "expiresAt": "2026-06-13T14:00:00.000Z"
    }
  ]
}
```

解除某条封禁：

```bash
curl -s http://127.0.0.1:8080/admin/bans/remove \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"id":"<封禁ID>"}'
```

返回：

```json
{"removed":1}
```

也可以在浏览器 Web 管理页的 `封禁列表` 里点击 `解除`。

## 6. 常用排查

查看服务是否正常：

```bash
curl http://127.0.0.1:8080/health
```

查看 Docker 日志：

```bash
cd /opt/lossless-audio/deploy
docker compose logs -f server
```

重启服务：

```bash
cd /opt/lossless-audio/deploy
docker compose up -d --build
```

## 7. 重要说明

- `ADMIN_USERNAME` / `ADMIN_PASSWORD` 只管服务器 HTTP 管理接口。
- SonoBus 的 `Group Password` 仍然是客户端房间密码。
- 要真正禁止一个人继续通过你的公网 relay 进来，需要使用 `/admin/bans`。
- 封禁信息当前保存在服务进程内存里，重启 Docker 后会清空。长期封禁名单可以后续再做成数据库持久化。
