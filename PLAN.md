# 工具中心 · 完整开发与部署规划

> 基于 `DESIGN.md`(模块化架构)与两轮调研(微信读书 API / NAS 部署)形成的**可执行路线图**。
> 目标:3~4 周内,在你的 NAS 上跑起"统一入口 + 进程托管"的工具中心,首批接入 3 个真实工具。

---

## 一、项目总览

| 项 | 内容 |
|---|---|
| 平台 | **tools-center**:Node 零依赖,单容器,`lib/` 五模块(registry/manager/proxy/logger/config) |
| 宿主 | 你的 NAS(群晖 Container Manager,Docker Compose 部署) |
| 接入契约 | 工具 = 监听一个 HTTP 端口 + 一份 `tool.json`(`type: app\|link`) |
| 首个入口 | `http://NAS-IP:8080`(首页)→ `/tool/<id>` 直达 |
| 远程访问 | Tailscale(推荐,不暴露公网端口) |

### 首批工具矩阵

| 工具 | 类型 | 来源 | 优先级 | 说明 |
|---|---|---|---|---|
| 积分仪表盘 | `app` | 已有(`workbuddy-credits-tool` 仓库) | P0 | 零改造接入,验证框架 |
| 微信读书购书工作台 | `app` | 扩展改造(`weread-budget-extension`) | P0 | 去浏览器化,服务化 |
| 服务器监控面板 | `app` | 新写(~200 行) | P1 | 复用"采集+折线"已验证技术 |
| NAS 现有服务(Jellyfin/网盘等) | `link` | 现有容器 | P1 | 纯导航卡片,零代码 |

---

## 二、里程碑总览

| 里程碑 | 内容 | 关键产出 | 估时 |
|---|---|---|---|
| **M0 初始化** | 仓库、骨架、规范文档 | `tools-center/` 仓库 + 单项目规范 4 件套骨架 | 0.5 天 |
| **M1 平台骨架** | lib 五模块 + 首页 + tool.json 扫描(含 link 型) | 平台可跑:首页出卡片、托管/跳转可用 | 1.5~2 天 |
| **M2 接入积分工具** | app 型首次实战 + 数据卷规划 | `/tool/wb-credits` 可用,凭证持久化 | 0.5 天 |
| **M3 微信读书服务化** | 扩展 → Node 服务(去浏览器化) | `/tool/weread-budget` 购书工作台可用 | 1.5~2 天 |
| **M4 NAS 部署上线** | 群晖部署 + Tailscale + 文档 | NAS 常驻可用,重启自愈 | 0.5~1 天 |
| **M5 增强(可选)** | 认证 / WebSocket 代理 / 内嵌 / 更多工具 | 平台进化 | 按需 |

**总计 ≈ 4.5~6 个工作日**。

---

## 三、分阶段任务分解

### M0 初始化(0.5 天)

| # | 任务 | 产出 | 验收 |
|---|---|---|---|
| 1 | 建 `Simiely/tools-center` 仓库(public) | GitHub 仓库 | 可 clone |
| 2 | 初始化目录(server.mjs/lib/public/tools/data/docs)+ `package.json`(仅 `{"type":"module"}`) | 骨架目录 | 结构符合 DESIGN.md |
| 3 | 写单项目规范 4 件套(README/AGENTS/DEVELOPMENT/CHANGELOG 首版) | 规范文档 | 可发布 |
| 4 | `.gitignore`(排除 tools/ 下凭证、data/ 日志) | 安全基线 | 敏感文件不入库 |

### M1 平台骨架(1.5~2 天)

| # | 任务 | 关键点 | 验收 |
|---|---|---|---|
| 1 | `lib/config.js` | 端口 8080、工具段 8100-8199、健康间隔 30s、日志保留 7 天 | 常量集中 |
| 2 | `lib/registry.js` | 扫描 `tools/*/tool.json`;校验 id/type/url/cmd/port;端口冲突检测;`reload` | 加/删 tool.json → reload 生效 |
| 3 | `lib/manager.js` | spawn、崩溃自动拉起(指数退避 1s→30s 封顶)、SIGTERM→5s→SIGKILL、健康轮询;**仅 app 型** | 杀子进程 → 自动拉起;健康状态正确 |
| 4 | `lib/proxy.js` | 零依赖转发(流式/超时 60s);link 型 302;WebSocket 升级**预留接口** | 代理正常;`/tool/link` 302 |
| 5 | `lib/logger.js` | stdout/stderr → 文件按天滚动 + 内存 200 行 | `/api/logs/<id>` 可取 |
| 6 | `server.mjs` + `public/index.html` | 路由分发 + 首页卡片网格(深色粉红、状态点、30s 轮询、link 标记) | 首页正确渲染 |
| 7 | 自测:mock 一个假工具(app)+ 一个 link | 全链路 | 见验收标准 |

### M2 接入积分仪表盘(0.5 天)

| # | 任务 | 关键点 | 验收 |
|---|---|---|---|
| 1 | `tools/wb-credits/` 放入代码 + `tool.json`(`app`,`port:8123`) | 从 `workbuddy-credits-tool` 仓库拷贝/挂载 | 卡片出现 |
| 2 | 数据卷规划:`wb-accounts.json` 等移到 `data/tools/wb-credits/` | `tool.json` 注入 `TOOLS_DATA`,程序读取路径小改 | 换容器不丢凭证 |
| 3 | edge-daemon 处理(添加账号辅助进程) | 初期手动启;M5 考虑 `sidecars` 多命令 | 文档说明 |
| 4 | 端到端验证:首页 → `/tool/wb-credits` → 刷新/明细 | 与直跑行为一致 | 全功能可用 |

