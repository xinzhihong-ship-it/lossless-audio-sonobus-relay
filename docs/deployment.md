# Linux 公网服务器部署

本文档从零开始写，适合第一次接触 Linux、Docker、FinalShell 的用户。

文档里不会写真实服务器 IP。请把 `<你的服务器IP>`、`<你的域名>`、`<你的管理员密码>` 换成自己的信息。

## 1. 部署后有什么

部署完成后，服务器会运行 4 个服务：

| 服务名 | 中文意思 | 作用 |
| --- | --- | --- |
| `postgres` | PostgreSQL 数据库 | 保存管理员账号、房间、封禁列表 |
| `server` | Node.js 管理服务 | Web 后台、API、UDP relay |
| `connection-server` | SonoBus 连接服务器 | 让 SonoBus 用户进入同一个 group，并支持踢出/封禁 |
| `caddy` | HTTP/HTTPS 反向代理 | 对外提供 Web 管理页面 |

端口：

| 端口 | 协议 | 中文说明 |
| --- | --- | --- |
| `80` | TCP | HTTP 网页访问 |
| `443` | TCP | HTTPS 网页访问，有域名时使用 |
| `9000` | UDP | Relay Server，中继音频包 |
| `10998` | TCP/UDP | Connection Server，SonoBus 连接服务器 |

## 2. 服务器准备

推荐：

| 项目 | 建议 |
| --- | --- |
| 系统 | Ubuntu 22.04 或 Ubuntu 24.04 |
| CPU | 2 核以上 |
| 内存 | 2 GB 以上 |
| 带宽 | 10 Mbps 起步，人多要更高 |
| 软件 | Docker 已安装 |
| 网络 | 有公网 IP |

云服务器安全组必须放行：

```text
TCP 80
TCP 443
UDP 9000
TCP 10998
UDP 10998
```

英文解释：

| 英文 | 中文意思 |
| --- | --- |
| `Security Group` | 云服务器安全组 |
| `Inbound Rule` | 入站规则 |
| `TCP` | 常见网页/连接协议 |
| `UDP` | 实时音频包常用协议 |

## 3. 下载服务器部署包

打开：

```text
https://github.com/xinzhihong-ship-it/lossless-audio-sonobus-relay/actions
```

下载：

```text
lossless-audio-server-linux-docker
```

英文解释：

| 英文 | 中文意思 |
| --- | --- |
| `Actions` | GitHub 自动构建页面 |
| `Artifact` | 构建产物，下载包 |
| `Download` | 下载 |
| `success` | 构建成功 |

下载后你会得到一个压缩包，里面通常有：

```text
lossless-audio-server-linux-docker.tar.gz
```

如果 GitHub 页面里同时有很多历史构建，请选最新的绿色 `success`。旧包可能缺少最新的封禁、解封、中继修复。

如果你是开发者，也可以从源码目录自己打包：

```bash
cd "<你的项目目录>"
COPYFILE_DISABLE=1 tar -czf /tmp/lossless-audio.tar.gz \
  deploy docs packages tools package.json package-lock.json tsconfig.base.json README.md \
  sonobus/deps/aoo
```

## 4. 上传到 Linux 服务器

### 方法 A：FinalShell 上传

1. 打开 FinalShell。
2. 连接你的 Linux 服务器。
3. 登录用户一般是 `ubuntu` 或 `root`。
4. 左侧/右侧文件面板进入 `/home/ubuntu`。
5. 把压缩包拖进去。
6. 如果拖拽无效，用 FinalShell 的上传按钮。

上传后，在 SSH 命令窗口执行：

```bash
ls -lh /home/ubuntu
```

确认能看到压缩包。

### 方法 B：Mac/Linux 终端上传

如果你从 GitHub 下载的是服务器部署包：

```bash
scp lossless-audio-server-linux-docker.tar.gz ubuntu@<你的服务器IP>:/home/ubuntu/
```

如果你从源码目录自己打包的是 `/tmp/lossless-audio.tar.gz`：

```bash
scp /tmp/lossless-audio.tar.gz ubuntu@<你的服务器IP>:/home/ubuntu/
```

第一次连接可能提示：

```text
Are you sure you want to continue connecting (yes/no/[fingerprint])?
```

中文意思：

```text
这是第一次连接这台服务器，是否信任？
```

输入：

```text
yes
```

然后输入服务器密码。

## 5. 解压到 /opt/lossless-audio

