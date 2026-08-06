# DEVELOPMENT.md · 开发文档

> 结构固定三块:**项目概览 → 架构说明 → 关键决策与方案**。
> 本文件是"门面 + 索引",详细架构见 `DESIGN.md`,路线图见 `PLAN.md`。

## 一、项目概览

Node 零依赖的"轻量工具统一宿主":个人写的各种轻量小工具以声明式(`tool.json`)接入,
统一入口 + 子进程托管,常驻 NAS。核心哲学与 `workbuddy-credits-tool` 一致——**轻量到底、模块化、零依赖**。

- 当前阶段:M1 平台骨架 ✅ / M2 接入积分仪表盘 ✅ / 程序完整化(自助接入 + Docker + 指南)✅;M3 微信读书服务化 / M4 NAS 部署待做
- 关键数字:主端口 `8080`(可 PORT 覆盖)、工具段 `8100~8199`、健康轮询 30s、代理超时 60s、日志保留 7 天、拉起退避 1s→30s(连败 5 次停)
- 首批工具:积分仪表盘(app,已接入,含 edge-daemon 辅助进程托管)、NAS 现有服务(link)
- 接入方式:①**放目录即出**(`tools/<id>/tool.json`,刷新页面自动发现并启动)②网页在线添加(填名称/传文件)③link 型一个 JSON 文件

## 二、架构说明(摘要)

```
server.mjs(入口:组装 + 路由;对 /tool/<id> 无尾斜杠做 301 规范化)
├── lib/core/registry.js   扫描 tools/*/tool.json → Map<id, ToolSpec>(校验 type/端口/冲突)
│                          createTool/removeTool(在线增删;removeTool 幽灵幂等兜底)
├── lib/core/lifecycle.js  生命周期状态:removedSet(已解除托管)/pausedSet(已暂停)持久化
├── lib/core/disk-ops.js   存储管理:磁盘扫描分类(托管/无效/解除/幽灵)/清理/恢复/先停进程再删
├── lib/core/manager.js    进程托管(app 型):spawn(状态与 spec 解耦)/ 退避拉起 / SIGTERM→SIGKILL / 暂停联动 / 健康轮询
├── lib/core/proxy.js      反代(app 型)/tool/<id>;HTML 响应自动注入 __BASE__;link 型 302;WS 升级
├── lib/core/logger.js     stdout/stderr → data/logs/<id>.log(按天滚动)+ 内存 200 行
└── lib/core/config.js     常量:端口/超时/间隔/退避参数
lib/routes/                路由按域拆分(v0.11):tools-proxy/tools-crud/tools-files/tools-prefix/backup/webdav/admin/disk/cap/helpers/index
public/js/                 前端六文件:api(请求)/ui(基础)/cards(渲染)/detail(详情)/disk(存储)/app(主逻辑)
```

- **单容器 + 子进程**:工具全是零依赖 Node,一个运行时全装下;不搞每工具一容器
- **依赖单向**:`server.mjs → lib/*`,模块间不绕环(lifecycle 不依赖 registry,避免循环);新能力以新模块接入
- **GET /api/tools 访问即重扫**:放目录+tool.json → 刷新页面即出现并自动启动(manager.sync 增量:新增启动、删除停止)
- **状态持久化独立**:removed/paused 是"标记",与注册表 Map(纯配置)分离;重启不丢
- 完整设计(目录结构 / tool.json 规范 / Docker 化 / 安全):见 [`DESIGN.md`](DESIGN.md);接入操作见 [`docs/使用指南.md`](docs/使用指南.md)

## 三、关键决策与方案

> 规划期的架构决策,一坑一篇(与 knowledge-base 同格式);开发中真踩坑后继续追加。

## 问题:为什么单容器 + 子进程,而非"每工具一容器"?

**TL;DR**:轻量工具共用一个 Node 运行时,资源省一个数量级,管理也简单。

- 问题:工具多了,每工具一个容器会导致容器数线性膨胀、维护成本高
- 根因:工具全是零依赖 Node,一个运行时即可承载;隔离需求不存在(都是自己的工具)
- 解决:单容器 + spawn 子进程托管;重工具走 `link` 型跳转到独立容器
- 预防:新增工具先判断"是否真的需要独立环境",否则一律 app 型子进程

## 问题:为什么设计 `type: app | link` 两种类型?

**TL;DR**:区分"自己写的(托管)"与"外部部署的(导航)",一个首页两种语义。

