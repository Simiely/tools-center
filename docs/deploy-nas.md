# Tools Center 部署指南

本指南覆盖家庭内网场景下的常见部署方式。平台零依赖（仅 Node 22+），可选 Docker / 直接运行 / NAS 套件三种方式。

## 0. 通用前提

- **Node 22+**（22.22.2 验证通过）
- **平台端口**：2626（容器外/宿主访问端口）
- **工具端口段**：8100-8199（应用工具监听，由平台反代）
- **能力端口段**：8200-8299（能力模块内部端口，勿占用）
- **磁盘**：建议挂载 `tools/` `data/` 到独立目录（持久化 + 备份 + 跨升级保留）

## 1. Docker Compose（推荐：群晖/iStoreOS/OpenWrt/Windows）

**两种方式**：
- **方式 A · 本地构建（推荐，不依赖 GitHub 镜像）**：用仓库代码 `docker compose -f docker-compose.local.yml up -d --build` 一条命令完成构建+启动
- **方式 B · 拉取预构建镜像**：`docker compose up -d`（从 `ghcr.io/simiely/tools-center:main` 拉取，由 GitHub CI 自动构建）

> 方式 A 完全自足：本机/内网构建，不依赖外网拉镜像（构建时基础镜像 `node:22-slim` 需能访问 Docker Hub，可配镜像加速器）。本地一键脚本（Windows/NAS 通用）：
> ```bash
> bash deploy-local.sh up      # 构建并启动（http://localhost:2626）
> bash deploy-local.sh logs    # 查看日志
> bash deploy-local.sh update  # 拉代码+重建
> ```
> `deploy-local.sh` 为本地脚本（含本机路径），不在仓库内；通用方式见下方 compose 配置示例。

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

### 完整 NAS 部署示例（隐私路径已用 xxx 占位）

> 这是个人 NAS 部署的完整 compose（字段含义见行内注释）。**替换 `xxx` 为你的实际路径/端口**后保存为 `docker-compose.yml` 使用。

```yaml
services:
  web:
    # 预先构建并推送到镜像仓库的镜像（push main 自动构建，见 .github/workflows/docker-build.yml）。
    # 标签固定为 :main（随 main 分支更新）。
    image: ghcr.io/simiely/tools-center:main
    container_name: tools-center
    # Dockerfile 默认用非 root 用户 node，但挂载卷权限在 host mount 下可能报权限问题。
    # 家庭内网部署用 root 运行最简单可靠。
    user: root
    ports:
      # 主程序端口：http://<NAS-IP>:xxx（自定义，默认 2626）
      - "xxx:8080"
      # 如需直连工具端口段（如 wb-credits 8123），取消注释：
      # - "8123:8123"
    environment:
      # 主程序端口（容器内 8080，镜像默认值，无需改）
      - PORT=8080
      # 管理员密码：首次访问网页时设置（存储为 sha256，不落明文）。
      # 不设环境变量也行——首次打开页面会弹窗引导设置。
      # - ADMIN_PASSWORD=${ADMIN_PASSWORD:-}
    # 关键：绕过路由器上的 Clash fake-ip DNS（198.18.x.x 假地址）。
    # 若 iStoreOS/OpenWrt 开了 fake-ip 模式，容器默认 DNS 会拿到假 IP，
    # 容器直连假 IP 必然超时（workbuddy 查询 8s 超时即此因）。
    dns:
      - 223.5.5.5
      - 119.29.29.29
    volumes:
      # 工具目录：挂载后可手动新增工具（tools/<id>/ + manifest.json/tool.json），
      # 也可用网页「+ 添加」在线创建。xxx = NAS 上的实际路径，如 /mnt/usb2/Configs/tools-center/tools
      - xxx:/app/tools
      # 运行时数据：管理员密码 hash、日志、备份等
      - xxx:/app/data
      # （可选）独立工具仓库直接挂载：工具代码保持独立 git 维护，平台以 app 型托管
      # xxx = 工具仓库在 NAS 上的路径，如 /mnt/usb2/Configs/workbuddy-credits-tool
      # ⚠️ 警告（v0.11.2 实测教训）：独立仓库作为嵌套挂载点挂到 /app/tools/<id>，
      #   平台无法删除挂载点目录（Docker 层锁定，EBUSY），且无 manifest 时会显示为"幽灵目录"，
      #   出现"删了又出现"的现象（需在宿主机删挂载源 + 改 compose 才能彻底清除）。
      #   更推荐的接入方式：把工具 clone 到宿主 tools 主目录下作为普通子目录
      #   （git clone ... /mnt/usb2/Configs/tools-center/tools/wb-credits），
      #   平台可正常管理（热更新、删除、备份）。
      # - xxx:/app/tools/wb-credits
    restart: unless-stopped
    # Dpanel "更新" = restart，不加 pull_policy 不拉新镜像
    pull_policy: always
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/api/tools').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
```

> **⚠️ 提示**：旧版示例里的 `init` 服务（构建时 clone wb-credits 内置到 tools/）**已废弃**——违反"工具独立仓库、独立部署"原则。正确做法：
> 1. 在 NAS 上 `git clone https://github.com/Simiely/workbuddy-credits-tool.git <路径>/wb-credits`
> 2. 在上方 compose 的 volumes 里挂载该路径到 `/app/tools/wb-credits`
> 3. 平台自动识别其 `tool.json`/`manifest.json` 并托管运行
> 或直接用网页「Git 导入」添加，无需改 compose。

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

### 平台自身升级（必须拉镜像）

```bash
cd /path/to/tools-center  # 或 NAS 共享目录
docker compose pull        # 拉取新镜像
docker compose up -d       # 重启（数据卷保留）
```

> **为什么不能"热更新"？** Docker 镜像层不可变，平台代码（`/app/lib`、`/app/public`）在构建时焊死，更新平台必须重拉镜像 + 重建容器（中断约 10-30 秒）。这是所有容器化应用的通用机制。
> **升级确认**：页面底部显示版本号（`Tools Center vX.Y.Z`，v0.11.1+），升级后版本号变化即确认生效。

### 工具升级（热更新，无需动容器）

工具代码在**挂载卷**（不在镜像内），改文件即生效：
- 网页「+ 添加」/ Git 导入 / 上传 zip → 平台自动重扫 + 重启工具进程
- 手动 `git pull` 到宿主 `tools/<id>/` 目录 → 刷新页面自动生效
- **工具代码独立维护的不受影响**

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