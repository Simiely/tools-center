# 工具中心(Tools Center)· 设计文档

> 一个 Node 零依赖的"轻量工具统一宿主":把你自己写的各种小工具(积分仪表盘、脚本、页面…)
> 以"放目录 + 写声明"的方式统一挂载到一台 NAS 上,从一个入口访问、统一托管进程。
> 状态:**设计稿**(2026-08-03)。目标读者:开发者(自己)+ AI 协作者。

---

## 一、背景与目标

### 背景

你(Simiely)会持续开发很多**轻量小工具**:零第三方依赖、Node 原生、单文件/单目录即可运行
(现有代表:`workbuddy-credits-tool` 积分仪表盘,~2200 行零依赖)。工具多了之后出现三个痛点:

1. **零散**:每个工具各自占一个端口,靠记端口/收藏夹访问
2. **进程无人管**:崩溃没人拉、日志没人收、重启要手动
3. **换机器麻烦**:每台机器要单独装、单独配

### 目标

- **添加工具足够简单**:放一个目录 + 写一个 `tool.json`,首页自动出现
- **统一入口**:`http://NAS:8080` 一个地址进首页,`/tool/xxx` 直达工具
- **进程托管**:启动/崩溃自动拉起/健康检查/日志聚合,一个容器管全部
- **轻量到底**:与工具同哲学——零第三方依赖、单 Node 镜像、低资源占用
- **NAS 常驻**:docker-compose 一条命令启动,开机自启,数据卷持久化

### 非目标(刻意不做)

- 不做多租户/复杂权限(个人使用;后续可加一层简单认证)
- 不做容器级隔离的"每工具一容器"(轻量工具无此必要;若未来有重工具,可独立容器并靠反代接入)
- 不做公网暴露的完整安全体系(默认内网 + Tailscale;如需公网另行加固)

---

## 二、需求分析

| 需求 | 说明 | 优先级 |
|---|---|---|
| 工具注册 | 自动扫描 `tools/*/tool.json` 生成注册表 | P0 |
| 统一路由 | `/tool/{id}` 反向代理到工具端口 | P0 |
| 聚合首页 | 卡片网格(名称/图标/分组/状态),点击进入 | P0 |
| 进程托管 | spawn 子进程;崩溃自动拉起(退避);优雅停止 | P0 |
| 健康检查 | 轮询 `tool.json` 声明的 health 路径,首页显示状态点 | P1 |
| 日志聚合 | 每工具 stdout/stderr 收集,首页/API 可查看 | P1 |
| 开机自启 | Docker `restart: unless-stopped` | P0 |
| 数据持久化 | 工具数据目录挂载宿主卷(换容器不丢) | P0 |
| 简单认证 | 可选 Basic Auth / token,防局域网内误入 | P2 |
| 远程访问 | 文档给出 Tailscale 接入方式(不内置) | P1 |

---

## 三、总体架构

```
                 ┌──────────────────────────────────────────┐
                 │  NAS · Docker                            │
                 │  ┌────────────────────────────────────┐  │
   浏览器         │  │ tools-center 容器(Node:slim)        │  │
 局域网/Tailscale │  │  ┌──────────────────────────────┐  │  │
     │           │  │  │ server.mjs(主程序)             │  │  │
     │  :8080    │  │  │  路由 / 注册表 / 进程托管 / 日志 │  │  │
     ▼           │  │  └──────────┬───────────────────┘  │  │
  ┌───────┐      │  │             │ spawn + 反代          │  │
  │ 首页   │      │  │  ┌──────────┼──────────┐           │  │
  │ /tool/ │◄─────┼──┼──┼────┐     │          │           │  │
  │ 卡片   │      │  │  ▼    ▼     ▼          ▼           │  │
  └───────┘      │  │ [wb-credits] [toolB]    [toolC]     │  │
                 │  │   :8123      :8124      :8125       │  │
                 │  └────────────────────────────────────┘  │
                 │        ▲ 数据卷(宿主:/volume1/tools)     │
                 └────────┴─────────────────────────────────┘
```

