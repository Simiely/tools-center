# DEVELOPMENT.md · 开发文档

> 结构固定三块:**项目概览 → 架构说明 → 关键决策与方案**。
> 本文件是"门面 + 索引",详细架构见 `DESIGN.md`,路线图见 `PLAN.md`。

## 一、项目概览

Node 零依赖的"轻量工具统一宿主":个人写的各种轻量小工具以声明式(`tool.json`)接入,
统一入口 + 子进程托管,常驻 NAS。核心哲学与 `workbuddy-credits-tool` 一致——**轻量到底、模块化、零依赖**。

- 当前阶段:M0 完成(仓库 + 规划文档);M1 平台骨架待开发
- 关键数字:主端口 `8080`、工具段 `8100~8199`、健康轮询 30s、代理超时 60s、日志保留 7 天、拉起退避 1s→30s
- 首批工具:积分仪表盘(app)、微信读书购书工作台(app)、NAS 现有服务(link)

## 二、架构说明(摘要)

```
server.mjs(入口:组装 + 路由)
├── lib/registry.js   扫描 tools/*/tool.json → Map<id, ToolSpec>(校验 type/端口)
├── lib/manager.js    进程托管(app 型):spawn / 退避拉起 / SIGTERM→SIGKILL / 健康轮询
├── lib/proxy.js      反代(app 型)/tool/<id>;link 型 302;WS 升级预留
├── lib/logger.js     stdout/stderr → data/logs/<id>.log(按天滚动)+ 内存 200 行
└── lib/config.js     常量:端口/超时/间隔/退避参数
public/index.html     首页:分组卡片网格、状态点、30s 轮询、link 标记
```

- **单容器 + 子进程**:工具全是零依赖 Node,一个运行时全装下;不搞每工具一容器
- **依赖单向**:`server.mjs → lib/*`,模块间不绕环;新能力以新模块接入
- 完整设计(目录结构 / tool.json 规范 / Docker 化 / 安全):见 [`DESIGN.md`](DESIGN.md)

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
