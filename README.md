# Lossless Audio Relay

跨平台无损实时音频传输 MVP。Mac/Windows 客户端主动连接 Linux 公网服务器，服务器只做登录、房间管理和 WebSocket 中继，不要求客户端有公网 IP 或端口映射。

## 核心特性

- Electron 桌面端：登录、房间、设备选择、采样参数、每路远端音量。
- Node.js 服务端：JWT 登录、管理员建号、房间 API、WebSocket 音频中继。
- Bit-perfect 传输语义：服务端不混音、不转码、不重采样，二进制音频帧原样转发给房间内其他客户端。
- SonoBus 参考路线：服务端已预留 UDP relay session 和 datagram 转发模块，可用于后续 fork SonoBus 时在 P2P 失败后切换公网中继。
- `sonobus/` 中已放入 SonoBus fork 并加入 `--relay-server <host:port>` 强制中继模式，详见 [docs/sonobus-fork-relay.md](docs/sonobus-fork-relay.md)。
- Docker Compose 部署：Postgres + 服务端 + Caddy 反代。

## 当前边界

桌面端目前是 Electron/Web Audio MVP，适合验证登录、房间和公网中继链路。浏览器音频 API 可能被系统或 Chromium 重采样；要做到专业级 bit-perfect 采集/播放，应把桌面端音频层替换成 PortAudio/JUCE 原生模块，或直接 fork SonoBus 并接入本仓库的 UDP relay。

## 开发

```bash
npm install
npm run build
npm test
npm run dev:server
npm run dev:desktop
```

## 部署

复制 `deploy/.env.example` 为 `deploy/.env`，修改域名和密钥后：

```bash
cd deploy
docker compose up -d --build
```

详见 [docs/deployment.md](docs/deployment.md)。
