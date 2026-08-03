# Tools Center · 轻量工具统一宿主

> Node 零依赖的"轻量工具管理平台":把你写的各种小工具(积分仪表盘、购书工作台、脚本服务…)
> 以 **"放目录 + 写 `tool.json`"** 的方式统一挂载,从一个入口访问、统一托管进程,常驻在你的 NAS 上。

**当前状态:规划阶段** —— 架构设计与完整路线图已就绪,待开发(M1 平台骨架)。

## 它解决什么

| 痛点 | 方案 |
|---|---|
| 工具零散、记端口 | 统一入口 `http://NAS:8080`,首页卡片 + `/tool/<id>` 直达 |
| 进程没人管 | 子进程托管:崩溃自动拉起 / 健康检查 / 日志聚合 |
| 添加工具麻烦 | 放目录 + 写 `tool.json` → 自动出现在首页,零代码改动 |
| 换机器/换容器丢数据 | 工具目录与数据全部挂载卷,容器无状态 |

## 核心设计

- **零依赖**:纯 `node:http` / `node:child_process` 手写,无 node_modules
- **单容器 + 子进程**:轻量工具共用一个 Node 运行时,不搞每工具一容器
- **两种工具类型**:
  - `app`(默认):工具中心托管子进程 + 反向代理访问
  - `link`:纯入口卡片,点击跳转到外部服务(其他容器/套件),不做托管
- **模块化 `lib/`**:registry(注册表)/ manager(进程托管)/ proxy(反代)/ logger(日志)/ config(常量)

## 文档

| 文档 | 内容 |
|---|---|
| [DESIGN.md](DESIGN.md) | 架构设计:目录结构 / tool.json 规范 / 模块划分 / Docker 化 / 安全 |
| [PLAN.md](PLAN.md) | 完整规划:里程碑 M0~M5 / 任务分解 / 首批工具矩阵 / 风险 / 验收标准 |

## 首批工具矩阵(规划)

| 工具 | 类型 | 来源 |
|---|---|---|
| 积分仪表盘 | app | [workbuddy-credits-tool](https://github.com/Simiely/workbuddy-credits-tool)(已有) |
| 微信读书购书工作台 | app | weread-budget-extension 服务化(待建仓库) |
| NAS 现有服务(Jellyfin 等) | link | 一张卡片接入 |

## 路线图

```
M0 初始化   建仓库/骨架/规范文档        ✅ 本仓库
M1 平台骨架 lib 五模块 + 首页 + 扫描    待开发
M2 接入积分 首个 app 型实战 + 数据卷    待开发
M3 微信读书 扩展 → Node 服务化         待开发
M4 NAS 上线 群晖部署 + Tailscale      待开发
M5 增强    认证 / WebSocket / 内嵌     可选
```

> 详见 [PLAN.md](PLAN.md)。欢迎 star / issue 交流。
