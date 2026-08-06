# Tools Center 架构文档

当前实现的结构化梳理（基于 v0.8.x 内核）。本文档聚焦**代码主线**：主逻辑四条链路 + 支线五个辅助面 + 数据流 + 模块职责表。

---

## 1. 总览

```
┌─────────────────────────────────────────────────────────┐
│                    server.mjs (入口薄层)                  │
│         路由分发 · 组装模块 · 启动序列 · upgrade 事件        │
└──────────────┬──────────────────────┬───────────────────┘
               │                      │
   ┌───────────▼──────────┐  ┌────────▼───────────────┐
   │  lib/core/ 内核层     │  │  lib/capabilities/     │
   │  (12 模块,零依赖)      │  │  能力层(可插拔,懒加载)    │
   └───────────┬──────────┘  └────────┬───────────────┘
               │                      │
   ┌───────────▼──────────────────────▼───────────────┐
   │  tools/ 工具目录(挂载卷,声明式接入)                 │
   │  manifest.json → 平台托管 → 反代 /tool/<id>/        │
   └─────────────────────────────────────────────────┘
```

**核心设计原则**：
- **分层单向依赖**：入口 → 内核 → 能力 → 工具（内核层不依赖能力层）
- **声明式接入**：工具只声明需求（manifest），平台负责装配环境
- **能力懒加载**：工具调用时才启动能力模块，空闲 600s 回收
- **零依赖内核**：只用 Node 内置模块，可移植（本机/Docker/NAS）

---

## 2. 主逻辑 · 四条链路

### ① 启动链路（server.mjs 启动序列）

```
initCapabilities()  ① 注册能力模块(browser/storage/network)
      ↓
scanTools()         ② 扫描 tools/ 目录 → 构建注册表 Map
      ↓
manager.startAll()  ③ 启动所有有效 app 型工具进程
      ↓
startHealthLoop()   ④ 30s 轮询健康检查(声明的 /health)
      ↓
server.listen()     ⑤ 监听端口(命令行参数或 PORT)
      ↓
server.on("upgrade") ⑥ WebSocket 升级反代(/tool/<id>/)
```

**顺序依赖**：先注册能力（工具扫描时的 checkCapabilities 依赖能力注册表），再扫描工具，再启动。

### ② 工具生命周期

```
放置目录(manifest.json/tool.json)
      ↓
scanTools(): loadManifest → normalizeManifest(V1自动映射V2)
      ↓
validate(): id/name/端口段/runtime/能力白名单
      ↓
manager.start(): spawn(工具进程,注入能力 env)
      ↓
健康检查: GET /health → ok/down
      ↓
崩溃 → 退避重启(1s,2s,4s...封顶30s,连续5次停止)
      ↓
删除/重扫 → 优雅停止(SIGTERM→5s→SIGKILL)
```

**关键文件**：`registry.js`（发现/校验/增删）+ `manager.js`（进程托管）+ `manifest.js`（声明解析）。

### ③ 能力生命周期（懒加载）

```
工具 manifest 声明 capabilities: ["browser"]
      ↓
装配器注入 env(CAP_* 占位,不启动)
      ↓
工具 SDK 首次调用 capBrowser()
      ↓
POST /api/capabilities/browser/ensure
      ↓
状态机: idle → starting → running
      ↓
空闲 600s → recycling → idle(回收)
```

**状态机**（`capabilities/index.js`）：`idle → starting → running → recycling → idle`，异常 `→ error`。

### ④ 请求链路

```
浏览器 → /tool/<id>/xxx (平台 8080)
      ↓
proxy.js: 查找工具 → app:反向代理到工具端口 / link:302跳转
      ↓
HTML 响应注入 __BASE__ = /tool/<id>(子路径挂载)
      ↓
工具内 JS 用 __BASE__ + "/api/.." 访问自身接口
```

**WebSocket**：`upgrade` 事件 → `proxyUpgrade()` 双向转发（工具可实时推送）。

---

## 3. 支线 · 五个辅助面

