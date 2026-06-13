# 下载和客户端使用

本文档面向最终用户和部署者。所有服务器地址都使用占位示例，请用户填写自己的公网服务器 IP 或域名。

## 项目来源

客户端基于 [SonoBus](https://github.com/sonosaurus/sonobus) 改造。原版 SonoBus 已经支持 Windows、macOS、Linux、Standalone、VST3、AU、LV2 和 DAW/机架加载。本项目在原版能力上增加 `Use Relay` / `Relay Server`，并在 Linux 服务端加入自己的 SonoBus Connection Server，让没有公网 IP 的用户也可以通过自己的 Linux 公网服务器中继音频。

relay 只转发音频包，不混音、不转码、不重采样。

## 1. 下载软件

进入 GitHub 项目页面后：

1. 点击 `Actions`。
2. 在左侧选择需要的平台。
3. 点击最新的绿色成功构建。
4. 在页面底部 `Artifacts` 下载构建包。

Artifacts 对应关系：

| Artifact | 用途 |
| --- | --- |
| `sonobus-windows-x64-asio` | Windows ASIO 版，推荐使用 |
| `sonobus-windows-x64` | Windows 普通版 |
| `sonobus-macos-universal` | macOS app、VST3、AU、LV2 |
| `sonobus-linux-x64` | Linux standalone、VST3、LV2 |
| `lossless-audio-server-linux-docker` | Linux 服务器 Docker 部署包 |

## 2. Windows 安装

推荐下载 `sonobus-windows-x64-asio`。

解压后通常包含：

```text
SonoBus.exe
SonoBus.vst3/
SonoBusInstrument.vst3/
```

Standalone 使用：

1. 双击 `SonoBus.exe`。
2. 第一次启动如果 Windows 防火墙询问是否允许网络访问，请允许专用网络和公用网络。
3. 打开音频设置，`Audio Device Type` 选择 `ASIO`。
4. 选择声卡自带 ASIO 驱动；如果没有专业声卡，可以安装 ASIO4ALL。

VST3 安装：

1. 把 `SonoBus.vst3` 和 `SonoBusInstrument.vst3` 复制到：

```text
C:\Program Files\Common Files\VST3\
```

2. 打开 DAW，重新扫描 VST3 插件。
3. 在音轨或机架里加载 SonoBus。

## 3. macOS 安装

推荐下载 `sonobus-macos-universal`。

解压后通常包含：

```text
SonoBus.app
SonoBus.vst3
SonoBusInstrument.vst3
SonoBus.component
SonoBus.lv2
```

Standalone 使用：

1. 把 `SonoBus.app` 拖到 `Applications`。
2. 第一次打开如果 macOS 安全提示拦截，请到 `系统设置 -> 隐私与安全性` 允许打开。
3. 音频设备使用 CoreAudio，选择输入和输出设备。

插件安装位置：

```text
VST3: /Library/Audio/Plug-Ins/VST3/
AU:   /Library/Audio/Plug-Ins/Components/
LV2:  ~/Library/Audio/Plug-Ins/LV2/
```

复制后重启 DAW 或重新扫描插件。

## 4. Linux 客户端安装

推荐下载 `sonobus-linux-x64`。

解压：

```bash
tar -xzf sonobus-linux-x64.tar.gz
cd linux-x64
```

运行 standalone：

```bash
chmod +x SonoBus 2>/dev/null || chmod +x sonobus 2>/dev/null || true
./SonoBus 2>/dev/null || ./sonobus
```

常见插件目录：

```text
VST3: ~/.vst3/
LV2:  ~/.lv2/
```

复制插件后重启 DAW 或重新扫描插件。

## 5. 启用公网 relay

客户端没有公网 IP、不能端口映射、公司/家庭 NAT 较复杂时，启用 relay。

注意：服务器 `.env` 里的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 是给 HTTP/API 管理用的，不是 SonoBus 的登录密码。SonoBus 客户端连接时主要填写 `Group Name`、自己的用户名、可选的 `Group Password`、`Connection Server`，以及本项目新增的 `Relay Server`。

在 SonoBus 连接页面：

1. 填写 Group Name。
2. 填写 Your Displayed Name。
3. `Connection Server` 填自己的服务器：
4. 勾选 `Use Relay`。
5. `Relay Server` 填自己的服务器：

```text
Connection Server: <你的服务器IP或域名>:10998
Relay Server: <你的服务器IP或域名>:9000
```

示例：

```text
Connection Server: your-server.example.com:10998
Relay Server: your-server.example.com:9000
Connection Server: 203.0.113.10:10998
Relay Server: 203.0.113.10:9000
```

`203.0.113.10` 是文档示例地址，不是实际服务器。

两端或多人必须进入同一个 SonoBus group，并填写同一个 connection server 和 relay server。用户名不要重复。

如果继续使用默认 `aoo.sonobus.net`，音频 relay 仍可工作，但 Linux Web 管理页面不能真正把用户从 SonoBus 房间踢出或封禁。

## 6. 命令行启动示例

如果需要命令行启动：

```bash
SonoBus \
  --group test-room \
  --username alice \
  --connectionserver <你的服务器IP或域名>:10998 \
  --relay-server <你的服务器IP或域名>:9000
```

另一台机器：

```bash
SonoBus \
  --group test-room \
  --username bob \
  --connectionserver <你的服务器IP或域名>:10998 \
  --relay-server <你的服务器IP或域名>:9000
```

## 7. 降低延迟建议

relay 比直连多一跳，延迟主要取决于网络路径。建议：

- 服务器选择离所有用户都近的机房。
- 优先使用有线网络。
- Windows 使用 ASIO 驱动。
- macOS 使用 CoreAudio，并把 buffer 调到 `128` 或 `256`。
- Send Quality 优先试 `PCM 24 bit`，带宽足够再用 `PCM 32 bit float`。
- Recv Jitter Buffer 先用 Auto；如果网络稳定，可手动试 `10ms` 到 `20ms`。
- 如果 Ping 超过 `300ms`，实时演奏会明显慢，应该换更近的服务器或改善网络。

## 8. 隐私和发布注意

- 不要在 README、截图、Issue、论坛帖子里写真实服务器 IP。
- 对外说明统一写 `<你的服务器IP或域名>:9000`。
- 如果要演示，可以使用 `your-server.example.com:9000` 或 `203.0.113.10:9000` 这样的文档示例。
- 不要把 `.env` 上传到 GitHub，里面有密码和密钥。
