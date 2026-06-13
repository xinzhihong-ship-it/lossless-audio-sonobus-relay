# Linux 公网服务器部署

本文档是从零开始的 Linux 部署说明。文档不会包含任何真实服务器 IP；请把示例中的 `<你的服务器IP>`、`<你的域名>`、`your-server.example.com` 替换成自己的服务器地址。

## 1. 部署目标

部署完成后，服务器会提供两类能力：

- HTTP/HTTPS 服务：登录、房间、健康检查、WebSocket API。
- UDP relay 服务：SonoBus 客户端没有公网 IP 时，通过服务器转发音频包。

客户端不需要公网 IP，不需要端口映射，只要能主动访问你的服务器即可。

## 2. 服务器要求

推荐配置：

| 项目 | 建议 |
| --- | --- |
| 系统 | Ubuntu 22.04 / Ubuntu 24.04 |
| CPU | 2 核以上 |
| 内存 | 2 GB 以上 |
| 带宽 | 按人数和 PCM 码率估算，建议 10 Mbps 起步 |
| 软件 | Docker、Docker Compose |
| 网络 | 有公网 IP |

必须开放的端口：

| 端口 | 协议 | 用途 |
| --- | --- | --- |
| `80` | TCP | HTTP / Caddy 自动申请证书 |
| `443` | TCP | HTTPS API / WebSocket |
| `9000` | UDP | SonoBus 音频 relay |

如果你没有域名，也可以先只用公网 IP 测试。IP 测试模式使用 HTTP，不自动申请 TLS 证书。

## 3. 从 GitHub 下载部署包

进入项目 GitHub 页面：

1. 点击 `Actions`。
2. 左侧选择 `Build Linux Server Bundle`。
3. 点击最新的绿色成功记录。
4. 页面底部下载 Artifact：`lossless-audio-server-linux-docker`。
5. 解压后会得到：

```text
lossless-audio-server-linux-docker.tar.gz
```

这个压缩包就是 Linux 服务器部署包。

## 4. 上传到服务器

### 方法 A：FinalShell 上传

1. 用 FinalShell 连接服务器。
2. 登录用户可以是 `ubuntu` 或 `root`。
3. 打开服务器目录 `/home/ubuntu` 或 `/root`。
4. 把 `lossless-audio-server-linux-docker.tar.gz` 拖到 FinalShell 文件窗口。
5. 如果拖拽无效，使用 FinalShell 的上传按钮。

上传后在服务器执行：

```bash
ls -lh
```

确认能看到：

```text
lossless-audio-server-linux-docker.tar.gz
```

### 方法 B：Mac/Linux 用 scp 上传

在自己电脑终端执行：

```bash
scp lossless-audio-server-linux-docker.tar.gz ubuntu@<你的服务器IP>:/home/ubuntu/
```

如果你不是从 GitHub Actions 下载部署包，而是在本机源码目录直接打包，使用：

```bash
cd "<你的项目目录>"
COPYFILE_DISABLE=1 tar -czf /tmp/lossless-audio.tar.gz \
  deploy docs packages tools package.json package-lock.json tsconfig.base.json README.md \
  sonobus/deps/aoo
scp /tmp/lossless-audio.tar.gz ubuntu@<你的服务器IP>:/home/ubuntu/
```

服务器上解压这个本地源码包时使用：

```bash
sudo mkdir -p /opt/lossless-audio
sudo tar -xzf /home/ubuntu/lossless-audio.tar.gz -C /opt/lossless-audio
sudo chown -R ubuntu:ubuntu /opt/lossless-audio
cd /opt/lossless-audio/deploy
docker compose up -d --build
```

第一次连接会提示：

```text
Are you sure you want to continue connecting (yes/no/[fingerprint])?
```

输入：

```text
yes
```

然后输入服务器密码。

## 5. 解压到 /opt/lossless-audio

SSH 登录服务器后执行：

