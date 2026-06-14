# Lossless Audio SonoBus Relay

基于 SonoBus 改造的跨平台无损实时音频传输项目，本项目使用 Codex 辅助改造。它包含：

- SonoBus 改造版客户端：Windows、macOS、Linux。
- DAW 插件：VST3、AU、LV2，按平台支持不同格式。
- Linux 公网服务器：Connection Server（连接服务器）、Relay Server（中继服务器）、Web 管理后台。
- 无公网 IP 支持：客户端主动连接公网服务器，不需要端口映射。

本文档不会写真实服务器 IP。部署和使用时，请把 `<你的服务器IP或域名>` 换成你自己的公网服务器地址。

## 项目基于 SonoBus 改造

本项目的音频客户端基于开源项目 [SonoBus](https://github.com/sonosaurus/sonobus) 改造。
本项目使用 Codex 辅助完成服务端、客户端中继逻辑、Web 管理后台、文档和构建流程改造。

SonoBus 原本已经支持：

- Standalone（独立桌面程序）
- VST3（Windows/macOS/Linux 插件）
- AU（macOS 插件）
- LV2（macOS/Linux 插件）
- DAW/机架加载
- PCM/Opus 实时音频传输

本项目没有重写音频引擎，而是在 SonoBus 原有能力上增加：

- 自建 Connection Server（连接服务器），默认端口 `10998`。
- 自建 Relay Server（中继服务器），默认 UDP 端口 `9000`。
- `Use Relay`（使用中继）开关。
- `Relay Server`（中继服务器地址）输入。
- Linux Web 管理后台，可查看在线用户、踢出、封禁、解除封禁。
- 封禁持久化到 PostgreSQL（数据库），Docker 重启后会自动恢复。

服务器只转发音频包，不混音、不转码、不重采样。

## 下载

打开 GitHub Actions 下载页：

[Actions 下载页](https://github.com/xinzhihong-ship-it/lossless-audio-sonobus-relay/actions)

建议只下载最新的绿色 `success` 构建包。旧构建包可能缺少最新的中继、封禁、macOS 权限修复。

下载包名称：

| Artifact（构建产物） | 中文说明 | 推荐对象 |
| --- | --- | --- |
| `lossless-audio-server-linux-docker` | Linux 服务器 Docker 部署包 | 部署服务器 |
| `sonobus-windows-x64-asio-installer` | Windows ASIO 安装器，自动安装客户端和 VST3 | Windows 专业声卡用户，推荐 |
| `sonobus-windows-x64-installer` | Windows 普通安装器，自动安装客户端和 VST3 | Windows 普通用户 |
| `sonobus-macos-universal-installer` | macOS PKG 安装器，自动安装 App 和插件 | Mac 用户 |
| `sonobus-linux-x64-installer` | Linux DEB 安装包，自动安装客户端和插件 | Ubuntu/Debian Linux 用户 |
| `sonobus-windows-x64-asio` / `sonobus-windows-x64` | Windows 手动安装包 | 高级用户 |
| `sonobus-macos-universal` / `sonobus-linux-x64` | macOS/Linux 手动安装包 | 高级用户 |

详细下载和客户端使用见：

- [docs/download-and-use.md](docs/download-and-use.md)

VST3、AU、LV2 插件应该放哪个目录，也写在这个文档的“插件放哪个目录”章节里。

## Linux 部署

新手按这个文档一步一步做：

- [docs/deployment.md](docs/deployment.md)

最短流程：

```bash
# 1. 上传服务器包到 /home/ubuntu/
# 2. SSH 登录服务器后执行：
sudo -i
mkdir -p /opt/lossless-audio
tar -xzf /home/ubuntu/lossless-audio-server-linux-docker.tar.gz -C /opt/lossless-audio --strip-components=1
cd /opt/lossless-audio/deploy
cp .env.example .env
nano .env
docker compose up -d --build
curl -i http://127.0.0.1/health
```

部署完成后，浏览器打开：

```text
http://<你的服务器IP或域名>/admin
```

重要：如果没有域名、没有备案、没有 HTTPS 证书，必须使用 `http://` 访问 Web 管理后台，不要使用 `https://`。部分浏览器会自动强制跳到 HTTPS，导致打不开页面；这种情况可以使用无痕模式访问，或换一个没有缓存过该地址的浏览器。

如果你配置了域名和 HTTPS：

```text
https://<你的域名>/admin
```

## 客户端怎么填写

如果使用官方 SonoBus 服务器：

- `Connection Server`（连接服务器）：`aoo.sonobus.net`
- `Use Relay`（使用中继）：不勾选。

如果之前改过自建服务器，想恢复官方服务器，就把 `Connection Server` 改回 `aoo.sonobus.net`，并关闭 `Use Relay`。

如果使用自己的 Linux 公网服务器：

```text
Connection Server（连接服务器）: <你的服务器IP或域名>:10998
Use Relay（使用中继）: 勾选
Relay Server（中继服务器）: <你的服务器IP或域名>:9000
```

如果你在服务器 `.env` 里改过 `UDP_RELAY_PORT`，就把 `9000` 换成自己的中继端口。

注意：`Connection Server` 和 `Relay Server` 都要填你的自建服务器。只填一个，或者继续用官方 `aoo.sonobus.net`，Web 后台就不能完整查看、踢出、封禁用户。

## Web 管理后台能做什么

Web 管理后台地址：

```text
http://<你的服务器IP或域名>/admin
```

没有域名、备案和 HTTPS 证书时，请用上面的 `http://` 地址。浏览器如果自动跳到 `https://`，可以用无痕模式重新打开。

功能：

- 查看在线连接。
- 踢出当前用户。
- 封禁 10 分钟、1 小时、1 天、自定义时间、永久封禁。
- 解除封禁。
- 封禁写入数据库，Docker 重启后仍然生效。
- 解除封禁会从数据库删除，重启后不会再次恢复。

详细管理说明见：

- [docs/linux-admin.md](docs/linux-admin.md)

## 常见英文词翻译

| 英文 | 中文意思 |
| --- | --- |
| `Actions` | GitHub 自动构建页面 |
| `Artifact` | 构建产物，下载包 |
| `Connection Server` | 连接服务器，用来发现同组用户 |
| `Relay Server` | 中继服务器，用来转发音频包 |
| `Use Relay` | 使用中继 |
| `Group Name` | 房间名/群组名 |
| `Your Displayed Name` | 你的显示名 |
| `Group Password` | 房间密码，不是服务器管理员密码 |
| `Standalone` | 独立桌面程序 |
| `VST3/AU/LV2` | DAW 插件格式 |
| `ASIO` | Windows 低延迟音频驱动 |
| `Docker Compose` | Docker 多容器启动工具 |
| `PostgreSQL` | 数据库 |
| `Caddy` | HTTP/HTTPS 反向代理服务 |

## 重要提醒

- 不要把真实服务器 IP、管理员密码、数据库密码写进公开文档、截图、Issue 或论坛。
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` 是 Web 管理后台账号密码，不是 SonoBus 房间密码。
- SonoBus `Group Password` 是房间密码，只在客户端里使用。
- 要让 Web 后台真正踢出/封禁 SonoBus 房间成员，客户端必须使用你的 `Connection Server`：`<你的服务器IP或域名>:10998`。
- 如果客户端继续使用默认 `aoo.sonobus.net`，Web 后台无法真正管理这些房间成员。
- macOS 请把 `SonoBus.app` 放进 `Applications`（应用程序）后再打开。第一次允许麦克风即可；如果老版本反复弹权限，执行 `tccutil reset Microphone com.Sonosaurus.SonoBus` 后换新版。

## 本地开发

```bash
npm install
npm run build
npm test
```

## 许可证

本项目基于 SonoBus 二次开发。SonoBus 由 Jesse Chappell 编写，并以 GPLv3 授权，许可证文件见上游仓库：

- [sonosaurus/sonobus](https://github.com/sonosaurus/sonobus)
- [SonoBus LICENSE](https://raw.githubusercontent.com/sonosaurus/sonobus/main/LICENSE)

本仓库根目录包含 GPLv3 许可证文本 [LICENSE](LICENSE)、App Store 例外 [LICENSE_EXCEPTION](LICENSE_EXCEPTION) 和第三方/修改说明 [NOTICE.md](NOTICE.md)。GitHub Actions 生成的客户端和服务器下载包也会随包附带这些文件，以及 SonoBus 上游 `LICENSE` 和 `LICENSE_EXCEPTION`。

你可以：

- Fork。
- 修改源码。
- 自己编译。
- 做二次开发。
- 免费分发。
- 收费分发。

但如果把修改后的版本发布给别人使用，需要注意：

- 继续遵守 GPL-3.0 / GPLv3 开源许可证。
- 公开对应源码。
- 保留 SonoBus 上游版权和许可证声明。
- 标明你修改过源码。
- 不能把基于 SonoBus 的修改版改成闭源商业软件直接卖。

简单说：可以二开，也可以商业化分发，但二开后的发布版本也要开源，用户也必须能拿到源码，并拥有继续修改和再分发的权利。

如果只是本地研究、学习、自己使用，不发布给别人，一般不需要公开源码。

注意：SonoBus 名称、Logo、商标不一定随 GPL 授权。如果发布自己的修改版，建议改名并更换标识，避免让用户误以为是 SonoBus 官方版本。
