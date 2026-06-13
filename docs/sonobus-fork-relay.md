# SonoBus Fork Relay

本仓库的 `sonobus/` 目录是基于 SonoBus 上游源码的改造版本。SonoBus 自身已经支持 Standalone、AU/VST 等形态，适合 DAW/机架加载；本次改造只动网络中继层。

## 改动点

- 在 `SonobusPluginProcessor` 中增加 relay server 配置。
- 当连接服务器通知 peer 加入时，如果 relay 已启用，peer 的 AoO UDP 包不直接发给对方 NAT 地址，而是发给公网 relay。
- 发往 relay 的 UDP 包使用 `SBR1` envelope，里面包含 `group`、`source`、`target` 和原始 AoO payload。
- relay 服务器只根据 envelope 转发，不解码、不混音、不转码。
- 接收端收到 relay 包后拆掉 envelope，再把原始 AoO payload 交回 SonoBus 原来的 AoO/jitter buffer/codec 流程。

## Standalone 测试方式

先部署本仓库的公网 relay 服务，并开放 UDP `9000`：

```bash
cd deploy
cp .env.example .env
docker compose up -d --build
```

启动改造版 SonoBus Standalone 时增加：

```bash
SonoBus --connectionserver your-server.example.com:10998 \
  --group test-room \
  --username alice \
  --relay-server your-server.example.com:9000
```

另一端使用同一个 `--group` 和同一个 `--relay-server`，用户名不同即可。

## 注意

- 这是 relay 强制模式；后续可以继续做成 “P2P 失败后自动切换 relay”。
- `SBR1` envelope 会增加少量 UDP 头部开销，但音频 payload 不被服务器处理。
- SonoBus 是 GPL-3.0 with App Store exception。分发修改版时，需要遵守 GPL 并提供对应源码。
