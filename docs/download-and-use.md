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

请下载最新的绿色 `success` 构建。不要长期使用旧包，因为旧包可能缺少：

- 服务器封禁/解除封禁修复。
- SonoBus 中继重连修复。
- macOS 麦克风权限身份修复。

## 2. 下载哪个包

| 下载包名 | 中文说明 | 谁用 |
| --- | --- | --- |
| `sonobus-windows-x64-asio` | Windows ASIO 版 | Windows 专业声卡用户，推荐 |
| `sonobus-windows-x64` | Windows 普通版 | Windows 普通用户 |
| `sonobus-macos-universal` | macOS 通用版 | Mac 用户 |
| `sonobus-linux-x64` | Linux x64 版 | Linux 用户 |
| `lossless-audio-server-linux-docker` | Linux 服务器部署包 | 服务器管理员 |

## 3. 插件放哪个目录

本项目常用插件格式是 `VST3`、`AU`、`LV2`。不同系统和 DAW 支持的格式不一样，按下面放。

英文解释：

| 英文 | 中文意思 |
| --- | --- |
| `DAW` | 宿主软件，比如 Cubase、Studio One、Logic、Reaper、Ableton Live |
| `VST3` | 常见插件格式，Windows/macOS/Linux 都可用 |
| `AU` | Apple Audio Unit，macOS/Logic 常用插件格式 |
| `LV2` | Linux 常用插件格式，部分 macOS/Linux 宿主支持 |
| `System-wide` | 全系统目录，所有用户都能用 |
| `User-only` | 当前用户目录，只给当前登录用户用 |

### Windows 插件目录

Windows 通常只需要放 `VST3`。

| 插件格式 | 推荐目录 | 中文说明 |
| --- | --- | --- |
| `VST3` | `C:\Program Files\Common Files\VST3\` | 全系统 VST3 插件目录 |

把下面文件夹复制进去：

```text
SonoBus.vst3
SonoBusInstrument.vst3
```

如果 DAW 没扫到，打开 DAW 的 `Plugin Manager`（插件管理器）或 `Rescan Plugins`（重新扫描插件）。

### macOS 插件目录

macOS 可以用 `VST3`、`AU`、`LV2`。Logic Pro 主要用 `AU`，大多数其他 DAW 可以用 `VST3`。

| 插件格式 | 推荐目录 | 中文说明 |
| --- | --- | --- |
| `VST3` | `/Library/Audio/Plug-Ins/VST3/` | 全系统 VST3 插件目录 |
| `VST3` | `~/Library/Audio/Plug-Ins/VST3/` | 当前用户 VST3 插件目录 |
| `AU` | `/Library/Audio/Plug-Ins/Components/` | 全系统 AU 插件目录，Logic Pro 用这个 |
| `AU` | `~/Library/Audio/Plug-Ins/Components/` | 当前用户 AU 插件目录 |
| `LV2` | `/Library/Audio/Plug-Ins/LV2/` | 全系统 LV2 插件目录 |
| `LV2` | `~/Library/Audio/Plug-Ins/LV2/` | 当前用户 LV2 插件目录 |

复制对应文件夹：

```text
SonoBus.vst3
SonoBusInstrument.vst3
SonoBus.component
SonoBus.lv2
```

注意：`~` 表示当前用户目录。例如当前用户是 `xinzhihong`，`~/Library/...` 就是 `/Users/xinzhihong/Library/...`。

### Linux 插件目录

Linux 推荐放到当前用户目录，不需要管理员权限。

| 插件格式 | 当前用户目录 | 全系统目录 |
| --- | --- | --- |
| `VST3` | `~/.vst3/` | `/usr/local/lib/vst3/` 或 `/usr/lib/vst3/` |
| `LV2` | `~/.lv2/` | `/usr/local/lib/lv2/` 或 `/usr/lib/lv2/` |

推荐新手使用当前用户目录：

```bash
mkdir -p ~/.vst3 ~/.lv2
cp -a SonoBus.vst3 ~/.vst3/
cp -a SonoBusInstrument.vst3 ~/.vst3/
cp -a SonoBus.lv2 ~/.lv2/
```

复制后重启 DAW，或者在 DAW 里执行重新扫描插件。

如果你是 Windows 用户，优先下载：

```text
sonobus-windows-x64-asio
```

如果 ASIO 版打不开或没有 ASIO 声卡，再用：

```text
sonobus-windows-x64
```

## 4. Windows 使用

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

把这些文件夹复制到 Windows VST3 插件目录：

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

## 5. macOS 使用

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

### 麦克风权限反复弹怎么办

新版 macOS 包已经固定 `Bundle Identifier`（应用身份）和麦克风权限说明。正常流程是：

1. 把 `SonoBus.app` 放到 `Applications`（应用程序）。
2. 第一次打开时允许麦克风。
3. 以后再打开不应该重复弹麦克风权限。

如果你之前用过旧包，macOS 可能缓存了错误权限记录。先关闭 SonoBus，然后打开 `终端` 执行：

```bash
tccutil reset Microphone com.Sonosaurus.SonoBus
```

英文解释：

| 英文 | 中文意思 |
| --- | --- |
| `tccutil` | macOS 权限数据库工具 |
| `reset` | 重置 |
| `Microphone` | 麦克风权限 |
| `com.Sonosaurus.SonoBus` | SonoBus 的应用身份 |

执行后重新打开 `Applications` 里的新版 `SonoBus.app`，允许一次麦克风即可。

### 插件安装位置

VST3（大多数 DAW 可用）：

```text
/Library/Audio/Plug-Ins/VST3/
```

AU（Logic Pro 常用）：

```text
/Library/Audio/Plug-Ins/Components/
```

或者只安装给当前用户：

```text
~/Library/Audio/Plug-Ins/Components/
```

LV2（部分宿主支持）：

```text
/Library/Audio/Plug-Ins/LV2/
```

或者只安装给当前用户：

```text
~/Library/Audio/Plug-Ins/LV2/
```

复制后重启 DAW，或重新扫描插件。

## 6. Linux 客户端使用

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
VST3 当前用户目录: ~/.vst3/
LV2 当前用户目录:  ~/.lv2/
VST3 全系统目录:   /usr/local/lib/vst3/ 或 /usr/lib/vst3/
LV2 全系统目录:    /usr/local/lib/lv2/ 或 /usr/lib/lv2/
```