```bash
sudo mkdir -p /opt/lossless-audio
sudo tar -xzf ~/lossless-audio-server-linux-docker.tar.gz -C /opt/lossless-audio --strip-components=1
sudo chown -R "$USER":"$USER" /opt/lossless-audio
cd /opt/lossless-audio
ls
```

正常应该看到：

```text
deploy  docs  package.json  package-lock.json  packages  README.md  tsconfig.base.json
```

进入部署目录：

```bash
cd /opt/lossless-audio/deploy
ls
```

正常应该看到：

```text
Caddyfile  Dockerfile.server  docker-compose.yml
```

## 6. 创建 .env 配置

复制示例配置：

```bash
cp .env.example .env
nano .env
```

如果提示没有 `.env.example`，说明部署包不完整，可以手动创建：

```bash
nano .env
```

### 有域名的配置

如果你有域名，例如 `audio.example.com`，并且域名 A 记录已经指向服务器公网 IP：

```dotenv
PUBLIC_DOMAIN=your-server.example.com # 你的域名；不要写 https://
JWT_SECRET=replace-with-a-long-random-secret # JWT 登录签名密钥；必须改成长随机字符串
ADMIN_USERNAME=admin # 管理员用户名；用于登录和创建用户
ADMIN_PASSWORD=replace-with-a-strong-password # 管理员密码；必须改成强密码
POSTGRES_DB=lossless_audio # PostgreSQL 数据库名；一般不用改
POSTGRES_USER=lossless_audio # PostgreSQL 数据库用户名；一般不用改
POSTGRES_PASSWORD=replace-with-a-strong-db-password # PostgreSQL 数据库密码；必须改成强密码
MAX_BYTES_PER_SECOND_PER_CLIENT=52428800 # 单客户端最大上行字节数/秒；默认 50 MB/s，防止异常打满带宽
UDP_RELAY_PORT=9000 # SonoBus UDP 中继端口；云安全组必须放行 UDP 9000
CONNECTION_SERVER_PORT=10998 # SonoBus Connection Server 端口；云安全组必须放行 TCP/UDP 10998
```

把 `PUBLIC_DOMAIN` 改成你的域名：

```dotenv
PUBLIC_DOMAIN=<你的域名> # 例如 audio.example.com；不要写 https://
```

有域名时，Caddy 会自动申请 HTTPS 证书。

### 没有域名，只有公网 IP 的配置

如果你暂时没有域名，只想用公网 IP 测试：

```dotenv
PUBLIC_DOMAIN=:80 # 没有域名时使用 IP 测试；Caddy 只监听 HTTP 80
JWT_SECRET=replace-with-a-long-random-secret # JWT 登录签名密钥；必须改成长随机字符串
ADMIN_USERNAME=admin # 管理员用户名；用于登录和创建用户
ADMIN_PASSWORD=replace-with-a-strong-password # 管理员密码；必须改成强密码
POSTGRES_DB=lossless_audio # PostgreSQL 数据库名；一般不用改
POSTGRES_USER=lossless_audio # PostgreSQL 数据库用户名；一般不用改
POSTGRES_PASSWORD=replace-with-a-strong-db-password # PostgreSQL 数据库密码；必须改成强密码
MAX_BYTES_PER_SECOND_PER_CLIENT=52428800 # 单客户端最大上行字节数/秒；默认 50 MB/s，防止异常打满带宽
UDP_RELAY_PORT=9000 # SonoBus UDP 中继端口；云安全组必须放行 UDP 9000
CONNECTION_SERVER_PORT=10998 # SonoBus Connection Server 端口；云安全组必须放行 TCP/UDP 10998
```

IP 模式下 HTTP API 地址是：

```text
http://<你的服务器IP>
```

SonoBus relay 地址是：

```text
<你的服务器IP>:9000
```

SonoBus Connection Server 地址是：

```text
<你的服务器IP>:10998
```

服务器安全组至少放行：

- TCP `80`：Web 管理页面和 HTTP API。
- UDP `9000`：SonoBus relay 音频中继。
- TCP `10998`：SonoBus Connection Server 控制连接。
- UDP `10998`：SonoBus Connection Server NAT 探测。