### 关键决策

| 决策 | 理由 |
|---|---|
| **单容器 + 子进程** | 工具全是零依赖 Node,一个 Node 运行时即可;比"每工具一容器"省一个数量级资源,管理也简单 |
| **主程序零依赖** | 路由/反代/进程管理全用 `node:http`/`node:child_process` 手写,保持轻量哲学 |
| **端口段约定** | 工具端口统一分配 `8100~8199`;主程序固定 `8080`(可环境变量覆盖) |
| **manifest 驱动** | 一切以 `tool.json` 为准,主程序不感知工具内部实现 |

---

## 四、目录结构

```
tools-center/
├── server.mjs            # 入口(薄层):读配置 → 组装模块 → 启动,零业务逻辑
├── lib/                  # ★ 共享模块层(职责单一,可独立测试)
│   ├── config.js         # 常量:主端口/工具端口段/健康轮询间隔/日志保留天数
│   ├── registry.js       # 注册表:扫描 tools/*/tool.json → Map<id, ToolSpec>
│   ├── manager.js        # 进程托管:spawn / 崩溃自动拉起(退避) / 优雅停止 / 健康检查
│   ├── proxy.js          # 反向代理:零依赖手写转发(含 WebSocket 升级预留)
│   └── logger.js         # 日志:文件按天滚动 + 内存环形缓冲(每工具最近 200 行)
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── package.json          # 仅 {"type":"module"},无依赖
├── public/
│   └── index.html        # 首页(原生 HTML/CSS/JS,深色粉红风格与积分工具一致)
├── tools/                # ★ 工具目录(挂载为数据卷)
│   └── wb-credits/       # 示例:积分仪表盘
│       ├── tool.json     # 工具声明
│       └── ...           # 工具本体文件(由用户拷贝/挂载)
├── data/                 # 运行时数据(日志等,挂载卷)
│   └── logs/
└── docs/
    ├── 使用指南.md       # 添加/管理工具
    └── API.md            # 主程序 REST API(>150 行时再拆,当前并入本文件附录)
```

> 模块化原则:与积分工具(`workbuddy-credits-tool` 的 `lib/`)同哲学——**业务逻辑进 `lib/`,入口只做组装**。每模块 100~250 行、职责单一,改动只影响一个文件;未来加能力(认证/内嵌/WebSocket)新增模块即可,不破坏现有结构。

---

## 五、`tool.json` 声明规范

每个工具一个 `tools/<id>/tool.json`,主程序启动时扫描全部 `tools/*/tool.json`。

### 字段定义

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✅ | 唯一标识(目录名一致);URL 用,`[a-z0-9-]` |
| `name` | string | ✅ | 显示名称(中文) |
| `desc` | string | — | 一句话描述 |
| `group` | string | — | 分组(首页按组分卡片);默认"其他" |
| `icon` | string | — | 卡片图标(emoji 或文本) |
| `type` | string | — | `app`(默认,托管子进程)/ `link`(纯跳转入口) |
| `url` | string | **link 必填** | link 型目标地址,如 `http://NAS-IP:9000`(指向其他容器/外部服务) |
| `cmd` | string[] | **app 必填** | 启动命令数组,如 `["node","wb-gui.mjs","8123"]` |
| `cwd` | string | — | 工作目录(相对工具目录,默认工具目录) |
| `port` | number | **app 必填** | 工具监听端口(8100~8199) |
| `health` | string | — | 健康检查路径(如 `/api/status`);app 型 = 子进程内路径,link 型 = 目标服务路径,GET 返回 2xx 视为健康 |
| `env` | object | — | 注入的环境变量(如 `TOOLS_DATA=/data/tools/<id>`) |
| `restart` | string | — | `always`(默认)/ `on-failure` / `no`(仅 app 型) |
| `hidden` | boolean | — | 不在首页显示(仅可直达,用于内部工具) |