SSH 登录服务器，执行：

```bash
sudo -i
mkdir -p /opt/lossless-audio
```

如果你上传的是 GitHub Actions 下载的服务器包：

```bash
tar -xzf /home/ubuntu/lossless-audio-server-linux-docker.tar.gz -C /opt/lossless-audio --strip-components=1
```

如果你上传的是自己源码打包的包：

```bash
tar -xzf /home/ubuntu/lossless-audio.tar.gz -C /opt/lossless-audio
```

设置权限：

```bash
chown -R ubuntu:ubuntu /opt/lossless-audio
```

检查文件：

```bash
cd /opt/lossless-audio
ls
```

应该看到：

```text
deploy  docs  packages  tools  package.json  package-lock.json  README.md
```

如果 `tar` 提示找不到文件，先确认压缩包名字：

```bash
ls -lh /home/ubuntu
```

如果你看到的文件名不是 `lossless-audio-server-linux-docker.tar.gz`，就把命令里的文件名改成实际名字。

## 6. 创建 .env 配置

进入部署目录：

```bash
cd /opt/lossless-audio/deploy
```

复制示例配置：

```bash
cp .env.example .env
nano .env
```

英文解释：

| 英文 | 中文意思 |
| --- | --- |
| `.env` | 环境配置文件 |
| `nano` | Linux 里的文本编辑器 |
| `PUBLIC_DOMAIN` | 对外访问域名或监听地址 |
| `JWT_SECRET` | 登录令牌签名密钥 |
| `ADMIN_USERNAME` | Web 管理员用户名 |
| `ADMIN_PASSWORD` | Web 管理员密码 |
| `POSTGRES_PASSWORD` | 数据库密码 |
| `UDP_RELAY_PORT` | UDP 音频中继端口 |
| `CONNECTION_SERVER_PORT` | SonoBus 连接服务器端口 |

### 没有域名，只用公网 IP

把 `.env` 写成这样：

```dotenv
PUBLIC_DOMAIN=:80 # 没有域名时这样写，表示只监听 HTTP 80 端口
JWT_SECRET=请改成一串很长的随机字符 # 登录令牌签名密钥，必须改
ADMIN_USERNAME=admin # Web 管理后台用户名
ADMIN_PASSWORD=请改成你的管理员密码 # Web 管理后台密码
POSTGRES_DB=lossless_audio # 数据库名，一般不用改
POSTGRES_USER=lossless_audio # 数据库用户名，一般不用改
POSTGRES_PASSWORD=请改成数据库密码 # PostgreSQL 数据库密码，必须改
MAX_BYTES_PER_SECOND_PER_CLIENT=52428800 # 单客户端最大上行字节数/秒，默认 50 MB/s
UDP_RELAY_PORT=9000 # Relay Server 音频中继端口，云安全组放行 UDP 9000
CONNECTION_SERVER_PORT=10998 # Connection Server 端口，云安全组放行 TCP/UDP 10998
```

访问地址：

```text
http://<你的服务器IP>/admin
```

### 有域名

如果你有域名，并且域名已经解析到服务器 IP：

```dotenv
PUBLIC_DOMAIN=<你的域名> # 例如 audio.example.com，不要写 https://
JWT_SECRET=请改成一串很长的随机字符 # 登录令牌签名密钥，必须改
ADMIN_USERNAME=admin # Web 管理后台用户名
ADMIN_PASSWORD=请改成你的管理员密码 # Web 管理后台密码
POSTGRES_DB=lossless_audio # 数据库名，一般不用改
POSTGRES_USER=lossless_audio # 数据库用户名，一般不用改
POSTGRES_PASSWORD=请改成数据库密码 # PostgreSQL 数据库密码，必须改
MAX_BYTES_PER_SECOND_PER_CLIENT=52428800 # 单客户端最大上行字节数/秒，默认 50 MB/s
UDP_RELAY_PORT=9000 # Relay Server 音频中继端口，云安全组放行 UDP 9000
CONNECTION_SERVER_PORT=10998 # Connection Server 端口，云安全组放行 TCP/UDP 10998
```

访问地址：

```text
https://<你的域名>/admin
```

Caddy 会自动申请 HTTPS 证书。

### 生成随机密钥

生成 `JWT_SECRET`：

```bash
openssl rand -hex 32
```

生成数据库密码：

```bash
openssl rand -base64 24
```