### M3 微信读书购书工作台服务化(1.5~2 天)

依据调研确认:**官方 Agent 网关** `POST https://i.weread.qq.com/api/agent/gateway`(`Bearer wrk-xxx`,body 平铺参数 + `skill_version`;`/_list` 查接口清单;Key 长期有效、绑定 vid)。扩展 `background/lib/gateway.js` 已是该协议 → **Node 原生 fetch 直调,零依赖**。

| # | 任务 | 关键点 | 验收 |
|---|---|---|---|
| 1 | 建 `Simiely/weread-budget-server` 仓库(public) | 服务版独立仓库;核心 lib 与扩展仓库共享(拷贝 + 文档约定同步) | 可 clone |
| 2 | 搬运 `background/lib/`(books/price/query/calc/config/errors)→ `lib/` | 纯 JS 直接复用 | 模块可 import |
| 3 | 写 Node 壳 `server.mjs`(~100 行):静态页 + `/api/*` 路由 + 网关转发 | `chrome.storage` → `data/config.json` 存 Key | 接口通 |
| 4 | 前端:`shelf.html` + `shelf/lib/*` → `public/` | 删掉扩展相关(apikey.js 改读服务端配置) | 工作台 UI 可用 |
| 5 | `tool.json`(`app`,`port:8126`)+ 数据卷(`data/config.json`) | 与积分工具同模式 | 卡片出现、可用 |
| 6 | 端到端验证:导入书架/筛选/组合计算 | 与扩展行为一致 | 全功能 |

### M4 NAS 部署上线(0.5~1 天)

| # | 任务 | 关键点(调研结论) | 验收 |
|---|---|---|---|
| 1 | Dockerfile(`node:22-slim`)+ compose | `restart: unless-stopped`;端口映射 `8080:8080` | 一条命令起 |
| 2 | 群晖部署:Container Manager → 项目 → compose | 目录惯例 `/volume1/docker/tools-center/{tools,data}`;**先建目录再起容器** | 启动成功 |
| 3 | 权限:设 `PUID/PGID` + `TZ=Asia/Shanghai` | 容器非 root 运行,避免 File Station 权限错 | 日志无 EACCES |
| 4 | Tailscale 组网 | 远程 `100.x.x.x:8080` 访问;不暴露公网 | 手机/外网可达 |
| 5 | 文档收尾:README(部署步骤)+ CHANGELOG | 单项目规范更新 | 可读可用 |

### M5 增强(可选,按需排期)

- 简单认证(`AUTH_TOKEN`,首页与 `/api/*` 拦截)
- WebSocket 代理(工具 HMR 等需要时)
- `sidecars` 多命令(edge-daemon 纳入托管)
- 工具内嵌(iframe 兼容处理)
- 服务器监控面板等新工具持续接入

---

## 四、技术关键点与风险

| 项 | 说明 | 对策 |
|---|---|---|
| **零依赖反代** | 手写 `req.pipe→proxyRes.pipe`;WebSocket 升级暂缓 | 先透传 HTTP;WS 留接口 M5 补 |
| **子进程托管稳定性** | 崩溃拉起要防"崩溃风暴" | 指数退避 + 连续失败标记 error,首页红点 |
| **微信读书 API 稳定性** | 内部接口,字段可能调整 | `/_list` 可自查;有 `skill_version` 机制;Key 长期有效但可能重置 → 配置页提示 |
| **NAS 权限坑** | 容器 root 写卷 → File Station 权限错 | PUID/PGID 显式映射(调研确认的标准做法) |
| **端口冲突** | DSM 占用 80/443/5000/5001;服务多 | 工具中心 8080;工具段 8100+;compose 前 `netstat` 排查 |
| **数据安全** | 凭证/Key 在挂载卷,镜像升级不丢 | `tools/`、`data/` 全部挂载卷;容器无状态 |

---

## 五、仓库与发布策略

| 仓库 | 用途 | 状态 |
|---|---|---|
| `Simiely/tools-center` | 平台本体(单项目规范 4 件套) | 新建 |
| `Simiely/workbuddy-credits-tool` | 积分工具(**已有**,文档已齐) | ✅ 已有 |
| `Simiely/weread-budget-server` | 微信读书服务版(独立仓库) | 新建 |
| `Simiely/weread-budget-extension` | 扩展原仓库(保留,并行) | ✅ 已有 |

> 工具接入方式:工具中心 `tools/` 是挂载卷;部署时从各工具仓库拉取/拷贝代码进去。平台与工具解耦——平台升级不影响工具,工具升级不影响平台。

---

## 六、验收标准(汇总)

- **M1**:`tools/` 下放一个假 app + 一个 link → 首页两张卡;杀掉假 app 进程 → 5s 内自动拉起;`/tool/link` 302 跳转。
- **M2**:`/tool/wb-credits` 全功能可用;删除容器重建后凭证仍在。
- **M3**:`/tool/weread-budget` 的导入书架/筛选/最优组合计算可用;Key 存于挂载卷。
- **M4**:群晖重启后容器自愈;外网经 Tailscale 可达;`docker compose down && up` 数据不丢。

---

## 七、建议执行顺序(下一步)

1. 先做 **M1**(平台能跑),它是一切的基础——用假工具验证框架后,再接入真实工具
2. M2 紧接着做(半天),让积分工具先在 NAS 上跑起来,形成正反馈
3. M3 weread 服务化单独推进(工作量最大,独立成块)
4. M4 部署上线可与 M2/M3 并行准备

> 是否需要现在就开始 M0+M1?(平台骨架 + 假工具自测,当天可见"首页出卡片"效果)