不要把真实 IP 写到公开 README、截图、Issue 或论坛帖子里。

### 生成随机密钥

可以用下面命令生成 `JWT_SECRET`：

```bash
openssl rand -hex 32
```

数据库密码也建议生成一个随机值：

```bash
openssl rand -base64 24
```

保存 nano：

```text
Ctrl + O
Enter
Ctrl + X
```

### 这些账号密码分别管什么

`.env` 里的账号密码只用于服务器 HTTP/API：

| 配置 | 作用 |
| --- | --- |
| `ADMIN_USERNAME` | 服务器管理员登录用户名 |
| `ADMIN_PASSWORD` | 服务器管理员登录密码 |
| `POSTGRES_PASSWORD` | 数据库内部密码，不是用户登录密码 |
| `JWT_SECRET` | 登录 token 签名密钥，不是用户登录密码 |
| `UDP_RELAY_PORT` | SonoBus 音频中继端口，默认 UDP 9000 |
| `CONNECTION_SERVER_PORT` | SonoBus 房间发现/成员管理端口，默认 TCP/UDP 10998 |

注意：

- `ADMIN_USERNAME` / `ADMIN_PASSWORD` 不会自动变成 SonoBus 的 Group Password。
- SonoBus 的 `Group Password` 是 SonoBus 房间密码，在 SonoBus 客户端连接页面里单独填写。
- SonoBus 的 `Relay Server` 只用来转发 UDP 音频包，不会校验 `ADMIN_PASSWORD`。
- 要让 Web 管理页面真正看到并踢出 SonoBus 房间成员，客户端必须把 `Connection Server` 填成 `<你的服务器IP或域名>:10998`，不能继续用默认 `aoo.sonobus.net`。
- 修改 `.env` 里的 `ADMIN_PASSWORD` 后，需要重启服务才会生效。

重启命令：

```bash
docker compose up -d --build
```

新版服务启动时会同步 `.env` 里的管理员密码。如果数据库里已经存在同名管理员，也会把密码更新成 `.env` 当前值。

## 7. 启动服务

在 `/opt/lossless-audio/deploy` 目录执行：

```bash
docker compose up -d --build
```

第一次启动会下载镜像并编译服务端，可能需要几分钟。

查看容器状态：

```bash
docker compose ps
```

正常会看到类似：

```text
postgres   Up
server     Up
caddy      Up
```

查看日志：

```bash
docker compose logs -f
```

只看服务端日志：

```bash
docker compose logs -f server
```

退出日志查看：

```text
Ctrl + C
```

## 8. 检查是否部署成功

### 有域名

在服务器上测试：

```bash
curl http://127.0.0.1/health
```

在自己电脑上测试：

```bash
curl https://<你的域名>/health
```

正常返回：

```json
{"ok":true}
```

### 没有域名，只有公网 IP

在服务器上测试：

```bash
curl http://127.0.0.1/health
```

在自己电脑上测试：

```bash
curl http://<你的服务器IP>/health
```

正常返回：

```json
{"ok":true}
```

注意：当前 compose 默认不把服务端 `8080` 直接暴露到公网，HTTP 访问走 Caddy 的 `80` 或 `443`。

## 9. 云服务器安全组

除了服务器里的 Docker，云厂商控制台也必须放行端口。

在腾讯云、阿里云、华为云、AWS 等安全组里添加：

```text
TCP 80
TCP 443
UDP 9000
```

如果只放行了 TCP，没有放行 UDP `9000`，页面健康检查可能正常，但 SonoBus 音频 relay 会失败或收不到声音。