保存 nano：

```text
Ctrl + O
Enter
Ctrl + X
```

## 7. 第一次启动

在 `/opt/lossless-audio/deploy` 执行：

```bash
docker compose up -d --build
```

英文解释：

| 英文 | 中文意思 |
| --- | --- |
| `docker compose` | Docker 多容器管理命令 |
| `up` | 启动服务 |
| `-d` | 后台运行 |
| `--build` | 重新构建镜像 |

第一次启动会比较慢，因为要下载镜像和编译 `connection-server`。

如果在腾讯云等国内服务器上，`apt-get` 下载慢是正常现象。后续只更新 Web/后台时，不需要重编译 `connection-server`。

## 8. 检查服务

查看容器状态：

```bash
docker compose ps
```

正常应该看到：

```text
postgres            Up
server              Up
connection-server   Up
caddy               Up
```

测试健康检查：

```bash
curl -i http://127.0.0.1/health
```

正常返回：

```json
{"ok":true}
```

测试 Web 管理页面是否是最新版：

```bash
curl -s http://127.0.0.1/admin | grep -E "数据库|Docker 重启|永久|自定义"
```

正常能看到类似：

```text
封禁保存在数据库里，Docker 重启后会自动恢复。
```

## 9. 浏览器打开后台

没有域名：

```text
http://<你的服务器IP>/admin
```

有域名：

```text
https://<你的域名>/admin
```

页面字段：

| 页面文字 | 中文说明 |
| --- | --- |
| `服务器地址` | 自动填当前打开的地址 |
| `管理员账号` | `.env` 里的 `ADMIN_USERNAME` |
| `管理员密码` | `.env` 里的 `ADMIN_PASSWORD` |
| `在线连接` | 当前连接的人 |
| `封禁列表` | 当前被封禁的人 |

浏览器如果显示旧页面，强制刷新：

```text
Mac: Command + Shift + R
Windows: Ctrl + F5
```

## 10. 客户端填写

SonoBus 客户端里填写：

```text
Connection Server（连接服务器）: <你的服务器IP或域名>:10998
Use Relay（使用中继）: 勾选
Relay Server（中继服务器）: <你的服务器IP或域名>:9000
```

如果改过 `UDP_RELAY_PORT`，把 `9000` 换成你的端口。

多人要填同一个：

- `Group Name`（房间名）
- `Connection Server`（连接服务器）
- `Relay Server`（中继服务器）
- `Group Password`（房间密码，如果有）

## 11. 更新服务器

### 情况 A：从 GitHub 下载新版服务器包更新

先把新版 `lossless-audio-server-linux-docker.tar.gz` 上传到服务器 `/home/ubuntu/`，然后执行：

```bash
sudo -i
cd /opt/lossless-audio
tar -xzf /home/ubuntu/lossless-audio-server-linux-docker.tar.gz -C /opt/lossless-audio --strip-components=1
chown -R ubuntu:ubuntu /opt/lossless-audio

cd /opt/lossless-audio/deploy
docker compose up -d --build

curl -i http://127.0.0.1/health
curl -s http://127.0.0.1/admin | grep -E "数据库|Docker 重启|永久|自定义"
```

如果健康检查返回：

```json
{"ok":true}
```

并且 `grep` 有输出，说明更新成功。

### 情况 B：从本地源码打包更新

Mac 本机源码目录执行：

```bash
cd "<你的项目目录>"
COPYFILE_DISABLE=1 tar -czf /tmp/lossless-audio.tar.gz \
  deploy docs packages tools package.json package-lock.json tsconfig.base.json README.md \
  sonobus/deps/aoo

scp /tmp/lossless-audio.tar.gz ubuntu@<你的服务器IP>:/home/ubuntu/
```

服务器执行：

```bash
sudo -i
cd /opt/lossless-audio
tar -xzf /home/ubuntu/lossless-audio.tar.gz -C /opt/lossless-audio
chown -R ubuntu:ubuntu /opt/lossless-audio

cd /opt/lossless-audio/deploy
docker compose up -d --build

curl -i http://127.0.0.1/health
```

### 情况 C：只改了 Web 后台、数据库逻辑、Node 服务端

如果源码已经在 `/opt/lossless-audio` 里，只想快速重建 Node 服务端：

```bash
cd /opt/lossless-audio/deploy
docker compose build --no-cache server
docker compose up -d --no-deps server
```

英文解释：