| 辅助面 | 模块 | 功能 |
|---|---|---|
| **接入面** | `upload.js` `git.js` `registry.js` | 网页表单/zip 上传(含解压炸弹防护)/Git 导入/manifest 在线校验 |
| **存储面** | `backup.js` `webdav.js` | CAP_STORAGE_DIR 注入、本地备份(含快照)、WebDAV 同步/恢复 |
| **管理面** | `auth.js` `logger.js` `manager.js` | 管理员密码(sha256)、滚动日志、重启/删除工具 |
| **门户面** | `public/index.html` | 卡片/详情弹层/能力徽标/筛选 Tab/能力状态(单文件零框架) |
| **工具侧** | `lib/sdk.js` `templates/` | 工具 SDK(capBrowser/capStorageDir)、接入模板 |

---

## 4. 模块职责表

### lib/core/（内核层，15 模块）

| 模块 | 行数 | 职责 | 依赖 |
|---|---|---|---|
| `config.js` | 37 | 常量 + 路径 + 能力白名单（单一来源） | 无 |
| `auth.js` | 47 | 管理员密码（sha256 摘要,空密码=无密码状态） | config |
| `lifecycle.js` | 57 | 生命周期状态:removedSet(已解除托管)/pausedSet(已暂停)持久化 | config |
| `upload.js` | 98 | multipart 解析 / zip 解压(炸弹防护) / 路径校验 | config |
| `git.js` | 76 | Git 仓库导入(浅克隆+工具识别+冲突防护) | config |
| `manifest.js` | 70 | 声明解析：V1 tool.json 自动映射 V2 manifest | config |
| `registry.js` | 256 | 注册表：扫描/校验/创建/删除（状态已迁 lifecycle） | manifest, capability, lifecycle |
| `manager.js` | 167 | 进程托管：spawn/退避重启/优雅停止/健康检查 + 暂停联动 | config, registry, logger |
| `proxy.js` | 111 | 反向代理 + link 302 + WebSocket 升级 + __BASE__ 注入 | config, registry |
| `logger.js` | 85 | 工具日志：文件滚动 + 内存环形缓冲 + detachLog 释放 | config |
| `disk-ops.js` | 105 | 存储管理：磁盘扫描分类(含挂载点识别)/物理清理(失败保留标记+错误透传)/恢复托管/先停进程再删 | config, registry, lifecycle, manager |
| `backup.js` | 144 | 本地备份/恢复 + WebDAV 上传下载 | registry, webdav |
| `webdav.js` | 66 | WebDAV 协议客户端（MKCOL/PUT/GET） | config |
| `capability.js` | 52 | 能力装配器：env 注入 / 校验 / ensure 触发 | capabilities |
| `zip.js` | 193 | 零依赖 zip 打包/解包(CRC 校验 + 防 zip-slip) | config |

### lib/capabilities/（能力层）

| 模块 | 职责 |
|---|---|
| `index.js` | 注册表 + 懒加载基座（状态机） |
| `browser/` | 浏览器桥：CDP 代理（dev 真实 Edge / headless Chromium 双后端） |
| `storage/` | 存储能力：数据目录（无进程） |

### 其他

| 文件 | 职责 |
|---|---|
| `lib/routes/` | 路由注册表(按域拆分,v0.11.0):`index.js`(合并+matchRoute) + `helpers.js`(共享工具) + `tools-proxy`(反代)/`tools-crud`(增删查)/`tools-files`(日志+上传)/`tools-prefix`(单工具控制)/`backup`/`webdav`/`admin`(密码)/`disk`(存储)/`cap`(能力+静态) |
| `lib/sdk.js` | 工具侧 SDK（capBrowser/capStorageDir，懒加载封装） |
| `public/` | 门户 UI(零框架):`index.html` + `js/{api,ui,cards,detail,disk,app}.js`(六文件,v0.11) |
| `server.mjs` | 入口薄层(43 行):启动序列 + createServer + upgrade + listen |
| `templates/tool-template/` | 最小可运行工具模板 |

> 路由扩展约定(v0.11.0):新增 API 按域加 `lib/routes/<域>.js` 导出路由数组,`index.js` 一行 `...<域>Routes` 接入,不碰其他文件。

---

## 5. 数据流

### 工具数据目录（存储能力）

```
tools/<id>/            ← 代码 + manifest(挂载卷)
data/tools/<id>/       ← 工具数据(CAP_STORAGE_DIR 指向这里,备份边界)
data/backups/<ts>/     ← 本地备份(含 _manifest.json 快照)
data/logs/<id>.log     ← 滚动日志(按天,保留7天)
data/admin-pass.json   ← 管理员密码摘要(不存在 = 无密码)
data/removed-tools.json← 已解除托管工具 id(扫描跳过,物理目录保留)
data/paused-tools.json ← 已暂停工具 id(不自动启动/拉起)
data/webdav.json       ← WebDAV 配置
```