Ubuntu 自带防火墙如果开启了，也要放行：

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 9000/udp
sudo ufw status
```

如果 `ufw status` 显示 inactive，说明本机防火墙没有启用，只需要检查云安全组。

## 10. 客户端怎么填写

### SonoBus 客户端

在 SonoBus 连接页面：

1. 填写 `Group Name`。
2. 填写 `Your Displayed Name`。
3. `Connection Server` 可以继续使用默认值。
4. 勾选 `Use Relay`。
5. `Relay Server` 填自己的服务器。

有域名：

```text
<你的域名>:9000
```

没有域名：

```text
<你的服务器IP>:9000
```

多人要填同一个 `Group Name` 和同一个 `Relay Server`，用户名不要重复。

### Electron/WebSocket MVP 客户端

有域名：

```text
https://<你的域名>
```

没有域名：

```text
http://<你的服务器IP>
```

实际音乐/DAW 使用优先使用 SonoBus 改造版。

## 11. 常用维护命令

进入部署目录：

```bash
cd /opt/lossless-audio/deploy
```

启动：

```bash
docker compose up -d
```

停止：

```bash
docker compose down
```

重启：

```bash
docker compose restart
```

更新代码后重新构建：

```bash
docker compose up -d --build
```

查看容器：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f
```

查看磁盘：

```bash
df -h
```

清理未使用 Docker 缓存：

```bash
docker system prune -f
```

## 12. 常见问题

### 提示 `/opt/lossless-audio: Is a directory`

这是因为你把目录当命令执行了。进入目录要用 `cd`：

```bash
cd /opt/lossless-audio
```

### `docker compose` 命令不存在

先确认 Docker 是否安装：

```bash
docker --version
docker compose version
```

如果没有安装 Docker Compose 插件，需要安装：

```bash
sudo apt update
sudo apt install -y docker-compose-plugin
```

### `curl http://<你的服务器IP>/health` 访问不了

检查：

```bash
docker compose ps
docker compose logs caddy
docker compose logs server
```

然后确认云安全组放行了 TCP `80`。

### 有域名但 HTTPS 证书申请失败

检查：

- 域名 A 记录是否指向当前服务器公网 IP。
- 云安全组是否放行 TCP `80` 和 `443`。
- `.env` 里的 `PUBLIC_DOMAIN` 是否只写域名，不要写 `https://`。

正确：

```dotenv
PUBLIC_DOMAIN=your-server.example.com
```

错误：

```dotenv
PUBLIC_DOMAIN=https://your-server.example.com
```

### SonoBus 能进房但没有声音

优先检查 UDP `9000`：

- 云安全组是否放行 UDP `9000`。
- `.env` 里的 `UDP_RELAY_PORT` 是否是 `9000`。
- SonoBus 里的 `Relay Server` 是否填写 `<你的服务器IP或域名>:9000`。
- SonoBus 里的 `Connection Server` 是否填写 `<你的服务器IP或域名>:10998`。
- 两边是否都勾选 `Use Relay`。

### 延迟很大

relay 比 P2P 直连多一跳。延迟主要取决于网络：

- 服务器是否离双方太远。
- 双方是否使用 Wi-Fi。
- Ping 是否过高。
- 是否使用了过大的音频 buffer。
- 是否使用了 `PCM 32 bit float` 导致带宽压力过大。

建议：

- Windows 使用 ASIO。
- macOS 使用 CoreAudio。
- 音频 buffer 先试 `128` 或 `256`。
- Send Quality 先试 `PCM 24 bit`。
- 服务器尽量选择离所有用户都近的地区。

## 13. 带宽估算

服务器是中继模式，房间里每个发送者的音频会转发给其他所有人。

示例：48kHz / 24bit / stereo PCM：

```text
48000 * 3 bytes * 2 channels = 288000 B/s
```

约等于 `2.3 Mbps` 一路上行音频。

如果 4 人同时发送，每个人都接收其他 3 路，服务器出口约：

```text
4 * 3 * 2.3 Mbps = 27.6 Mbps
```

还不含 UDP/IP 协议开销。

## 14. 安全建议

- 使用强 `JWT_SECRET` 和管理员密码。
- 不要提交 `deploy/.env`。
- 不要在公开 README、截图、Issue 或论坛帖子里暴露真实服务器 IP。
- 第一版不开放注册，只有管理员能创建用户。
- `MAX_BYTES_PER_SECOND_PER_CLIENT` 用于限制单客户端上行，防止误配置打满带宽。
