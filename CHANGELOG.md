# CHANGELOG.md

> 版本变更记录。按版本分节,不拆分。

## v0.4.0 (2026-08-03) · 自助接入 + Docker 化

**程序完整化:用户可以自己在线添加/删除工具,并可容器化部署。**

### 新增
- **工具管理 API**:`POST /api/tools`(在线创建,校验+建目录+写 tool.json+启用)、`DELETE /api/tools/<id>`(停进程+删目录)
- **首页在线添加**:「＋ 添加工具」弹窗表单(app/link 切换、字段、实时 tool.json 预览、保存即启用);卡片 🗑 删除按钮(confirm)
- **Docker 化**:`Dockerfile`(node:22-slim,USER node)、`docker-compose.yml`(8080、tools/data 挂载卷、TZ)、`.dockerignore`
- **接入指南** [`docs/使用指南.md`](docs/使用指南.md):app/link 两种接入、在线添加/手动文件、字段速查、NAS 部署、常见问题

### 修复
- **进程状态与配置解耦**:manager 运行时状态改存内部 `run` Map,不再写 `ToolSpec`(`scanTools` 重建 spec 不再丢状态——此前出现"进程在跑但状态显示 stopped")
- **删除运行中工具 EBUSY**:Windows 下子进程占用目录导致 rmdir 失败 → DELETE 先 `manager.stop` 再删
- `manager.stop` 导出缺失

### 验证(全通过)
- 在线创建 app/link → 首页出现 → 放代码 → restart → running+ok → 删除成功
- 重复创建/非法 id 正确报错;创建删除后其他工具状态稳定(running 不丢)
- wb-credits 全程 running + health ok;反代正常

## v0.3.0 (2026-08-03) · M2 接入积分仪表盘

**第一个真实工具接入,平台跑通完整闭环。**

### 新增
- `tools/wb-credits/`:接入 `workbuddy-credits-tool`(积分仪表盘),`tool.json` 声明为 `app` 型(端口 8123,健康检查 `/api/status`)
- 账号池/历史/缓存数据随副本带入(6 个账号,工具中心内即可刷新/看明细/看趋势)

### 变更
- 移除 M1 测试工具 `fake-tool`(为真实工具让出 8123 端口);保留 `link-demo` 作为 link 型示例

### 验证(M2 验收通过)
- 首页出现"积分仪表盘"卡片(监控分组)✓
- `/tool/wb-credits` 反代正常:页面渲染 ✓、`/api/status` ✓、`/api/all` 返回 **6 账号真实数据** ✓
- 工具日志被工具中心聚合(启动日志可见)✓
- edge-daemon(添加账号辅助)初期手动启,M5 计划 `sidecars` 纳入托管

## v0.2.0 (2026-08-03) · M1 平台骨架

**工具中心可运行:扫描注册表 → 托管子进程 → 统一入口。**

### 新增
- `lib/` 五模块:
  - `config.js`:常量集中(端口/端口段/超时/退避/日志保留)
  - `registry.js`:扫描 `tools/*/tool.json` → 注册表;校验 id/type/url/cmd/port、端口段、**端口冲突检测**
  - `manager.js`:进程托管(app 型)——spawn、崩溃**指数退避自动拉起**(1s→30s,连败 5 次停)、优雅停止(SIGTERM→5s→SIGKILL)、健康检查轮询
  - `proxy.js`:零依赖反向代理(`/tool/<id>/*`,流式透传,60s 超时);link 型 **302 跳转**
  - `logger.js`:子进程 stdout/stderr → 文件(按天滚动,保留 7 天)+ 内存 200 行
- `server.mjs` 入口:路由分发(首页 / `/tool/*` / `/api/tools` / `/api/reload` / `/api/logs` / restart)
- `public/index.html` 首页:分组卡片网格、状态点(健康/异常)、托管/链接标记、30s 轮询
- `package.json`(ESM 零依赖)+ 测试夹具 `test/fixtures/`(fake-tool / link-demo)

### 修复
- 子进程 `cmd[0]==="node"` 时用中心自身的 `process.execPath`(避免依赖 PATH 导致 ENOENT 反复重启)

### 验证(M1 验收全通过)
- 注册表:app/link 双类型、端口冲突标记无效工具 ✓
- 托管:fake-tool `running + health ok` ✓;**杀掉进程 2.5s 内自动拉回** ✓
- 反代 `/tool/fake-tool/*` ✓;link 302 ✓;404 ✓;日志聚合 ✓;首页渲染 ✓

## v0.1.0 (2026-08-03) · 规划阶段

**首版,建立项目基础。**

### 新增
- 仓库初始化:`Simiely/tools-center`(public)
- 单项目规范文档 4 件套:README / AGENTS / DEVELOPMENT / CHANGELOG + `rules/`
- `DESIGN.md`:完整架构设计
  - 模块化 `lib/` 五模块(registry / manager / proxy / logger / config)
  - `tool.json` 声明规范(`type: app | link`)
  - Docker 化方案(Dockerfile + compose + 群晖部署要点)
  - 安全考虑(内网 + 可选 token + Tailscale)
- `PLAN.md`:完整路线图
  - 里程碑 M0~M5(M0 已完成,其余待开发)
  - 首批工具矩阵(积分仪表盘 / 微信读书服务化 / link 导航)
  - 任务分解、风险、验收标准
- `.gitignore`:排除 `data/`、工具凭证、日志

### 调研结论(支撑规划)
- 微信读书官方 Agent 网关可用(`POST i.weread.qq.com/api/agent/gateway` + `Bearer wrk-xxx`)→ 扩展可服务化且零依赖
- 群晖 Container Manager 部署要点:PUID/PGID、TZ、数据卷惯例、restart 策略

### 规划
- **M1 平台骨架**(下一里程碑):lib 五模块 + 首页 + tool.json 扫描(含 link 型)
- M2 接入积分仪表盘 → M3 微信读书服务化 → M4 NAS 部署上线 → M5 增强