> **两种类型**:
> - `app`(默认):工具中心 spawn 托管子进程,统一路由 `/tool/<id>` 反代访问——适合你自己写的工具;
> - `link`:**不做进程托管、不反代**,只在首页生成一张卡片,点击**新标签页直接跳转**到 `url`——适合 NAS 上独立部署的其他服务(Docker 容器、群晖套件等)。实现极简:registry 多两个字段,manager 跳过,首页加跳转。

### 示例 A:`app` 型 —— `tools/wb-credits/tool.json`

```json
{
  "id": "wb-credits",
  "name": "积分仪表盘",
  "desc": "WorkBuddy 多账号积分监控与消耗趋势",
  "group": "监控",
  "icon": "📊",
  "type": "app",
  "cmd": ["node", "wb-gui.mjs", "8123"],
  "cwd": ".",
  "port": 8123,
  "health": "/api/status",
  "env": {
    "TOOLS_DATA": "/data/tools/wb-credits"
  }
}
```

### 示例 B:`link` 型 —— `tools/jellyfin/tool.json`(指向独立容器)

```json
{
  "id": "jellyfin",
  "name": "影音库 Jellyfin",
  "desc": "NAS 上独立运行的媒体服务(容器自管)",
  "group": "服务",
  "icon": "🎬",
  "type": "link",
  "url": "http://192.168.1.100:8096",
  "health": "/health"
}
```

> link 型**只需要这一个文件**,`tools/jellyfin/` 目录里没有任何代码——主程序不 spawn、不占端口,`/tool/jellyfin` 会 302 重定向到 `url`。

### 添加工具的流程(用户视角)

1. **app 型**:在 `tools/` 下建目录 `<id>/`,拷入工具文件 + 写 `tool.json`;
2. **link 型**:直接建 `tools/<id>/tool.json`,填 `type:"link"` + `url` 即可;
3. **刷新首页即可自动发现**(`GET /api/tools` 访问即重扫 + 增量启动;`POST /api/reload` 仍可用,网页「＋ 添加工具」亦可在线创建)。

---

## 六、主程序设计(`server.mjs`)

### 6.1 职责划分

### 6.1 模块划分(与积分工具同哲学:业务进 lib,入口只组装)

| 模块 | 职责 | 关键导出 | 依赖 |
|---|---|---|---|
| `server.mjs` | 入口(薄层):读配置 → 组装各模块 → 启动 HTTP | `main()` | 全部 lib |
| `lib/config.js` | 常量集中:主端口、工具端口段、健康间隔、日志保留天数、退避参数 | `CONFIG` | — |
| `lib/registry.js` | 扫描 `tools/*/tool.json` → 校验字段/类型/端口冲突 → `Map<id, ToolSpec>`;区分 `app`/`link` 型;**在线创建/删除**(自动补 id/分配端口/生成示例) | `scanTools / createTool / removeTool / get / list` | config |
| `lib/manager.js` | 进程托管(**仅 app 型**):spawn、退出自动拉起(指数退避 1s/2s/4s…封顶 30s,连败 5 次停)、优雅停止(SIGTERM→5s 后 SIGKILL)、健康检查轮询;**运行状态存内部 run Map 与 spec 解耦**;删除前先 stop 防 EBUSY | `startAll / start / stop / restart / sync / statusOf` | registry, config |
| `lib/proxy.js` | 零依赖反向代理(**仅 app 型**):`/tool/<id>/*` 请求转发(流式透传、**text/html 自动注入 `window.__BASE__`**、60s 超时、WebSocket 升级预留);**link 型返回 302 重定向到 url** | `proxyRequest` | registry |
| `lib/logger.js` | 每工具 stdout/stderr → `data/logs/<id>.log`(按天滚动、保留 7 天)+ 内存环形缓冲(最近 200 行);仅 app 型有日志 | `attach(tool) / read(id, lines)` | config |

路由(HTTP 层)由 `server.mjs` 持有,仅做"URL → 模块"的分发,不写业务逻辑:

```
GET  /                    → public/index.html + 注册表 JSON
GET  /tool/<id>[/...]     → proxy:app 型反代 / link 型 302 → url
GET  /tool/<id>           → 301 → /tool/<id>/(无尾斜杠规范化,保证相对路径正确)
GET  /api/tools           → 访问即自动重扫 tools/ + manager.sync 增量(放目录刷新即出)
POST /api/tools           → createTool(自动补 id/端口/示例)+ 启动(在线添加)
DELETE /api/tools         → 先 stop 再删目录(在线删除)
GET  /api/tools/<id>      → 单工具状态
POST /api/tools/<id>/restart → manager.restart(link 型返回 400)
POST /api/tools/<id>/upload → 上传文件/子目录到工具目录(防路径逃逸)
POST /api/reload          → registry.reload + manager 增量拉起
GET  /api/logs/<id>?lines → logger.read(link 型返回 400)
```

> 依赖方向自上而下单向:`server.mjs → registry/manager/proxy/logger`,各模块间不互相绕环。新增能力(认证/内嵌)以新模块接入,不修改既有模块。

### 6.2 `lib/proxy.js` 细化:反向代理要点

- `node:http` 请求转发:`req.pipe(proxyReq)` + `proxyRes.pipe(res)`,透传方法/请求体/响应头
- 改写响应头:`Location` 等绝对路径降级为相对(可选,初期可透传)
- **WebSocket 升级**:预留 `upgrade` 事件处理(部分工具可能需要,如 HMR);初期若不需要可暂缓
- 超时:代理请求 60s 超时断开

### 6.3 `lib/config.js` 细化:端口分配

- 主程序:`8080`(环境变量 `PORT` 可覆盖)
- 工具段:`8100~8199`(启动时校验;`tool.json` 声明的 port 冲突 → 该工具标记 error 并跳过)

### 6.4 `lib/logger.js` 细化:日志

- 每工具 stdout/stderr 写入 `data/logs/<id>.log`(追加,按天滚动,保留 7 天)
- 内存保留每工具最近 200 行供 `/api/logs/<id>` 快速查看(UI 尾部刷新)

---

## 七、前端首页(`public/index.html`)

- 原生 HTML/CSS/JS,深色粉红主题(与积分仪表盘视觉一致,`#ff9292` 系)
- 结构:顶栏(标题 + 状态总览)→ 分组卡片网格
- 每卡片:图标 / 名称 / 描述 / 状态点(绿=健康、黄=启动中、红=异常;link 型可配 health 探活)
- 点击行为:**app 型** → 进入 `/tool/<id>/`(新标签页);**link 型** → 卡片带"外部"小标记,点击直接新标签页打开 `url`
- 打开时 `fetch(/api/tools)` 渲染(访问即重扫,放目录刷新即出);**无自动轮询**,右上角手动刷新按钮(状态变化不频繁,轮询浪费)
- 工具内嵌方式:新标签页打开(`/tool/<id>/`)——iframe 有 X-Frame-Options 兼容问题,初期不做内嵌

---

## 八、Docker 化

### Dockerfile

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY . .
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.mjs"]
```

### docker-compose.yml

```yaml
services:
  tools-center:
    build: .
    container_name: tools-center
    ports:
      - "8080:8080"
    volumes:
      - ./tools:/app/tools          # 工具目录(挂载,方便热添加)
      - ./data:/app/data            # 日志等运行时数据
    restart: unless-stopped
```

> 说明:工具本体放挂载卷 `tools/`,因此**升级工具中心镜像不影响已添加的工具**;工具数据(如 `wb-accounts.json`)建议再独立挂载到 `/data/tools/<id>` 并注入 `TOOLS_DATA` 环境变量,换容器不丢。

### 部署到 NAS 的步骤(群晖示例)

1. 群晖装 **Container Manager**(原 Docker 套件);
2. 把 `tools-center/` 整个目录放到 NAS 共享文件夹;
3. Container Manager → 项目 → 新增 → 选择 `docker-compose.yml` → 构建并启动;
4. 访问 `http://NAS-IP:8080`。

