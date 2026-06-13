# Linux 公网服务器部署

## 服务器要求

- 一台有公网 IP 的 Linux 服务器。
- 域名 A 记录指向服务器公网 IP。
- 开放 TCP `80` 和 `443`。
- 客户端只需要能主动访问 `https://你的域名`，不需要公网 IP，也不需要路由器端口映射。

## 启动

```bash
cd deploy
cp .env.example .env
# 修改 .env 中的域名、JWT_SECRET、管理员密码和数据库密码
docker compose up -d --build
```

Caddy 会自动申请 TLS 证书。客户端填写 `https://你的域名` 作为服务器地址。

## 带宽估算

服务器是中继模式，房间里每个发送者的音频会转发给其他所有人。

示例：48kHz / 24bit / stereo PCM 约 `48000 * 3 * 2 = 288000 B/s`，约 2.3 Mbps。  
如果 4 人同时发送，每个人都接收其他 3 路，服务器出口约 `4 * 3 * 2.3 Mbps = 27.6 Mbps`，还不含协议开销。

## 安全建议

- 使用强 `JWT_SECRET` 和管理员密码。
- 第一版不开放注册，只有管理员能创建用户。
- `MAX_BYTES_PER_SECOND_PER_CLIENT` 用于限制单客户端上行，防止误配置打满带宽。
