# Tools Center V2 · 里程碑细化规划

> 配合 [`PLAN-V2.md`](../PLAN-V2.md) 使用：整体规划见 PLAN-V2，本文件是每个里程碑的**可执行细化**（任务分解 → 技术要点 → 验收 → 风险）。
> 状态：草案（2026-08-04）· 待评审
> 依赖链：M0 → M1 → M2 → M3 → M4 → M5（M2/M3 可与 M1 部分并行）

---

## M0 · 内核收敛

> **目标**：把 V1 代码重组成"内核/能力/接入"三目录，manifest 解析兼容 V1 tool.json，能力装配器有骨架。**V1 工具零改动跑通。**

### 任务分解

- [ ] T0.1 代码重组为三目录：`lib/core/`（内核）、`lib/capabilities/`（能力）、`lib/`（对外公共）
- [ ] T0.2 新建 `lib/core/manifest.js`：manifest 解析 + 校验 + **V1 tool.json → V2 manifest 自动映射**
- [ ] T0.3 新建 `lib/core/capability.js`：能力装配器**懒加载骨架**（读 capabilities → 注册表查模块 → 工具启动只注入入口 env → 首次调用时才 spawn 模块进程 → 空闲超时回收）
- [ ] T0.4 新建 `lib/capabilities/index.js`：能力注册表（name → module），内置空壳 browser/storage/network（含懒加载状态：idle/running/recycling）
- [ ] T0.5 迁移现有 `registry.js / manager.js / proxy.js / logger.js / ports.js` 到 `lib/core/`（引用路径修正）
- [ ] T0.6 双模式启动：`dev.js`（本机）+ Dockerfile v2（容器，`.dockerignore` 排除能力内部件）
- [ ] T0.7 回归：积分工具（wb-credits）、购书工作台（weread-budget）在 V2 内核下行为不变

### 技术要点

- **V1→V2 映射规则**（manifest.js）：
  - `type:"app"` → `runtime:"node"`, `capabilities:[]`（默认空），entry = cmd 拼装
  - `type:"link"` → `capabilities:[]`, `entry:null`, `linkUrl=url`
  - 无 `capabilities` 字段 = 默认最小集（不含 browser）
- **能力注入约定**：装配器把能力入口写入工具进程 env：`CAP_<NAME>_PORT` / `CAP_<NAME>_DIR`（如 `CAP_BROWSER_PORT=8129`），SDK 读取
- **懒加载机制**（M0 骨架，M1 落地）：
  - 工具进程启动：只注入 env，**不 spawn 能力模块**
  - 工具首次调能力 API：SDK 请求 → 装配器检测 idle → spawn 模块 → 返回入口
  - 空闲回收：模块进程 idle 超过 `CAP_IDLE_TIMEOUT`（默认 600s）→ 优雅停止，状态回 idle
  - 能力进程由 manager 托管（复用崩溃拉起），`GET /api/capabilities` 暴露各模块状态（idle/running）
- **兼容保证**：V1 的 `tools/<id>/tool.json` 继续有效；manifest.js 优先读 `manifest.json`，无则读 `tool.json` 并映射
- 目录迁移用 git mv，保留历史

### 验收标准

- [x] `node server.mjs`（dev）下，wb-credits / weread-budget 反代、托管、健康全部正常
- [x] V1 tool.json 工具不写 manifest 也能被发现运行
- [x] `lib/core/` `lib/capabilities/` 结构清晰，无循环依赖

### 涉及文件

`server.mjs`（薄壳）、`lib/core/*`（7 模块）、`lib/capabilities/index.js`、`dev.js`、`Dockerfile`

### 风险

- 重构期间 V1 功能回归 → 用 T0.7 回归用例兜底
- 能力装配器过早复杂化 → 先空实现，M1 填 browser

---

## M1 · 浏览器桥平台化（第一个能力模块）

> **目标**：把 edge-daemon 收敛为平台能力 `capabilities/browser`，统一能力 API（tabs/cmd/eval/cookie），双实现（真实 Edge / headless Chromium）。**积分、购书工具迁移到能力 API，去掉各自 daemon 依赖。**

