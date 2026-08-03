# CHANGELOG.md

> 版本变更记录。按版本分节,不拆分。

## v0.4.7 (2026-08-03) · /tool/<id> 无尾斜杠 301 规范化

**修复:从首页卡片打开工具(无尾斜杠)后 JS/资源 404、按钮失效。**

### 变更
- `server.mjs`:`/tool/<id>`(恰好一段、无尾斜杠)→ **301 重定向**到 `/tool/<id>/`(link 型同样适用)
- 首页卡片点击直接打开带尾斜杠的 `/tool/<id>/`(双保险)
- 原因:无尾斜杠时页面内相对路径 `./app.js` 解析到 `/tool/app.js`(404);带斜杠才解析到 `/tool/<id>/app.js`
- 验证:无斜杠 301 ✓ / 带斜杠 200 ✓ / 子路径不受影响 ✓ / 无头浏览器从无斜杠进入 JS 完整渲染(hero/卡片/按钮)✓

## v0.4.6 (2026-08-03) · 反代自动注入 __BASE__(子路径挂载修复)

**解决:带页面的工具挂载到 /tool/<id>/ 后 JS/API 全 404(按钮无效)。**

### 变更
- `lib/proxy.js`:app 型工具 **HTML 响应自动注入** `<script>window.__BASE__="/tool/<id>"></script>`(仅 text/html,重算 content-length,去 content-encoding;API/非 HTML 不受影响)
- 工具页面 JS 用 `__BASE__ + "/api/.."` 访问自己的接口 → 子路径下一切正常
- 使用指南新增「子路径挂载约定」:资源用相对路径、API 用 `__BASE__` 前缀(附错误/正确对照表)

### 验证
- 积分仪表盘挂载:`/tool/wb-credits-tool/` 注入成功;无头浏览器实测 hero 28623、6 卡片、刷新按钮就绪、无报错;8080 独立运行不受影响

## v0.4.5 (2026-08-03) · 放目录即出工具 + 规范文档

**接入方式收敛为两条:放目录(核心)/ 网页在线添加。确定不做 handler 型(零端口挂载)。**

### 变更
- `GET /api/tools` 改为**访问即自动重扫 `tools/` 目录 + 增量同步**:放好目录+`tool.json` 后刷新页面,新工具自动出现并启动;删目录刷新即消失(复用 manager.sync 增量逻辑,幂等安全)
- 清理 registry.js 中 handler 型半成品(validate/scanTools/createTool 恢复纯 app/link 双类型),保持代码干净
- 首页 meta 提示"把工具目录放进 tools/ 后点刷新即自动发现"
- **docs/使用指南.md 重写为规范版**:目录结构规范(核心)、tool.json 字段速查与校验规则、**API 参考完整清单**、放目录/网页两种接入、更新/删除、NAS 部署、FAQ

### 验证
- 放目录 → 刷新 → 自动发现 + `running + health ok`;反代通;删目录(平台 API)→ 自动消失 + 子进程停止 + 端口释放

## v0.4.4 (2026-08-03) · 整目录上传

**多文件/子目录的工具(如积分仪表盘的 lib/)也能网页一键接入。**

### 新增
- 「📂 选择文件夹」按钮(`webkitdirectory`):整目录上传,**保留子目录结构**(如 `lib/accounts.js`)
- 后端 upload 支持子路径:自动建目录 + 路径安全校验(规范化后必须仍在工具目录内,防逃逸)

### 验证(通过)
- 上传 `lib/accounts.js` → 子目录自动创建 ✓;`../escape.mjs` 被拒 ✓

## v0.4.3 (2026-08-03) · 创建时直接传文件

**添加工具一步到位:填名称 → 选代码文件 → 保存,创建与上传合并。**

### 变更
- 「＋ 添加工具」弹窗 app 型内新增「📁 选择文件」(可多选),保存时**创建 + 上传 + 启动**一气呵成
- 卡片 ⬆ 上传按钮保留(后续补传文件用)

### 验证(端到端通过)
- 创建(极简)→ 上传 `server.mjs` → 重启 → 反代验证上传代码生效 → 删除;全程 API 串行,与前端弹窗逻辑一致

## v0.4.2 (2026-08-03) · 网页上传代码

**"填名字 → 上传自己的代码"完整闭环,全程网页操作,不碰服务器文件系统。**

### 新增
- 卡片 **⬆ 上传** 按钮:选择本地代码文件(多选)→ `POST /api/tools/<id>/upload` 写入工具目录 → 自动重启生效
- 后端上传接口:`{name, content}` JSON 写入 `tools/<id>/`;**路径逃逸防护**(`../`、`/` 均拒绝)

### 验证(通过)
- 极简创建 → 上传 `main.mjs` → 目录落盘 → 重启生效;`../../evil.mjs` 被拒 ✓

## v0.4.1 (2026-08-03) · 添加工具极简化

**添加工具从"填 10 个字段"降到"填 1 个名称",全自动。**

### 新增
- **极简创建**:网页「＋ 添加工具」只填名称即可保存——后端自动生成 id、自动分配空闲端口、**自动生成可运行示例代码**(`server.mjs`)、自动写 `tool.json`、立即启动
- 弹窗重构:必填仅"名称"(link 型加地址);id/描述/分组/图标/命令/端口/健康检查全部收进**「▸ 高级设置」折叠**
- 后端 `createTool` 增强:app 型未指定端口→自动分配;目录为空且未给 cmd→生成示例并默认 `["node","server.mjs",<port>]`

### 验证(通过)
- 只填 `{name}` 创建 app → id/端口 8100/示例 server.mjs/cmd 全自动 → running → 反代可访问
- 只填 `{name,url}` 创建 link → 自动 id ✓;删除测试工具正常

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
