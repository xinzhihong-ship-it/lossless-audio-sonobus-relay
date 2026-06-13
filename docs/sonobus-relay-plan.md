# 基于 SonoBus 增加公网中继的改造路线

SonoBus 是 GPL-3.0 项目，带 App Store 分发例外。若直接 fork 和分发修改版，需要遵守 GPL-3.0，向用户提供对应源码。本仓库当前没有复制 SonoBus 源码，只提供独立中继服务和改造路线。

## SonoBus 当前网络形态

- SonoBus 使用 AoO / OSC over UDP 做实时音频传输。
- 连接服务器主要用于组房间和发现成员。
- 音频默认在成员之间 P2P 直连。
- 当双方 NAT/防火墙无法互通时，用户需要公网 IP、端口映射或可达的 UDP 端口。

## 推荐改造

保留 SonoBus 现有音频引擎、UI、PCM/Opus 编码、抖动缓冲和重传逻辑，只改网络路由层：

- 默认仍优先 P2P UDP，低延迟且省服务器带宽。
- 当 P2P 探测失败、超时或用户手动选择时，切换到公网 relay。
- relay 服务器维护房间和 peer 会话，把来自 A 的 AoO/OSC UDP 包原样转发给房间内目标 peer。
- relay 不解码音频、不混音、不转码；只转发 datagram payload。

## 与本仓库服务端的关系

本仓库已经实现了 HTTP 登录、房间和 WebSocket bit-perfect 中继，适合作为独立 MVP 或验证服务端部署。

如果要直接兼容 SonoBus，本仓库已经预留了 UDP relay 模块：

- `POST /rooms/:id/relay-session`：客户端登录后申请 relay 会话。
- UDP `UDP_RELAY_PORT`：接收客户端 datagram。
- datagram envelope：`sessionId`、`roomId`、`sourceUserId`、`targetUserId`、`sequence`、原始 AoO/OSC payload。
- relay 查表后把 payload 原样发给目标用户的 relay socket。

## SonoBus 客户端改造点

在 SonoBus fork 中增加：

- 连接设置页增加 `Use relay when direct connection fails`。
- P2P 连接失败提示从“需要端口映射”改为“正在切换服务器中继”。
- 网络发送路径增加 relay transport，目标从 peer 公网地址改成 relay 地址。
- 接收路径保持 AoO/OSC payload 不变，让现有 jitter buffer 和解码逻辑继续工作。
- UI 显示每个 peer 当前路径：`Direct` 或 `Relayed`。

## 为什么不是服务器混音

服务器混音会改变音频采样值，不能满足 bit-perfect。中继模式只转发原始包，既符合无损要求，也让客户端继续拥有每路用户独立音量和监听控制。