- 问题:NAS 上既有自研工具,也有独立部署的服务(其他容器/套件),入口要统一
- 根因:两类对象的管理职责完全不同(托管 vs 只跳转)
- 解决:`app` 型 spawn + 反代;`link` 型只出卡片,点击新标签页 302 到 url
- 预防:link 型不占端口、不 spawn,实现保持极简

## 问题:为什么坚持零第三方依赖?

**TL;DR**:路由/反代/进程管理全手写,~1000 行代码换来无 node_modules、无构建、无锁依赖。

- 问题:引入 Express/PM2 等会带来依赖树、版本锁、构建步骤
- 根因:功能面(HTTP 反代 + 子进程)用 `node:` 内置模块完全覆盖
- 解决:纯原生实现;需要时(如认证)优先手写或再评估
- 预防:任何新依赖必须论证必要性,默认拒绝

## 问题:子路径挂载下工具 JS/API 全失效,平台怎么兜底?

**TL;DR**:反代 HTML 时自动注入 `window.__BASE__="/tool/<id>"`,并规范 URL 尾斜杠;工具侧资源用相对路径、API 用 `__BASE__` 前缀。

- 问题:带页面的工具在 `/tool/<id>/` 下,绝对路径 `/app.js`、`/api/*` 解析到平台根 → 404,按钮全失效(实测踩坑)
- 根因:工具按独立站点编写,不知道自己的挂载前缀
- 解决:① `proxy.js` 对 text/html 响应注入 `__BASE__`(重算 content-length、去 content-encoding);② `server.mjs` 对 `/tool/<id>`(无尾斜杠)301 到带斜杠,保证相对路径正确;③ 工具侧约定见 `docs/使用指南.md`「子路径挂载约定」
- 预防:页面工具一律相对路径 + `__BASE__` 前缀;纯后端工具不受影响

## 问题:为什么运行状态要存在 manager 内部,而非 ToolSpec 上?

**TL;DR**:扫描重建 spec 是"纯配置",状态存别处才不会在 reload/在线增删时丢失。

- 问题:曾出现"进程在跑但卡片显示 stopped"——状态存在旧 spec 对象上,`scanTools()` 重建后丢失
- 根因:配置(注册表)与运行时状态(进程/健康/退避)生命周期不同
- 解决:`lib/manager.js` 用内部 `run Map` 存状态,`ToolSpec` 只当纯配置;重扫/重建不影响运行
- 预防:任何"配置即状态"的写法都要拆开

## 问题:删除运行中的工具为什么报 EBUSY?

**TL;DR**:Windows 下子进程占用目录,删除前必须先停进程。

- 问题:`DELETE /api/tools/<id>` 删目录报 EBUSY(目录被占用)
- 根因:工具子进程还活着,句柄占用目录
- 解决:删除前 `manager.stop(t)`(SIGTERM → 5s → SIGKILL)再删
- 预防:所有"删除目录"类操作,先确认相关进程已终止

## 问题:添加工具怎么做到"只填一个名字"?

**TL;DR**:后端补全缺失字段(id/端口/示例代码/命令),前端必填仅名称,高级字段折叠。

- 问题:早期在线添加要填 10 个字段 + 记端口段 + 手动放代码,门槛太高
- 解决:`createTool` 自动补全:id 未填自动生成、端口自动分配段内最小空闲、空目录自动生成可运行示例 + 默认 cmd;前端「＋ 添加工具」仅名称必填,「▸ 高级设置」折叠其余
- 预防:交互设计先问"哪个字段真的需要用户操心"

## 问题:幽灵卡片(前端有卡片、后端查无此人)为什么删不掉?

**TL;DR**:后端幂等删除 + 删除前探测接口,双保险让"幽灵卡片"永远可清理。

- 问题:工具目录被外部删除/挂载失效/manifest 损坏后,注册表查无此 id,但前端页面还留着卡片;DELETE 报"工具不存在" → 用户永远删不掉这张卡
- 根因:`removeTool` 对查无此 id 直接抛错,没有"残留清理"语义
- 解决:① 后端 `removeTool` 幽灵分支幂等删除(目录存在则物理删,不存在则视为已删,返回 `ghost:true`);② 前端删除前先 `GET /api/tools/<id>` 探测——404 判幽灵,确认弹窗明示「残留卡片」
- 预防:所有"删除"接口对目标不存在都应幂等成功(残留清理),而非报错卡死

## 问题:为什么要拆 lifecycle.js,把 removed/paused 从 registry 迁走?

**TL;DR**:注册表是"纯配置",生命周期是"可变状态",两者生命周期不同,拆开避免循环依赖与职责混杂。