新手建议放当前用户目录：

```bash
mkdir -p ~/.vst3 ~/.lv2
cp -a SonoBus.vst3 ~/.vst3/
cp -a SonoBusInstrument.vst3 ~/.vst3/
cp -a SonoBus.lv2 ~/.lv2/
```

## 7. 连接自己的服务器

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

常见错误：

| 错误填法 | 结果 |
| --- | --- |
| 只填 `Connection Server`，不勾选 `Use Relay` | 可能能进房，但无公网 IP 用户音频无法稳定互通 |
| 只填 `Relay Server`，Connection Server 仍用官方 | Web 后台不能完整踢出/封禁房间成员 |
| 两个人 `Group Name` 不同 | 看不到对方 |
| 两个人 `Group Password` 不同 | 进不了同一个房间 |
| 两个人显示名相同 | Web 和客户端里容易混淆 |

## 8. 使用官方服务器

如果你不想用自己的中继服务器，可以继续使用官方 SonoBus。

这种情况下：

- `Connection Server`（连接服务器）：`aoo.sonobus.net`
- `Use Relay`（使用中继）：不勾选。
- `Relay Server`（中继服务器）：留空。

如果之前改过自建服务器，想恢复官方服务器，就把 `Connection Server` 改回 `aoo.sonobus.net`，并关闭 `Use Relay`。

注意：如果继续使用官方服务器，自己的 Linux Web 管理后台无法踢出/封禁这些用户。

## 9. Web 管理员密码和 SonoBus 房间密码不是一回事

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

## 10. 降低延迟建议

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

## 11. 常见问题

### Web 能打开，但 SonoBus 没声音

检查：

- 云服务器安全组是否放行 UDP `9000`。
- SonoBus 是否勾选 `Use Relay`。
- `Relay Server` 是否填写 `<你的服务器IP或域名>:9000`。
- 双方是否同一个 `Group Name`。
- Web 后台的在线连接里是否有 `SonoBus 房间连接 + 音频中继`，并且 `收/转` 数字在增加。

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

### 解除封禁后还是没声音

请确认服务器已经更新到新版。新版修复了“封禁解除后 UDP 音频中继封禁没有清掉”的问题。

服务器上检查：

```bash
cd /opt/lossless-audio/deploy
curl -s http://127.0.0.1/admin | grep "封禁保存在数据库"
```

如果没有输出，说明服务端太旧，需要按 [deployment.md](deployment.md) 的“更新服务器”步骤更新。