### 任务分解

- [ ] T1.1 从 credits-tool 提取 `edge-daemon.mjs` 逻辑 → `lib/capabilities/browser/`（服务端：CDP 连接 + HTTP API）
- [ ] T1.2 定义能力 API 契约（与现有 edge-daemon API 兼容）：`GET /status`、`GET /tabs`、`POST /cmd`（CDP 命令）、`POST /eval`（JS 求值）、`GET /cookie?host=`、`POST /navigate`
- [ ] T1.3 双实现：
  - Dev backend：连接本机 Edge（`--remote-debugging-port=9222`，非默认 user-data-dir）
  - Prod backend：headless Chromium（容器内，`--headless=new`）；无浏览器时返回 `daemon:"down"` 状态而非崩溃
- [ ] T1.4 能力装配：工具 manifest 声明 `"capabilities":["browser"]` → 平台启动 browser 模块，注入 `CAP_BROWSER_PORT`
- [ ] T1.5 工具 SDK：`lib/sdk.js` 导出 `capBrowser()`（封装 tabs/cmd/eval/cookie 调用，读 env 自动定位）
- [ ] T1.6 迁移 credits-tool：`lib/cookies.js / lib/daemon.js` 改用 `capBrowser()`（保留对旧端口 env 的兼容降级）
- [ ] T1.7 迁移 weread-budget：cookie 检测走 `capBrowser()`（替换直连 8129）
- [ ] T1.8 文档：`docs/capabilities/browser.md`（API 契约 + 双模式说明 + 安全边界）

### 技术要点

- **CDP 发现**：保持 CDP 标准（`/json/version` 取 webSocketDebuggerUrl），不读 DevToolsActivePort（旧坑）
- **headless 方案**：容器内可选用 `puppeteer` 内置 Chromium 或系统安装 chromium（M1 先系统包，M5 再优化体积）；能力模块允许引入依赖（不污染内核）
- **凭证安全**：cookie 读取按 host 过滤 + 仅工具自身数据目录可写；浏览器桥只对声明 browser 能力的工具开放（装配器校验）
- **降级**：browser 不可用（无 Edge/无 headless）→ 工具健康仍 ok，`daemon:"down"`，GUI 提示"添加账号不可用"（复用 credits-tool 已有交互）

### 验收标准

- [ ] 积分工具：manifest 声明 browser → 本机加账号全流程可用；容器内 headless 查询正常
- [ ] 购书工作台：cookie 检测/刷新走能力桥，行为与直连 8129 一致
- [ ] 能力 API 文档与实现一致，双 backend 可切换（env 控制）

### 涉及文件

`lib/capabilities/browser/*`、`lib/core/capability.js`（填实现）、`lib/sdk.js`、credits-tool 的 `lib/cookies.js/lib/daemon.js`、weread-budget 的 cookie 逻辑

### 风险

- headless Chromium 在容器内的依赖/体积 → M1 允许系统包，标记优化项
- 迁移时工具行为差异 → 保持 API 契约与旧 edge-daemon 一致，逐工具验证

---

## M2 · 存储与数据

> **目标**：`storage` 能力（数据目录注入 + WebDAV 同步），平台级备份/恢复。**工具数据可迁移。**

### 任务分解

- [ ] T2.1 `lib/capabilities/storage/`：数据目录分配（工具默认 `data/<toolId>/`，注入 `CAP_STORAGE_DIR`）
- [ ] T2.2 WebDAV 同步能力（复用 credits-tool 的 `lib/webdav.js` 逻辑，平台级配置）：上传/下载/测试
- [ ] T2.3 平台 API：`GET /api/backup`（导出所有工具数据 zip）、`POST /api/restore`（导入）、`GET /api/tools/<id>/data`（单工具）
- [ ] T2.4 备份清单：工具 manifest 可选 `data:["*.json","config/*"]` 声明要备份的数据（默认全部非 gitignore 文件）
- [ ] T2.5 门户 UI：工具卡片加"备份/恢复/WebDAV 同步"入口

### 技术要点

