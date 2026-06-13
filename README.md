# Lossless Audio Relay

基于 SonoBus 改造的跨平台无损实时音频传输项目，支持 Windows、macOS、Linux 桌面端和 DAW 插件形态，并增加公网 UDP relay。客户端不需要公网 IP，也不需要路由器端口映射；所有没有直连条件的客户端可以主动连接自己的 Linux 公网服务器，由服务器转发音频包。

> 文档不会写入任何真实服务器 IP。部署和客户端配置时，请把示例里的 `<你的服务器IP或域名>` 替换成你自己的公网服务器地址。

## 基于 SonoBus 改造

本项目的专业音频客户端基于开源项目 [SonoBus](https://github.com/sonosaurus/sonobus) 改造。SonoBus 已经提供成熟的跨平台实时音频能力、Standalone 桌面程序、VST3/AU/LV2 插件形态、DAW/机架加载能力和 PCM/Opus 音频传输能力。

本项目没有重写 SonoBus 的音频引擎，而是在其基础上增加公网 relay 能力：

- 保留 SonoBus 原有音频采集、播放、插件、抖动缓冲、PCM/Opus 传输和 UI。
- 新增 `Use Relay` / `Relay Server` 配置。
- 新增 `SBR1` UDP relay envelope。
- 当客户端没有公网 IP 或 P2P 不稳定时，可把音频包发到自己的 Linux 公网服务器中继。
- relay 服务器只转发 UDP payload，不解码、不混音、不转码、不重采样。

SonoBus 是 GPL-3.0 with App Store exception 项目。分发本项目修改版客户端时，应同时提供对应源码，并保留上游版权和许可证说明。

## 核心特性

- SonoBus 桌面端：Windows、macOS、Linux。
- SonoBus 插件：Windows VST3、Windows VST3 Instrument、macOS VST3、macOS AU、macOS LV2、Linux VST3、Linux LV2。
- Windows ASIO 构建：GitHub Actions 自动下载 Steinberg ASIO SDK 并启用 ASIO。
- Node.js 服务端：JWT 登录、管理员建号、房间 API、WebSocket 音频中继、UDP relay。
- Bit-perfect 传输语义：服务端不混音、不转码、不重采样，二进制音频帧原样转发给房间内其他客户端。
- SonoBus relay：`sonobus/` 中的 fork 增加 `Use Relay` / `Relay Server`，也支持 `--relay-server <host:port>` 参数。
- Docker Compose 部署：Postgres + 服务端 + Caddy 反代。

## 下载成品

构建包在 GitHub Actions 的 Artifacts 里下载：

1. 打开 GitHub 项目页面。
2. 点击 `Actions`。
3. 选择对应 workflow。
4. 点击最新的绿色成功记录。
5. 在页面底部 `Artifacts` 下载。

可下载的包：

- `sonobus-windows-x64-asio`：Windows ASIO 版，推荐 Windows 使用。
- `sonobus-windows-x64`：Windows 普通版。
- `sonobus-macos-universal`：macOS universal 版，含 app 和插件。
- `sonobus-linux-x64`：Linux x64 版，含 standalone 和插件。
- `lossless-audio-server-linux-docker`：Linux 服务器 Docker 部署包。

更详细的安装、下载和使用说明见 [docs/download-and-use.md](docs/download-and-use.md)。

## 用户怎么填服务器

不要把某个人的真实服务器写进源码或文档。客户端只需要用户自己填写：

```text
Relay Server: <你的服务器IP或域名>:9000
```

示例：

```text
Relay Server: your-server.example.com:9000
Relay Server: 203.0.113.10:9000
```

其中 `203.0.113.10` 是文档专用示例地址，不是实际可用服务器。

SonoBus 里有两个容易混淆的地址：

- `Connection Server`：SonoBus 用来找同组用户的连接服务器，可继续使用默认值。
- `Relay Server`：本项目新增的公网 UDP 中继服务器，填你自己的 Linux 公网服务器地址和 UDP 端口。

## 当前边界

- relay 转发音频包，不做混音、不做转码、不做重采样。
- relay 会比 P2P 直连多一跳，延迟取决于客户端到服务器、服务器到其他客户端的网络质量。
- 如果 Ping 很高，例如 300ms 以上，软件无法把物理网络延迟变成低延迟。
- 第一版推荐手动启用 `Use Relay`；自动判断 P2P 失败后切换 relay 可以继续迭代。
- `packages/desktop` 是早期 Electron/Web Audio MVP，主要用于验证登录、房间和 WebSocket 中继。实际音乐/DAW 使用优先使用 `sonobus/` 里的 SonoBus fork。

## 本地开发

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

## 文档

- [下载和客户端使用](docs/download-and-use.md)
- [Linux 服务器部署](docs/deployment.md)
- [SonoBus relay 改造说明](docs/sonobus-fork-relay.md)
- [中继改造路线](docs/sonobus-relay-plan.md)
