# Linux 公网服务器部署

本文档不会包含任何真实服务器 IP。请把示例中的 `<你的服务器IP或域名>`、`your-server.example.com` 替换成自己的服务器地址。

## 服务器要求

- 一台有公网 IP 的 Linux 服务器。
- 推荐准备一个域名，并把域名 A 记录指向服务器公网 IP。
- 如果没有域名，也可以先用公网 IP 测试 UDP relay。
- 开放 TCP `80`、`443`，用于 HTTP API / WebSocket / TLS。
- 开放 UDP `9000`，用于 SonoBus relay。
- 客户端只需要能主动访问服务器，不需要公网 IP，也不需要路由器端口映射。

## 端口说明

| 端口 | 协议 | 用途 |
| --- | --- | --- |
| `80` | TCP | Caddy 自动申请证书、HTTP 跳转 |
| `443` | TCP | HTTPS API / WebSocket |
| `9000` | UDP | SonoBus 音频 relay |

如果你只测试 SonoBus relay，最关键的是开放 UDP `9000`。

## 上传部署包

从 GitHub Actions 下载 `lossless-audio-server-linux-docker`，得到：

```text
lossless-audio-server-linux-docker.tar.gz
```

上传到服务器后解压到 `/opt/lossless-audio`：

```bash
sudo mkdir -p /opt/lossless-audio
sudo tar -xzf lossless-audio-server-linux-docker.tar.gz -C /opt/lossless-audio --strip-components=1
sudo chown -R "$USER":"$USER" /opt/lossless-audio
cd /opt/lossless-audio/deploy
```

## 启动

```bash
cd deploy
cp .env.example .env
nano .env
```

`.env` 示例：

```dotenv
PUBLIC_DOMAIN=your-server.example.com
JWT_SECRET=replace-with-a-long-random-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-strong-password
POSTGRES_DB=lossless_audio
POSTGRES_USER=lossless_audio
POSTGRES_PASSWORD=replace-with-a-strong-db-password
MAX_BYTES_PER_SECOND_PER_CLIENT=52428800
UDP_RELAY_PORT=9000
```

启动：

```bash
docker compose up -d --build
```

如果配置了域名，Caddy 会自动申请 TLS 证书。Electron/WebSocket 客户端填写：

```text
https://your-server.example.com
```

SonoBus relay 填写：

```text
your-server.example.com:9000
```

如果没有域名，SonoBus relay 可以直接填写：

```text
<你的服务器公网IP>:9000
```

不要把真实 IP 写进公开文档、截图或 Issue。

## 检查运行状态

查看容器：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f server
```

本机健康检查：

```bash
curl http://127.0.0.1:8080/health
```

如果你临时把 `8080` 暴露到公网，也可以从自己电脑测试：

```bash
curl http://<你的服务器IP或域名>:8080/health
```

正式部署推荐走 `443`，不要长期公开 `8080`。

## 云服务器安全组

在云厂商控制台放行：

```text
TCP 80
TCP 443
UDP 9000
```

如果 SonoBus 连接后延迟很大或完全收不到音频，优先检查 UDP `9000` 是否放通。

## 带宽估算

服务器是中继模式，房间里每个发送者的音频会转发给其他所有人。

示例：48kHz / 24bit / stereo PCM 约 `48000 * 3 * 2 = 288000 B/s`，约 2.3 Mbps。  
如果 4 人同时发送，每个人都接收其他 3 路，服务器出口约 `4 * 3 * 2.3 Mbps = 27.6 Mbps`，还不含协议开销。

## 安全建议

- 使用强 `JWT_SECRET` 和管理员密码。
- 不要提交 `deploy/.env`。
- 第一版不开放注册，只有管理员能创建用户。
- `MAX_BYTES_PER_SECOND_PER_CLIENT` 用于限制单客户端上行，防止误配置打满带宽。
- 不要在公开 README 或截图中暴露真实服务器 IP。