- **目录约定**：`data/<toolId>/` 挂载卷（容器）或本机目录（dev），工具经 `CAP_STORAGE_DIR` 读写，**不写自己的 cwd**（解决"代码与数据混在一起"）
- **备份格式**：zip，含 manifest 快照 + 数据文件 + 版本号；恢复时按 manifest 校验工具存在
- **WebDAV**：平台级一份配置（credits-tool 的 wb-sync.json 格式扩展），多工具共享备份目标

### 验收标准

- [ ] 工具只认 `CAP_STORAGE_DIR` 即可持久化（积分/购书迁移验证）
- [ ] 备份 → 换目录/换容器 → 恢复，数据完整
- [ ] WebDAV 上传下载回归通过

### 涉及文件

`lib/capabilities/storage/*`、`lib/core/backup.js`、`server.mjs`（新 API）、门户 UI、credits-tool `lib/webdav.js`（复用）

### 风险

- 工具旧数据在 cwd → 迁移脚本（T2.1 提供 `data/` 迁移工具）
- 凭证文件误备份 → 备份 zip 加密码/标记敏感项（默认排除已知凭证模式）

---

## M3 · 工具接入体验

> **目标**：网页在线添加工具（Git/zip/URL）、工具 SDK + 模板、manifest 在线校验。**3 分钟接入一个新工具。**

### 任务分解

- [ ] T3.1 在线添加 API：`POST /api/tools/import`（zip 上传）/ `POST /api/tools/from-git`（仓库 URL）/ `POST /api/tools/from-url`（单文件）
- [ ] T3.2 前端"＋ 添加"向导：步骤化（选来源 → 填信息 → 预览 manifest → 确认）
- [ ] T3.3 manifest 在线校验：缺能力/端口冲突/语法错 → 明确报错（"缺少 browser 能力，平台已装配"或"端口 8123 已被占用"）
- [ ] T3.4 工具模板项目 `templates/tool-node/`：最小 Node 工具（读 CAP_STORAGE_DIR + 健康接口），一键生成
- [ ] T3.5 工具 SDK 文档 `docs/spec.md`：manifest 全字段、能力 API、双模式、示例
- [ ] T3.6 移除/禁用工具流程（门户上可停用，数据保留可恢复）

### 技术要点

- **zip 导入安全**：解压到临时目录 → 校验 manifest → 限制大小/解压比（zip 炸弹防护）→ 原子移入 `tools/<id>/`
- **from-git**：`git clone --depth 1` 到 `tools/<id>/`，记录 source 供后续 `git pull` 更新（门户"更新工具"按钮）
- **模板**：manifest + server.mjs（~60 行最小服务）+ 读 env 示例

### 验收标准

- [ ] 向导 3 分钟内完成一个新工具接入（模板项目验证）
- [ ] 错误提示能定位到具体缺失项（能力/端口/语法）
- [ ] Git 接入的工具可一键更新

### 涉及文件

`server.mjs`（import API）、前端向导组件、`templates/tool-node/`、`docs/spec.md`

### 风险

- zip/URL 导入安全 → 严格校验 + 沙箱临时目录
- Git 拉取在容器内网络 → 复用 compose 的 dns 配置

---

## M4 · 门户与体验

> **目标**：门户 UI v2（App Store 风格 + 能力徽标 + 手机适配），工具运行状态可视化。

### 任务分解

- [ ] T4.1 首页改版：卡片显示能力徽标（browser/storage 等小图标）、健康状态色、最近活动
- [ ] T4.2 工具详情页：日志查看（滚动）、重启/停止按钮、端口/数据位置展示
- [ ] T4.3 分类与搜索：按能力筛选（"需要浏览器的工具"）、关键字搜索
- [ ] T4.4 手机适配完善（复用 weread-budget 的手机端经验：基础自适应方案）
- [ ] T4.5 深色/浅色主题切换（跟随系统 + 手动）

### 技术要点

- 前端保持原生 HTML/CSS/JS（零框架），组件化拆分（卡片/徽标/日志面板）
- 日志实时：`GET /api/tools/<id>/logs?tail=N` 轮询或 SSE（先用轮询，简单可靠）
- 状态数据：`/api/tools` 已含 status/health，扩展 error 明细

