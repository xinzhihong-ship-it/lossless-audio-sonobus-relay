# 下载和客户端使用

本文档给普通用户看。所有服务器地址都用占位符，请把 `<你的服务器IP或域名>` 换成自己的公网服务器。

## 1. 去哪里下载

打开 GitHub Actions 页面：

```text
https://github.com/xinzhihong-ship-it/lossless-audio-sonobus-relay/actions
```

页面里的英文说明：

| 英文 | 中文意思 |
| --- | --- |
| `Actions` | 自动构建页面 |
| `Workflow` | 构建任务类型 |
| `Run` | 某一次构建记录 |
| `Artifacts` | 构建产物，下载包 |
| `Download` | 下载 |
| `completed / success` | 已完成 / 成功 |

下载步骤：

1. 打开 `Actions` 页面。
2. 找最新的绿色成功记录。
3. 点进去。
4. 拉到页面底部。
5. 找 `Artifacts`。
6. 下载自己需要的包。

当前只保留最新版构建包，旧构建包已经清理。也就是说，页面底部 `Artifacts`（构建产物）里只应该看到当前可下载的最新版服务器包和客户端包。

## 2. 下载哪个包

| 下载包名 | 中文说明 | 谁用 |
| --- | --- | --- |
| `sonobus-windows-x64-asio` | Windows ASIO 版 | Windows 专业声卡用户，推荐 |
| `sonobus-windows-x64` | Windows 普通版 | Windows 普通用户 |
| `sonobus-macos-universal` | macOS 通用版 | Mac 用户 |
| `sonobus-linux-x64` | Linux x64 版 | Linux 用户 |
| `lossless-audio-server-linux-docker` | Linux 服务器部署包 | 服务器管理员 |

如果你是 Windows 用户，优先下载：

```text
sonobus-windows-x64-asio
```

如果 ASIO 版打不开或没有 ASIO 声卡，再用：

```text
sonobus-windows-x64
```

## 3. Windows 使用

下载 `sonobus-windows-x64-asio` 后解压。

常见文件：

```text
SonoBus.exe
SonoBus.vst3
SonoBusInstrument.vst3
```

英文解释：

| 英文 | 中文意思 |
| --- | --- |
| `Standalone` | 独立桌面程序 |
| `VST3` | DAW 插件格式 |
| `Instrument` | 乐器插件版本 |
| `ASIO` | Windows 低延迟音频驱动 |

### 独立程序

1. 双击 `SonoBus.exe`。
2. Windows 防火墙提示时，允许网络访问。
3. 打开音频设置。
4. `Audio Device Type`（音频设备类型）选择 `ASIO`。
5. `Audio Input Device`（音频输入设备）选择你的声卡输入。
6. `Audio Output Device`（音频输出设备）选择你的声卡输出。

### VST3 插件安装

把这些文件夹复制到：

```text
C:\Program Files\Common Files\VST3\
```

复制内容：

```text
SonoBus.vst3
SonoBusInstrument.vst3
```

然后打开 DAW，执行重新扫描插件。

常见 DAW 英文按钮：

| 英文 | 中文意思 |
| --- | --- |
| `Rescan Plugins` | 重新扫描插件 |
| `Plugin Manager` | 插件管理器 |
| `VST3` | VST3 插件 |
| `Insert` | 插入插件 |

## 4. macOS 使用

下载 `sonobus-macos-universal` 后解压。

常见文件：

```text
SonoBus.app
SonoBus.vst3
SonoBusInstrument.vst3
SonoBus.component
SonoBus.lv2
```

英文解释：

| 英文 | 中文意思 |
| --- | --- |
| `universal` | 同时支持 Intel Mac 和 Apple Silicon Mac |
| `app` | Mac 应用程序 |
| `component` | AU 插件 |
| `LV2` | LV2 插件 |
| `CoreAudio` | macOS 原生音频系统 |

### 独立程序

1. 把 `SonoBus.app` 拖到 `Applications`（应用程序）。
2. 第一次打开如果被 macOS 拦截：
   - 打开 `系统设置`
   - 进入 `隐私与安全性`
   - 找到拦截提示
   - 点击允许打开
3. 进入 SonoBus 音频设置，选择输入和输出设备。

### 插件安装位置

VST3：

```text
/Library/Audio/Plug-Ins/VST3/
```

AU：

```text
/Library/Audio/Plug-Ins/Components/
```

LV2：

```text
~/Library/Audio/Plug-Ins/LV2/
```