---

## 九、安全考虑

| 项 | 方案 | 阶段 |
|---|---|---|
| 内网访问 | 默认仅监听局域网;不发布公网 | 立即 |
| 简单认证 | 主程序可选 `AUTH_TOKEN` 环境变量:开启后首页与 `/api/*` 需带 token(工具页面不拦截,保持简单) | P2 |
| 远程访问 | Tailscale 组网(`tailscale up` 后经 `100.x.x.x:8080` 访问),不暴露公网端口 | 推荐 |
| 工具安全 | 工具子进程与主程序同容器;信任自己的工具(不在容器内做额外沙箱) | 立即 |

---

## 十、接入现有积分工具(wb-credits)的具体步骤

1. 在 `tools/wb-credits/` 下放入 `workbuddy-credits-tool` 的代码文件(`wb-gui.mjs`、`wb-gui.html/js`、`lib/`、`edge-daemon.mjs`);
2. 写 `tool.json`(见第五节示例;`cmd` 用 `["node","wb-gui.mjs","8123"]`);
3. 数据目录:`wb-accounts.json` / `wb-history.json` / `wb-last-data.json` 放在 `tools/wb-credits/data/`,`tool.json` 的 `cmd` 前加 `cd data` 或注入 `TOOLS_DATA` 并调整程序读取路径(小改造);
4. 启动工具中心 → 首页出现"积分仪表盘"卡片 → 点击进入 `/tool/wb-credits`;
5. 云同步/导出 MD 等既有功能照常使用(工具本身无感知)。

> 备注:edge-daemon(HTTP API **8129**,端口段内)属于"添加账号"的辅助进程——**已实现为 app 工具托管**(`tools/edge-daemon/tool.json`,`cmd:["node","edge-daemon.mjs","8129"]`,`health:/status`,`restart:always`),平台自动拉起+崩溃自愈,无需手动启动。Edge 需以 `--remote-debugging-port=9222` 启动(daemon 用 CDP 标准发现 `/json/version` 连接)。

---

## 十一、API 一览(主程序)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 首页 |
| GET | `/tool/<id>/*` | 代理到工具 |
| GET | `/api/tools` | 注册表 + 状态列表 |
| GET | `/api/tools/<id>` | 单工具状态 |
| POST | `/api/tools/<id>/restart` | 重启工具 |
| POST | `/api/reload` | 重扫工具目录 |
| GET | `/api/logs/<id>?lines=200` | 工具日志 |

---

## 十二、Roadmap

| 阶段 | 内容 | 状态 |
|---|---|---|
| M1 骨架 | server.mjs + lib 五模块(含 **`link` 型入口**:外部服务/容器加卡片跳转)+ 首页 | 待开发 |
| M2 接入 | 积分工具接入 + 数据卷规划 | 待开发 |
| M3 健壮性 | 健康检查 / 日志聚合 / 自动拉起退避 | 待开发 |
| M4 发布 | Dockerfile + compose + 部署到 NAS + 文档(单项目规范 4 件套) | 待开发 |
| M5 增强 | 简单认证 / WebSocket 代理 / 工具内嵌 / 移动端适配 | 可选 |

---

## 十三、备选方案回顾(为何不自建之外的方案)

| 方案 | 结论 |
|---|---|
| Muximux / Homepage | 只解决"入口",不管进程托管与"添加工具";仍需自己写托管逻辑 |
| Coolify / Runtipi | 完整 PaaS,4C/4G 起步,对零依赖小工具过重;添加工具流程(容器化)反而比"放目录+manifest"重 |
| 每工具一容器 + Portainer | 容器数随工具线性增长,资源与维护成本高;轻量工具无隔离需求 |

自建方案以 **~1000 行零依赖代码** 换来自动发现、进程托管、统一入口,与工具本身的轻量哲学一致,且可作为下一个开源项目持续演进。