### 验收标准

- [ ] 手机/桌面均可用（基础自适应验收同 weread-budget）
- [ ] 工具详情页可看日志、重启、停用
- [ ] 按能力筛选/搜索可用

### 涉及文件

`public/`（index.html/css/js 拆分）、`server.mjs`（日志/详情 API）

### 风险

- 前端规模增长 → 组件化 + 不引框架（保持轻量）
- 手机端复杂度 → 沿用已验证的基础自适应（不做 TabBar 重设计）

---

## M5 · NAS 部署与稳定性

> **目标**：群晖/NAS 一键部署（含 headless 浏览器桥），长期稳定运行（告警/日志轮转/更新）。

### 任务分解

- [ ] T5.1 compose v2：browser 能力容器（headless Chromium 独立镜像或 sidecar）、storage 卷、dns 配置
- [ ] T5.2 群晖部署指南 `docs/nas-deploy.md`（Container Manager 步骤，复用 V1 文档结构）
- [ ] T5.3 稳定性：崩溃告警（通知能力 notify 接线：Server酱/邮件/群晖通知）、日志轮转（大小/天数）
- [ ] T5.4 自动更新：`pull_policy: always` + 工具 git pull 一键（T3.2 已有按钮）
- [ ] T5.5 资源瘦身：镜像多阶段构建、headless Chromium 精简、可选关闭未用能力

### 技术要点

- **headless sidecar**：browser 能力独立容器（`cap-browser`），主容器经内部网络访问 `CAP_BROWSER_PORT`，避免主镜像臃肿
- **告警**：健康检查失败 N 次 → notify 模块推送；平台崩溃 → Docker restart 策略兜底
- **数据**：storage 卷 + WebDAV 双保险（M2 已实现）

### 验收标准

- [ ] 群晖/任意 NAS 按指南 10 分钟内跑起来
- [ ] 工具崩溃自动拉起 + 通知；日志不无限增长
- [ ] 无浏览器场景（headless down）工具仍可用（查询类），仅浏览器相关功能降级提示

### 涉及文件

`docker-compose.yml`（v2）、`Dockerfile`（多阶段）、`docs/nas-deploy.md`、`lib/capabilities/notify/`

### 风险

- NAS 无 Chromium 依赖库 → headless 镜像单独维护，主镜像不受影响
- 资源占用（内存）→ 能力懒加载兜底：模块 idle 即回收，未用不跑；门户可查看各能力实时状态

---

## 附录 · 里程碑依赖与并行

```
M0 ──► M1 ──► M2 ──► M3 ──► M4 ──► M5
        │      └────────► M3（部分并行）
        └────► M2（部分并行）
```

- 关键路径：M0 → M1 → M2 → M3 → M4 → M5
- M2/M3 可在 M1 后并行推进（不同文件域）
- 每里程碑完成 = 上线可用，不阻塞后续

## 附录 · 演进路线（长期项目视角）

> 本平台按**长远大项目**规划：短期未定/遇到的小问题，按下面的演进路线随版本逐步解决，不做一次性完美设计。**已定基调：能力模块懒加载（有工具调用才启用，空闲回收）**——模块再多也不常驻占资源，临时启动开销可忽略。

| # | 议题 | 演进方向 |
|---|---|---|
| 1 | 能力模块是否允许第三方依赖 | 允许（不入内核）；如 headless Chromium 管理用独立能力容器 |
| 2 | browser 安全边界细节 | 随使用场景逐步收紧：先 host 过滤 → 再凭证加密 → 再白名单策略 |
| 3 | 工具 SDK 是否独立成包 | 先内建 `lib/sdk.js`；工具数增长后拆 `@simiely/tools-center-sdk` 独立发布 |
| 4 | 新能力（数据库/调度/通知） | 按工具需求逐个加入能力仓库，一次开发全局复用；均走懒加载 |
| 5 | 性能与资源 | 懒加载兜底 + 门户展示各能力模块实时状态（idle/running）；模块优化按需做 |