| 英文 | 中文意思 |
| --- | --- |
| `--no-cache` | 不用旧缓存，重新构建 |
| `--no-deps` | 不重启依赖服务 |
| `server` | 只更新 Node 服务端 |

### 情况 D：改了 SonoBus connection-server C++ 代码

只有改了 `tools/connection-server` 或 `sonobus/deps/aoo` 时，才需要：

```bash
docker compose build --no-cache connection-server
docker compose up -d --no-deps connection-server
docker compose restart server
```

不要每次都执行：

```bash
docker compose up -d --build
```

因为它可能重新编译 `connection-server`，国内服务器会很慢。

### 腾讯云/国内服务器 apt 下载慢

如果构建 `connection-server` 很慢，可以确认 `deploy/Dockerfile.connection-server` 里已经使用国内镜像逻辑。正常新版已经包含：

```text
mirrors.tencent.com
```

检查：

```bash
grep -n "mirrors.tencent.com" /opt/lossless-audio/deploy/Dockerfile.connection-server
```

如果没有输出，说明服务器上的部署包太旧，重新上传最新版。

## 12. 常用命令

进入部署目录：

```bash
cd /opt/lossless-audio/deploy
```

查看状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f server
```

重启 Node 服务：

```bash
docker compose restart server
```

重启全部服务：

```bash
docker compose restart
```

停止全部服务：

```bash
docker compose down
```

注意：`docker compose down` 不会删除数据库卷；不要随便加 `-v`。

## 13. 测试封禁持久化

1. 打开 Web 后台。
2. 封禁一个在线用户。
3. 重启 Node 服务：

```bash
docker compose restart server
```

4. 刷新 Web 后台。
5. 封禁列表应该还在。
6. 点击 `解除`。
7. 再重启：

```bash
docker compose restart server
```

8. 封禁列表不应该再回来。

这说明数据库持久化和解封删除都正常。

## 14. 常见问题

### `/opt/lossless-audio: Is a directory`

中文意思：这是一个目录，不是命令。

进入目录要用：

```bash
cd /opt/lossless-audio
```

### `curl http://127.0.0.1:8080/health` 不通

当前服务端 `8080` 在 Docker 内部，不一定映射到主机。请用：

```bash
curl http://127.0.0.1/health
```

### 浏览器自动跳 HTTPS

Chrome 可能缓存了 HTTPS。没有域名时请手动输入：

```text
http://<你的服务器IP>/admin
```

如果还跳，试试无痕窗口，或清除该站点的 HSTS/缓存。

### 页面正常，但 SonoBus 没声音

检查：

- 云安全组是否放行 UDP `9000`。
- 客户端是否勾选 `Use Relay`。
- `Relay Server` 是否填写 `<你的服务器IP或域名>:9000`。
- Web 在线列表里 `中继包` 的 `收/转` 是否增长。
- 双方是否同一个 `Group Name`。

### Web 看不到在线用户

客户端必须填写：

```text
Connection Server: <你的服务器IP或域名>:10998
```

如果继续使用默认 `aoo.sonobus.net`，Web 后台无法真正看到和管理房间成员。

### 踢出没用

踢出只是断开当前连接，客户端可能自动重连。

要阻止回来，请使用：

```text
封禁
```

### 解封后又回来封禁

新版已经修复：解除封禁会从数据库删除，也会清掉 UDP 音频中继里的对应封禁。

检查是否是新版：

```bash
curl -s http://127.0.0.1/admin | grep "封禁保存在数据库"
```

有输出才是新版。

如果你刚从旧版更新，建议：

```bash
docker compose restart server connection-server
```

然后在 Web 后台刷新封禁列表，把误封记录解除一遍。

## 15. 带宽估算

48kHz / 24bit / stereo PCM 一路大约：

```text
48000 * 3 bytes * 2 channels = 288000 B/s
```

约等于：

```text
2.3 Mbps
```

4 人同时发送，服务器出口大约：

```text
4 * 3 * 2.3 Mbps = 27.6 Mbps
```

实际还会有协议开销。

## 16. 安全建议

- 不要把 `.env` 上传到 GitHub。
- 不要公开真实服务器 IP、管理员密码、数据库密码。
- `JWT_SECRET` 必须使用长随机字符串。
- `ADMIN_PASSWORD` 必须用强密码。
- 只给可信的人 Web 后台账号。
- 云安全组只开放需要的端口。