复制后重启 DAW，或重新扫描插件。

## 5. Linux 客户端使用

下载 `sonobus-linux-x64` 后解压：

```bash
tar -xzf sonobus-linux-x64.tar.gz
cd linux-x64
```

运行独立程序：

```bash
chmod +x SonoBus 2>/dev/null || chmod +x sonobus 2>/dev/null || true
./SonoBus 2>/dev/null || ./sonobus
```

插件目录：

```text
VST3: ~/.vst3/
LV2:  ~/.lv2/
```

## 6. 连接自己的服务器

如果用户没有公网 IP，或者公司/家庭网络不能直连，就使用自建服务器中继。

SonoBus 连接页面常见字段：

| 英文 | 中文意思 | 应该填什么 |
| --- | --- | --- |
| `Group Name` | 房间名/群组名 | 多人填同一个 |
| `Your Displayed Name` | 你的显示名 | 每个人不要重复 |
| `Group Password` | 房间密码 | 可选，多人一致 |
| `Connection Server` | 连接服务器 | `<你的服务器IP或域名>:10998` |
| `Use Relay` | 使用中继 | 勾选 |
| `Relay Server` | 中继服务器 | `<你的服务器IP或域名>:9000` |

自建服务器填写：

```text
Connection Server（连接服务器）: <你的服务器IP或域名>:10998
Use Relay（使用中继）: 勾选
Relay Server（中继服务器）: <你的服务器IP或域名>:9000
```

如果服务器改过中继端口，把 `9000` 换成自己的 `UDP_RELAY_PORT`。

多人必须一致：

- 同一个 `Group Name`（房间名）
- 同一个 `Connection Server`（连接服务器）
- 同一个 `Relay Server`（中继服务器）
- 如果填了 `Group Password`（房间密码），也必须一致

用户名不要重复。

## 7. 使用官方服务器

如果你不想用自己的中继服务器，可以继续使用官方 SonoBus。

这种情况下：

- `Connection Server` 保持默认。
- 不勾选 `Use Relay`。
- 不填写 `Relay Server`。

注意：如果继续使用官方服务器，自己的 Linux Web 管理后台无法踢出/封禁这些用户。

## 8. Web 管理员密码和 SonoBus 房间密码不是一回事

服务器 `.env` 里的：

```text
ADMIN_USERNAME
ADMIN_PASSWORD
```

意思是：

```text
Web 管理后台账号
Web 管理后台密码
```

它们不是 SonoBus 房间密码。

SonoBus 里的：

```text
Group Password
```

意思是：

```text
房间密码
```

这两个系统互不相同。

## 9. 降低延迟建议

英文解释：

| 英文 | 中文意思 |
| --- | --- |
| `Buffer Size` | 缓冲大小 |
| `Jitter Buffer` | 抖动缓冲 |
| `Send Quality` | 发送音质 |
| `PCM 24 bit` | 24 位无损 PCM |
| `PCM 32 bit float` | 32 位浮点 PCM |

建议：

- Windows 使用 ASIO。
- Mac 使用 CoreAudio。
- 尽量用有线网络。
- `Buffer Size` 先试 `128` 或 `256`。
- `Send Quality` 先试 `PCM 24 bit`。
- 网络稳定后再尝试更低缓冲。
- 如果 ping 很高，换更近的服务器。

服务器中继会比 P2P 直连多一跳，这是物理网络决定的。

## 10. 常见问题

### Web 能打开，但 SonoBus 没声音

检查：

- 云服务器安全组是否放行 UDP `9000`。
- SonoBus 是否勾选 `Use Relay`。
- `Relay Server` 是否填写 `<你的服务器IP或域名>:9000`。
- 双方是否同一个 `Group Name`。

### Web 里看不到在线用户

要让 Web 后台看到 SonoBus 房间成员，客户端必须填写：

```text
Connection Server: <你的服务器IP或域名>:10998
```

如果还用默认 `aoo.sonobus.net`，Web 后台看不到真正房间成员。

### 踢出后用户又回来了

踢出只是断开当前连接。对方客户端会自动重连。

要阻止回来，请用：

```text
封禁
```

封禁可以选择：

- 10 分钟
- 1 小时
- 1 天
- 自定义
- 永久

### 误封怎么办

进入 Web 管理后台：

```text
http://<你的服务器IP或域名>/admin
```

在 `封禁列表` 里点击：

```text
解除
```

解除后会从数据库删除，重启 Docker 后不会再恢复。