- 问题:registry.js 里塞了扫描/校验/CRUD + removedSet/pausedSet 持久化,327 行;且 restoreTool 内部调 scanTools 造成模块内隐式耦合
- 根因:配置与状态混在一个模块,状态改动(暂停/解除)会牵连扫描逻辑
- 解决:新建 `lib/core/lifecycle.js` 只管理两个持久化 Set(不依赖 registry,单向依赖);`restoreTool` 只清标记,**扫描由调用方负责**(routes/disk-ops 补 `scanTools()`)
- 预防:状态类逻辑独立成模块,模块间依赖保持单向

## 问题:Windows 下 npm test 为什么偶发 DLL 初始化失败?

**TL;DR**:`node --test` 并发 spawn 测试子进程在 Windows 上偶发 0xC0000142;串行 + 显式文件列表根治。

- 问题:npm test 跑着跑着报 `exitCode: 3221225794`(0xC0000142 DLL init failed),单独跑每个文件都过
- 根因:Windows 下 `node --test` 默认高并发 spawn 子进程,偶发 DLL 加载竞争;且 npm 用 cmd 不展开 glob,node 自展开 glob 行为不稳
- 解决:test 脚本改为 `--test-concurrency=1` + **显式文件列表**(不用 `tests/*.test.mjs` glob)
- 预防:Windows 上 node --test 一律串行 + 显式列表;bash 直跑时 glob 正常,但 npm 环境要兼容 cmd

## 问题:为什么挂载点目录删不掉?"幽灵目录"为什么反复出现?

**TL;DR**:Docker bind mount 目录平台无法物理删除(EBUSY);且 cleanupDisk 曾与 removeTool 语义相反——失败时清标记导致下次扫描又识别回来(v0.11.2 修复)。

- 问题:NAS 上独立仓库挂载到 `/app/tools/<id>`(嵌套挂载),无 manifest 时显示"幽灵目录",删除提示失败、删了又出现
- 根因一(Docker 机制):挂载点是容器内外共享的边界,容器内 `rmdir` 挂载点目录报 EBUSY(Device busy),平台**永远无法删除挂载点**——必须在宿主机删挂载源或改 compose
- 根因二(代码 bug):`cleanupDisk` 删除失败后 `restoreTool`(清 removed 标记),而 `removeTool` 失败是 `markRemoved`(保留标记)——语义相反导致失败目录下次扫描又识别成幽灵
- 解决:① cleanupDisk 失败 → 保留标记 + 返回具体错误(EBUSY/EPERM 转"需在宿主机处理"提示);② scanDisk 加 `mount` 字段(st_dev 检测挂载点);③ compose 模板加独立仓库挂载警告注释
- 预防:接入独立 git 仓库的工具时,优先 clone 到宿主 tools 主目录作普通子目录(平台可管理);挂载点是设计边界,识别 + 提示而非假装能删

## 问题:平台更新为什么不能热更新?工具为什么能?

**TL;DR**:Docker 镜像层不可变 → 平台代码必须重拉镜像重建;工具代码在挂载卷 → 改文件即热更新。架构设计使两者自然分离。

- 问题:用户希望像更新工具一样"热更新"平台,不用每次去管理页手动 pull
- 根因:Docker 镜像每一层不可变,容器内 `/app/lib`、`/app/public` 是只读层,平台代码更新只能"拉新镜像 + 重建容器"(所有容器化应用通用)
- 解决(已向用户说明并达成共识):平台更新走 `docker compose pull && up -d`(中断 10-30s),底部版本号确认生效;工具更新保持热更新(挂载卷内改文件 → 重扫 → 重启工具进程)
- 未来候选:内置"检查更新 + 一键更新"按钮(需挂载 /var/run/docker.sock 提权,用户评估后暂缓)
- 预防:保持"平台在镜像、工具在挂载卷"的边界,这是工具可热更新的根本前提

## 四、每次改动的动作清单

| 场景 | 动作 |
|---|---|
| 改了业务逻辑 | 改 `lib/` 对应模块;更新本文件/DEVELOPMENT 相关说明 |
| 踩坑并解决 | 本文件「关键决策与方案」一坑一篇 → 收尾提炼进 knowledge-base |
| 改了前端 | `public/index.html`(前端免重启,刷新即生效) |
| 发版 | README(如有变更)+ CHANGELOG 加版本节 |

## 五、部署要点(详见 DESIGN.md / PLAN.md)

- 群晖:Container Manager → 项目 → compose;**先建 `/volume1/docker/tools-center/{tools,data}` 再起容器**
- 权限:`PUID/PGID` 映射 + `TZ=Asia/Shanghai`;`restart: unless-stopped`
- 远程:Tailscale 组网,不暴露公网端口
