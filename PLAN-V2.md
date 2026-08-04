# Tools Center V2 · 重构规划

> 从"导航 + 子进程托管"重构为「**统一运行时 + 可插拔能力模块 + 声明式工具插件**」。
> 核心转变：**平台提供环境，工具声明需求**。
> 状态：规划草案（2026-08-04）· 待评审

---

## 一、背景与目标

### 现状（V1）的问题

| 问题 | 表现 |
|---|---|
| 环境能力弱 | 每个工具自带环境（Node 版本、浏览器、存储），平台只做托管，工具间无法共享 |
| 浏览器无法共享 | 积分工具要 Edge 加账号、购书工作台要 Edge 读 cookie，各搞一套（edge-daemon 重复/独立） |
| Windows 与 NAS 不一致 | wb-gui.mjs 在 Linux 容器因 `spawn cmd` 崩溃——环境差异导致的隐性 bug |
| 工具越加越杂 | 接入协议只有 cmd+port，无法表达"需要什么环境" |

### V2 目标

1. **整体环境搭建**：平台提供统一运行时（Node + 浏览器 + 存储 + 网络），工具开箱即用
2. **便捷加载工具**：声明式 manifest（runtime + capabilities），放目录即接入，平台自动装配环境
3. **模块化环境功能**：能力 = 可插拔模块，新环境 = 加一个模块，老工具无感
4. **一套代码双模式**：本机开发（真实 Edge）↔ Docker/NAS 生产（headless），工具无感

### 原则

- **轻量到底**：内核保持零第三方依赖（node: 内置模块）；能力模块按需启用
- **向后兼容**：V1 的 tool.json（app/link）继续有效，自动升级为 V2 manifest
- **渐进重构**：不推倒重来，先收内核、再抽能力、最后迁移工具
- **能力懒加载**：能力模块**按需启动**——工具调用时才拉起，空闲超时自动回收。模块本身轻量，临时启动开销可忽略；模块再多也不常驻占资源（长期演进的核心机制）

---

## 二、架构总览（三层 + 双模式）

```
┌─────────────────────────────────────────────┐
│ 工具层（插件）                                │
│  tools/<id>/manifest.json                     │
│  { runtime, capabilities, entry, port }      │
│  积分仪表盘 [browser+storage]                 │
│  购书工作台 [browser+storage]                 │
│  未来工具…（声明所需能力）                      │
├─────────────────────────────────────────────┤
│ 能力模块层（可插拔 Capabilities）               │
│  browser 浏览器桥（CDP 共享环境）               │
│  storage 存储（卷 + WebDAV）                  │
│  network 网络（DNS / 代理）                   │
│  scheduler 调度 · notify 通知（可选扩展）      │
├─────────────────────────────────────────────┤
│ 运行时内核（Runtime Core）                    │
│  工具发现 · manifest 解析 · 进程托管            │
│  反向代理 · 子路径挂载 · 日志 · 健康 · 端口     │
│  门户 UI（卡片/分类/手机适配）                  │
├─────────────────────────────────────────────┤
│ 运行环境（双模式）                            │
│  Dev：本机 Node 直跑 + 真实 Edge 登录态        │
│  Prod：Docker 容器 + headless Chromium       │
└─────────────────────────────────────────────┘
```

**核心机制**：manifest.capabilities → 平台装配对应能力模块 → 通过环境注入（env / 内部 API）提供给工具。工具只调用能力抽象层，不关心底层是 Edge 还是 headless、本机还是容器。

---

## 三、模块拆分

### 3.1 内核（runtime core）— `lib/core/`

| 模块 | 职责 |
|---|---|
| `discovery.js` | 扫描 tools/，解析 manifest（兼容 V1 tool.json） |
| `manager.js` | 进程托管（app 型）：spawn/退避/优雅停止/健康 |
| `proxy.js` | 反向代理 + `/tool/<id>` 子路径挂载 |
| `ports.js` | 端口段管理（8100-8199）与冲突检测 |
| `logger.js` | 日志聚合（按工具分文件） |
| `manifest.js` | manifest 规范解析、校验、V1→V2 迁移 |
| `capability.js` | 能力装配器：读 manifest.capabilities → 启动/注入对应模块 |

### 3.2 能力模块（capabilities）— `lib/capabilities/`

| 模块 | 能力 | 双模式实现 |
|---|---|---|
| `browser/` | CDP 浏览器桥（tabs/cmd/eval/cookie） | Dev: 真实 Edge（--remote-debugging-port=9222）；Prod: headless Chromium |
| `storage/` | 数据目录注入（`CAP_STORAGE_DIR`）+ WebDAV 同步 | 本机路径 / 挂载卷 |
| `network/` | DNS、代理配置注入 | 本机直连 / 容器 dns 配置 |
| `scheduler/`（可选） | cron 定时触发 | 同上 |
| `notify/`（可选） | 通知推送（邮件/Server酱） | 同上 |

