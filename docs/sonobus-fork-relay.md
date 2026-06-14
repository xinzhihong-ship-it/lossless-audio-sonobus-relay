# SonoBus Fork Relay

本仓库的 `sonobus/` 目录是基于 SonoBus 上游源码的改造版本，本项目使用 Codex 辅助改造。SonoBus 自身已经支持 Standalone、AU/VST 等形态，适合 DAW/机架加载；本次改造只动网络中继层。

本文档只使用占位地址。不要把真实公网 IP 写进源码、README、截图或公开 Issue。

## 上游项目

- 上游仓库：[sonosaurus/sonobus](https://github.com/sonosaurus/sonobus)
- 上游能力：跨平台实时音频、Standalone、VST3、AU、LV2、DAW/机架加载、PCM/Opus 音频传输。
- 本项目定位：SonoBus 改造版，不是从零实现的替代品。
- 改造目标：在保留 SonoBus 原有音频能力的基础上，为无公网 IP / NAT 环境增加公网 UDP relay，并把 SonoBus/AOO Connection Server 纳入 Linux Web 管理。

## 改动点

- 在 `SonobusPluginProcessor` 中增加 relay server 配置。
- 当连接服务器通知 peer 加入时，如果 relay 已启用，peer 的 AoO UDP 包不直接发给对方 NAT 地址，而是发给公网 relay。
- 发往 relay 的 UDP 包使用 `SBR1` envelope，里面包含 `group`、`source`、`target` 和原始 AoO payload。
- relay 服务器只根据 envelope 转发，不解码、不混音、不转码。
- 接收端收到 relay 包后拆掉 envelope，再把原始 AoO payload 交回 SonoBus 原来的 AoO/jitter buffer/codec 流程。
- Linux 部署会同时启动自己的 SonoBus Connection Server，端口默认 `10998`。Web 管理页面的“踢出/封禁”只有在客户端使用这个 Connection Server 时，才会真正控制 SonoBus 房间成员。

## Standalone 测试方式

先部署本仓库的公网 relay 服务，并开放 UDP `9000`：

```bash
cd deploy
cp .env.example .env
docker compose up -d --build
```

启动改造版 SonoBus Standalone 时只需要填写 relay server：

```bash
SonoBus --group test-room \
  --username alice \
  --relay-server <你的服务器IP或域名>:9000
```

客户端会自动把 Connection Server 设成同一台服务器的 `10998` 端口。另一端使用同一个 `--group` 和同一个 `--relay-server`，用户名不同即可。

## 图形界面使用

在连接页面：

1. 填写 `Group Name`。
2. 填写 `Your Displayed Name`。
3. 如果使用官方服务器，`Connection Server` 填回 `aoo.sonobus.net`，不勾选 `Use Relay`。
4. 如果使用自建服务器，`Connection Server` 填：

```text
<你的服务器IP或域名>:10998
```

5. 勾选 `Use Relay` 后，`Relay Server` 会自动使用同一台服务器；端口默认 `9000`，如果服务端改过 `UDP_RELAY_PORT`，把这里改成自己的中继端口：

```text
<你的服务器IP或域名>:9000
```

示例：

```text
your-server.example.com:9000
203.0.113.10:9000
```

`203.0.113.10` 是文档示例 IP，不是实际服务器。

## Connection Server 和 Relay Server 的区别

- `Connection Server`：SonoBus 用它让同一个 group 的用户互相发现。默认连接服务器可以继续使用。
- `Relay Server`：本项目新增的公网 UDP 中继。没有公网 IP、NAT 无法直连时，音频包通过这里转发。

如果继续使用默认 `aoo.sonobus.net`，你的 Web 管理页面只能看到 relay 音频心跳，不能真正把用户从 SonoBus 房间踢掉。要让 Web 里的踢出/封禁生效，必须使用你自己的 `Connection Server`。

不要把 relay server 写成某个固定公网 IP；分发给用户时让用户填写自己的服务器。

## 注意

- 这是 relay 强制模式；后续可以继续做成 “P2P 失败后自动切换 relay”。
- `SBR1` envelope 会增加少量 UDP 头部开销，但音频 payload 不被服务器处理。
- SonoBus 由 Jesse Chappell 编写，并以 GPLv3 授权。可以 fork、修改、编译、二次开发、免费分发或收费分发。
- 如果把修改后的版本发布给别人使用，需要继续遵守 GPL-3.0 / GPLv3，公开对应源码，保留上游版权和许可证声明，并标明你修改过源码。
- 不能把基于 SonoBus 的修改版改成闭源商业软件直接卖。可以商业化分发，但发布版本也要开源，用户也必须能拿到源码，并拥有继续修改和再分发的权利。
- 如果只是本地研究、学习、自己使用，不发布给别人，一般不需要公开源码。
- SonoBus 名称、Logo、商标不一定随 GPL 授权。发布自己的修改版时，建议改名并更换标识，避免让用户误以为是 SonoBus 官方版本。