### 能力注入环境变量

| 变量 | 能力 | 说明 |
|---|---|---|
| `CAP_STORAGE_DIR` | storage | 工具专属数据目录 |
| `CAP_BROWSER_BASE` | browser | 浏览器桥基址（SDK ensure 后获取） |
| `CAP_ENSURE_EP` | 全部 | 懒加载触发端点（平台 API） |

---

## 6. API 一览

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /api/tools | 工具列表（500ms 节流重扫） |
| POST | /api/tools | 创建工具（app/link/V2 manifest） |
| DELETE | /api/tools | 删除工具（需管理员密码,幽灵幂等删除返回 ghost:true） |
| POST | /api/tools/validate | manifest 在线校验（不写盘） |
| POST | /api/tools/import | Git 导入 |
| POST | /api/tools/restore | 恢复已解除托管的工具 |
| GET | /api/tools/<id> | 单工具查询（删除前探测,404 = 幽灵） |
| POST | /api/tools/<id>/restart | 重启工具 |
| POST | /api/tools/<id>/pause \| /resume | 暂停/恢复工具（持久化） |
| GET | /api/capabilities | 能力状态（含 error） |
| POST | /api/capabilities/<name>/ensure | 懒加载触发 |
| GET | /api/logs/<id> | 工具日志（最近 200 行） |
| POST | /api/backup · /api/restore | 本地备份/恢复 |
| GET/POST | /api/webdav[/test/upload/download] | WebDAV 配置与同步 |
| GET/POST | /api/admin/pass | 管理员密码(空 = 清除) |
| GET | /api/admin/disk | 存储管理:磁盘残留清单(四类分类) |
| POST | /api/admin/disk/clean | 清理残留目录(需密码,托管中先停进程) |
| POST | /api/admin/disk/restore | 恢复托管 |
| POST | /api/files | 文件/zip 上传 |
| GET | /tool/<id>/... | 工具反代入口 |

---

## 7. 开发指南

### 新增工具（工具作者）

```json
// tools/my-tool/manifest.json
{
  "id": "my-tool",
  "name": "我的工具",
  "runtime": "node",
  "capabilities": ["storage"],
  "entry": "server.mjs",
  "port": 8150,
  "health": "/health"
}
```

- 数据写 `CAP_STORAGE_DIR`，不要写在代码目录
- 端口用 `process.argv[2]` 读取
- 需要浏览器能力：声明 `"capabilities": ["browser"]`，SDK `capBrowser()`
- 三种接入方式：网页表单 / zip 上传 / Git 导入（详见 `docs/sdk.md`、`templates/tool-template/`）

### 新增能力（平台作者）

1. 建 `lib/capabilities/<name>/index.js`，实现 `createCapabilityBase(name, {start, stop})`
2. `lib/capabilities/index.js` 的 `initCapabilities()` 注册
3. `config.js` 的 `KNOWN_CAPABILITIES` 加白名单
4. `lib/core/capability.js` 的 `capabilityEnv()` 加注入逻辑
5. `public/index.html` 的 `capLabel()` 加显示

### 新增 API（平台作者）

在 `lib/routes/` 按域加路由(见上「路由扩展约定」):新建 `<域>.js` 导出路由数组 → `index.js` 合并 → 业务逻辑下沉到 `lib/core/` 模块。

---

## 8. 测试与质量

```bash
npm test          # 单元测试(node --test,50 用例;串行防 Windows DLL 偶发)
npm run check     # 全模块语法检查(39 文件,scripts/check.mjs 跨平台)
```

CI（`.github/workflows/docker-build.yml`）：
- `lint` job：push 自动语法检查（后端全模块 + 前端内联 JS）
- `build` job：构建并推送 `ghcr.io/simiely/tools-center:main`

---

## 9. 部署速查

| 场景 | 方式 | 入口 |
|---|---|---|
| 开发 | `node server.mjs` | http://127.0.0.1:8080 |
| Docker | `docker compose up` | http://localhost:2626 |
| NAS/路由 | 见 `docs/deploy-nas.md` | http://<IP>:2626 |

**注意**：挂载卷写权限问题——Dockerfile 默认 `USER node`，但宿主挂载卷在 Windows/NAS 下常需 `user: root`（compose 已配置）。
