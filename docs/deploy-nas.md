# Tools Center 部署指南

本指南覆盖家庭内网场景下的常见部署方式。平台零依赖（仅 Node 22+），可选 Docker / 直接运行 / NAS 套件三种方式。

## 0. 通用前提

- **Node 22+**（22.22.2 验证通过）
- **平台端口**：2626（容器外/宿主访问端口）
- **工具端口段**：8100-8199（应用工具监听，由平台反代）
- **能力端口段**：8200-8299（能力模块内部端口，勿占用）
- **磁盘**：建议挂载 `tools/` `data/` 到独立目录（持久化 + 备份 + 跨升级保留）

## 1. Docker Compose（推荐：群晖/iStoreOS/OpenWrt/Windows）

仓库自带 `docker-compose.yml`，可直接 `docker compose up -d`。

### 群晖 DSM（Container Manager）

1. Container Manager → 项目 → 新建
2. 路径：`/volume1/docker/tools-center`（自行创建）
3. 来源：`docker-compose.yml`（粘贴仓库内容）
4. 端口：`2626` 容器端口 `8080` 自动（平台默认）
5. 卷（路径映射到 NAS 共享）：
   - `docker/tools-center/tools` ↔ `/app/tools`
   - `docker/tools-center/data` ↔ `/app/data`
6. 环境变量：`PORT=8080`（默认即可）
7. 启动后访问：`http://<NAS-IP>:2626/`

### iStoreOS / OpenWrt（路由器）

```bash
# 路由器 SSH（确保已装 Docker）
cd /mnt/usb2/Configs/tools-center
wget https://raw.githubusercontent.com/Simiely/tools-center/main/docker-compose.yml
docker compose up -d
# 访问：http://192.168.1.1:2626
```

**关键**：iStoreOS 默认 fake-ip DNS 模式会让容器内部 `workbuddy.cn` 等外网域名解析失败（拿 198.18.x.x 假地址）。compose 已指定公共 DNS（223.5.5.5 / 119.29.29.29）绕过此问题。

### Windows（Docker Desktop）

```powershell
cd C:\Users\260803\ToolsCenter
# 写 docker-compose.yml（仓库内复制）
docker compose up -d
# 访问：http://localhost:2626
```

## 2. 直接运行（开发 / 测试）

适合不愿用 Docker 的开发场景（Windows / Linux / macOS）。

```bash
git clone https://github.com/Simiely/tools-center.git
cd tools-center
node server.mjs 8080
# 访问：http://127.0.0.1:8080
```

无依赖、无构建步骤。`tools/` 与 `data/` 首次启动自动创建。

## 3. 添加/管理工具

无论哪种部署方式，添加工具的流程一致：

### A. 网页在线添加
- 首页 →「+ 添加」→ 三种模式：
  - **托管进程**（zip 上传）
  - **外部跳转**（纯链接）
  - **Git 导入**（自动识别 manifest.json）

### B. Git 导入（推荐）
- 适合已有独立仓库的工具（积分仪表盘等）
- 工作台 API：`POST /api/tools/import {url, id?, branch?}`

### C. 直接放目录
```bash
# 在宿主挂载目录里：
git clone https://github.com/Simiely/workbuddy-credits-tool.git tools/wb-credits
# 平台自动识别 manifest.json 并托管运行
```

## 4. 持久化与备份

平台内置备份/恢复（无需第三方工具）：

```bash
# 本地备份（默认 data/backups/<ts>/）
curl -X POST http://localhost:2626/api/backup

# WebDAV 远程备份（先在网页配置 WebDAV）
curl -X POST http://localhost:2626/api/webdav/upload

# 查看备份列表
curl http://localhost:2626/api/backup
```

外网备份推荐 WebDAV（坚果云 / 阿里云盘 / 自建 Nextcloud 等）。

## 5. 浏览器能力（双模式）

工具声明 `capabilities: ["browser"]` 时，平台自动提供浏览器桥：

| 部署模式 | backend | 说明 |
|---|---|---|
| 开发（本机） | `dev` | 连接真实 Edge（`--remote-debugging-port=9222`），含登录态 |
| Docker/NAS | `headless` | 自动 spawn headless Chromium，登录态需每次手动 |

通过环境变量切换：
```yaml
environment:
  - EDGE_BROWSER_BACKEND=headless  # 容器/NAS 默认值
```

NAS 上的 headless Chromium 不便扫码登录，**需登录的工具建议放 Windows 宿主**用 dev backend（可通过 `link` 卡片跨平台跳转）。

## 6. 升级

```bash
cd /path/to/tools-center  # 或 NAS 共享目录
docker compose pull        # 拉取新镜像
docker compose up -d       # 重启（数据卷保留）
```

工具代码独立维护的不受影响（自己的 git pull）。

## 7. 故障排查

| 症状 | 检查 |
|---|---|
| 启动后无工具 | `ls tools/` 是否挂载成功；权限是否正确（容器默认 root） |
| 健康检查失败 | `curl http://localhost:2626/api/tools` 看响应 |
| 添加 Git 工具失败 | 看 `/tmp/tc.log` 错误；本地路径用 `C:/...` 而非 `/c/...` |
| 浏览器连接不上 | 9222 端口是否监听；edge-daemon 是否独立运行（独立场景） |
| 外网超时 | DNS 配置（compose 已加公共 DNS）；路由器 fake-ip 是否干扰 |

## 8. 安全建议

- **必设管理员密码**：首次打开页面会弹窗引导，否则删除工具等敏感操作不受密码保护
- **不暴露公网**：本平台是家庭内网工具，不要直接对外
- **数据卷备份**：WebDAV / 定期本地备份（平台自带）

---

## 附录 A：HTTP API 速查

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /api/tools | 工具列表（含状态、能力） |
| POST | /api/tools | 创建工具（app/link/V2 manifest） |
| POST | /api/tools/validate | 在线校验 manifest |
| POST | /api/tools/import | Git 导入 |
| DELETE | /api/tools | 删除工具（需 admin 密码） |
| POST | /api/tools/<id>/restart | 重启工具 |
| GET | /api/capabilities | 能力状态列表 |
| POST | /api/capabilities/<name>/ensure | 懒加载触发 |
| GET | /api/logs/<id> | 工具日志（最近 200 行） |
| POST | /api/backup | 立即本地备份 |
| POST | /api/webdav/upload | WebDAV 远程备份 |
| GET | /tool/<id>/... | 工具反代入口 |

## 附录 B：环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 8080 | 主程序端口 |
| `EDGE_BROWSER_BACKEND` | dev | `dev`（真实 Edge）/ `headless`（spawn Chromium） |
| `EDGE_DEBUG_PORT` | 9222 | 浏览器调试端口 |
| `EDGE_USER_DATA` | /tmp/cap-browser | headless 数据目录 |
| `CHROME_PATH` | 系统默认 | headless 浏览器路径（覆盖默认） |