**装配机制**：`capability.js` 读取 manifest.capabilities → 检查可用性 → **按需启动**（懒加载）：工具进程启动时只注入能力入口 env，不立即拉起模块进程；工具首次调用能力 API（SDK 发起）时平台检测到未启动 → 自动 spawn；空闲超时（默认 10 分钟）→ 自动停止回收。能力进程由内核 manager 托管（复用崩溃拉起/健康检查）。

### 3.3 工具接入（插件规范 V2）— `docs/spec.md`

```jsonc
// tools/<id>/manifest.json
{
  "id": "wb-credits",                    // [a-z0-9-]
  "name": "积分仪表盘",
  "icon": "💎", "group": "WorkBuddy",
  "runtime": "node22",                   // 需要的运行时
  "capabilities": ["browser", "storage"], // 需要的能力 → 平台装配
  "entry": "wb-gui.mjs",                 // 入口（相对目录）
  "port": 8123,                          // app 型监听端口
  "health": "/api/status",
  "env": { }                             // 附加环境变量（可选）
}
```

- **兼容**：V1 `tool.json`（type: app/link, cmd, port）自动映射为 V2 manifest，无 capabilities = 默认最小集
- **工具 SDK**：`lib/sdk.js` 提供给工具的可选封装（读能力 API、获取注入环境；SDK 负责"调用时触发懒加载"——首次请求自动拉起能力模块，工具无感）

### 3.4 双模式运行

| 模式 | 启动方式 | 环境 |
|---|---|---|
| Dev | `npm run dev`（本机 node server.mjs） | 真实 Edge 登录态、本机文件系统 |
| Prod | `docker compose up` | 容器 + headless Chromium、挂载卷 |

能力抽象层保证：工具代码 `if (process.env.CAP_BROWSER)` 或 SDK 调用，双模式无感切换。

---

## 四、里程碑（M0→M5）

### M0 · 内核收敛（重构第一步）
- [ ] 代码重组：`lib/core/` `lib/capabilities/` 分目录
- [ ] manifest 解析器（兼容 V1 tool.json 自动升级）
- [ ] capability 装配器骨架（空实现，后续填模块）
- [ ] 双模式启动脚本（dev.js / Dockerfile v2）
- **验收**：V1 工具（积分/购书）在 V2 内核下行为不变，`/tool/<id>` 反代正常

### M1 · 浏览器桥平台化（第一个能力模块）
- [ ] 把 edge-daemon 收敛为 `capabilities/browser` 模块
- [ ] 统一能力 API：tabs / cmd / eval / cookie（CDP 标准，双实现）
- [ ] 积分工具、购书工作台迁移到能力 API（去各自 daemon 依赖）
- **验收**：两个工具 manifest 声明 `browser`，加账号/读 cookie 走平台浏览器桥；容器内 headless 可替代

### M2 · 存储与数据
- [ ] `storage` 能力：数据目录注入 + WebDAV 同步（复用 wb-credits 的 webdav.js）
- [ ] 平台级备份/恢复（工具数据一键导出导入）
- **验收**：工具数据在挂载卷/WebDAV 双备份，换环境可恢复

### M3 · 工具接入体验
- [ ] 网页在线添加（Git 拉取 / zip 上传 / URL）
- [ ] 工具 SDK + 接入文档（docs/spec.md + 示例模板）
- [ ] manifest 在线校验（报错提示缺什么能力）
- **验收**：网页 3 分钟接入一个新工具（模板项目）

### M4 · 门户与体验
- [ ] 门户 UI v2（App Store 风格 + 能力徽标 + 手机适配）
- [ ] 工具运行状态可视化（健康/日志/资源）
- **验收**：手机/桌面都能清晰管理工具与能力

### M5 · NAS 部署与稳定性
- [ ] 群晖/NAS 部署指南（含浏览器桥 headless 配置）
- [ ] 崩溃告警、日志轮转、自动更新
- **验收**：NAS 上长期稳定运行，浏览器桥无宿主依赖

---

## 五、风险与决策

| 项 | 决策 | 说明 |
|---|---|---|
| 框架选型 | 零依赖内核（node: 内置） | 能力模块如需重依赖（如 headless Chromium 管理）可局部引入，不污染内核 |
| 模块资源占用 | **能力懒加载**（核心） | 模块按需启动 + 空闲回收，不常驻；模块轻量，临时启动开销可忽略 |
| 浏览器桥安全 | 凭证隔离 + 白名单 | 浏览器桥只对声明 browser 能力的工具开放；凭证仍存工具各自数据目录 |
| 兼容策略 | V1 tool.json 自动升级 | 老工具零改动迁移 |
| 与 PaaS 的关系 | 不自建完整 PaaS | 专注"统一环境 + 工具加载"，数据库/编排等重能力不内置（用 link 卡片接外部） |
| 演进路线 | 长期项目视角 | 短期遇到的接口/边界问题按"能力模块 + SDK + 规范"演进逐步解决，不一次性设计到完美 |

---

## 六、文档与仓库

- 本规划：`PLAN-V2.md`
- 架构细节：`DESIGN-V2.md`（M0 完成后细化）
- 插件规范：`docs/spec.md`（M3 前定稿）
- 迁移指南：`docs/migration-v1-v2.md`
